const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getPool } = require('../config/database');
const { issue } = require('../services/token.service');
const { hashToken, csrfToken } = require('../utils/generateTokens');
const { setAuthCookies, clearAuthCookies } = require('../utils/cookieOptions');

const response = (res, data, message = 'Success', status = 200) => res.status(status).json({ success: true, message, data });

exports.signup = async (req, res) => {
  const email = req.body.email.toLowerCase();
  const exists = await getPool().query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rowCount) return res.status(409).json({ success: false, message: 'Email already registered' });
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  try {
    const { rows: [user] } = await getPool().query(
      `INSERT INTO users (name, email, password_hash, email_verification_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role`,
      [req.body.name, email, passwordHash, hashToken(verificationToken)],
    );
    return response(res, { ...user, ...(process.env.NODE_ENV !== 'production' ? { verificationToken } : {}) }, 'Account created', 201);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'Email already registered' });
    throw error;
  }
};

exports.login = async (req, res) => {
  const { rows: [user] } = await getPool().query('SELECT * FROM users WHERE email = $1', [req.body.email.toLowerCase()]);
  const locked = user?.lock_until && new Date(user.lock_until) > new Date();
  if (!user || user.status !== 'active' || locked || !await bcrypt.compare(req.body.password, user.password_hash)) {
    if (user) {
      await getPool().query(
        `UPDATE users SET login_attempts = CASE WHEN login_attempts + 1 >= 5 THEN 0 ELSE login_attempts + 1 END,
         lock_until = CASE WHEN login_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE lock_until END,
         updated_at = NOW() WHERE id = $1`, [user.id],
      );
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  await getPool().query('UPDATE users SET login_attempts=0, lock_until=NULL, updated_at=NOW() WHERE id=$1', [user.id]);
  const tokens = await issue(user);
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
  const csrf = csrfToken();
  res.cookie('csrfToken', csrf, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: process.env.COOKIE_SAME_SITE || 'lax', path: '/' });
  return response(res, { user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrfToken: csrf }, 'Logged in');
};

exports.refresh = async (req, res) => {
  const raw = req.cookies.refreshToken;
  if (!raw) return res.status(401).json({ success: false, message: 'Refresh token required' });
  const client = await getPool().connect();
  try {
    const payload = jwt.verify(raw, process.env.REFRESH_TOKEN_SECRET);
    await client.query('BEGIN');
    const { rows: [stored] } = await client.query('SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE', [hashToken(raw)]);
    if (!stored || stored.revoked_at) {
      await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE family_id=$1', [payload.familyId]);
      await client.query('COMMIT');
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Refresh token reuse detected' });
    }
    const { rows: [user] } = await client.query('SELECT id,name,email,role,status FROM users WHERE id=$1', [payload.sub]);
    if (!user || user.status !== 'active') throw new Error('Invalid account');
    await client.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE id=$1', [stored.id]);
    const next = await issue(user, payload.familyId, client);
    await client.query('UPDATE refresh_tokens SET replaced_by_hash=$1 WHERE id=$2', [hashToken(next.refreshToken), stored.id]);
    await client.query('COMMIT');
    setAuthCookies(res, next.accessToken, next.refreshToken);
    return response(res, { csrfToken: req.cookies.csrfToken }, 'Token refreshed');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    clearAuthCookies(res);
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  } finally { client.release(); }
};

exports.logout = async (req, res) => {
  const raw = req.cookies.refreshToken;
  if (raw) {
    try {
      const payload = jwt.verify(raw, process.env.REFRESH_TOKEN_SECRET);
      await getPool().query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE family_id=$1', [payload.familyId]);
    } catch {
      await getPool().query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,NOW()) WHERE token_hash=$1', [hashToken(raw)]);
    }
  }
  clearAuthCookies(res);
  res.clearCookie('csrfToken', { path: '/' });
  return response(res, null, 'Logged out');
};

exports.me = async (req, res) => response(res, { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });

exports.changePassword = async (req, res) => {
  const { rows: [user] } = await getPool().query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(req.body.currentPassword, user.password_hash)) return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  await getPool().query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [passwordHash, req.user.id]);
  await getPool().query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [req.user.id]);
  return response(res, null, 'Password changed');
};

exports.forgot = async (req, res) => {
  const { rows: [user] } = await getPool().query('SELECT id FROM users WHERE email=$1', [req.body.email.toLowerCase()]);
  let data;
  if (user) {
    const raw = crypto.randomBytes(32).toString('hex');
    await getPool().query('UPDATE users SET password_reset_hash=$1,password_reset_expires=NOW()+INTERVAL \'1 hour\' WHERE id=$2', [hashToken(raw), user.id]);
    if (process.env.NODE_ENV !== 'production') data = { resetToken: raw };
  }
  return response(res, data, 'If the account exists, reset instructions have been sent');
};

exports.reset = async (req, res) => {
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const { rows: [user] } = await getPool().query(
    `UPDATE users SET password_hash=$1,password_reset_hash=NULL,password_reset_expires=NULL,updated_at=NOW()
     WHERE password_reset_hash=$2 AND password_reset_expires>NOW() RETURNING id`,
    [passwordHash, hashToken(req.body.token)],
  );
  if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
  await getPool().query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
  return response(res, null, 'Password reset');
};

exports.verifyEmail = async (req, res) => {
  const { rowCount } = await getPool().query('UPDATE users SET email_verified=TRUE,email_verification_hash=NULL,updated_at=NOW() WHERE email_verification_hash=$1', [hashToken(req.body.token)]);
  if (!rowCount) return res.status(400).json({ success: false, message: 'Invalid verification token' });
  return response(res, null, 'Email verified');
};

exports.resendVerification = async (req, res) => {
  const { rows: [user] } = await getPool().query('SELECT id FROM users WHERE email=$1 AND email_verified=FALSE', [req.body.email.toLowerCase()]);
  let data;
  if (user) {
    const raw = crypto.randomBytes(32).toString('hex');
    await getPool().query('UPDATE users SET email_verification_hash=$1 WHERE id=$2', [hashToken(raw), user.id]);
    if (process.env.NODE_ENV !== 'production') data = { verificationToken: raw };
  }
  return response(res, data, 'If the account requires verification, instructions have been sent');
};
