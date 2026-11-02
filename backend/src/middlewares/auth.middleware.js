const jwt = require('jsonwebtoken');
const { getPool } = require('../config/database');

module.exports = async function auth(req, res, next) {
  try {
    const token = req.cookies.accessToken || ((req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required' });
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const { rows: [user] } = await getPool().query('SELECT id,name,email,role,status FROM users WHERE id=$1', [payload.sub]);
    if (!user || user.status !== 'active') return res.status(401).json({ success: false, message: 'Account unavailable' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired access token' });
  }
};
