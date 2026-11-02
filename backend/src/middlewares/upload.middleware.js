const multer=require('multer'); const path=require('path'); const fs=require('fs');
// Vercel's function bundle is read-only; only /tmp is writable at runtime.
const defaultDir=process.env.VERCEL?'/tmp/uploads':'uploads';
const dir=path.resolve(process.env.UPLOAD_DIR||defaultDir); fs.mkdirSync(dir,{recursive:true});
module.exports=multer({storage:multer.diskStorage({destination:dir,filename:(req,file,cb)=>cb(null,`${Date.now()}-${require('crypto').randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)}),limits:{fileSize:5*1024*1024,files:8},fileFilter:(req,file,cb)=>{if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype))return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));cb(null,true)}});
