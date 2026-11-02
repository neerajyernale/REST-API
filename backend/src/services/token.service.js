const crypto = require('crypto');
const { getPool } = require('../config/database');
const { signAccess, signRefresh, hashToken } = require('../utils/generateTokens');

async function issue(user, familyId = crypto.randomUUID(), executor = getPool()) {
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user, familyId);
  await executor.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
    [user.id, hashToken(refreshToken), familyId],
  );
  return { accessToken, refreshToken, familyId };
}

module.exports = { issue };
