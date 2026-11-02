function baseOptions(env=process.env){ return { httpOnly:true, secure:env.NODE_ENV==='production', sameSite:env.COOKIE_SAME_SITE||'lax', path:'/api/v1/auth' }; }
function setAuthCookies(res, access, refresh, env=process.env){ const base=baseOptions(env); res.cookie('accessToken',access,{...base,path:'/api/v1',maxAge:15*60*1000}); res.cookie('refreshToken',refresh,{...base,path:'/api/v1/auth',maxAge:7*24*60*60*1000}); }
function clearAuthCookies(res, env=process.env){ const base=baseOptions(env); res.clearCookie('accessToken',{...base,path:'/api/v1'}); res.clearCookie('refreshToken',{...base,path:'/api/v1/auth'}); }
module.exports={baseOptions,setAuthCookies,clearAuthCookies};
