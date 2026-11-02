const jwt=require('jsonwebtoken'); const crypto=require('crypto');
function signAccess(user, env=process.env){return jwt.sign({sub:String(user.id||user._id),role:user.role},env.ACCESS_TOKEN_SECRET,{expiresIn:env.ACCESS_TOKEN_EXPIRY||'15m'});}
function signRefresh(user, familyId, env=process.env){return jwt.sign({sub:String(user.id||user._id),familyId,jti:crypto.randomUUID()},env.REFRESH_TOKEN_SECRET,{expiresIn:env.REFRESH_TOKEN_EXPIRY||'7d'});}
module.exports={signAccess,signRefresh,hashToken:value=>crypto.createHash('sha256').update(value).digest('hex'),csrfToken:()=>crypto.randomBytes(32).toString('hex')};
