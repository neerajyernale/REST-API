module.exports=(err,req,res,next)=>{
  const status=err.statusCode||(err.code==='23505'?409:['23503','23514','22P02','22003'].includes(err.code)?422:err.name==='MulterError'?400:err.message&&err.message.startsWith('Only ')?400:500);
  const message=status===500?'Internal server error':err.code==='23505'?'A record with these unique fields already exists':err.message;
  res.status(status).json({success:false,message,errors:err.errors||[]});
};
