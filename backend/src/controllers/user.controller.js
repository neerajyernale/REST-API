const { getPool } = require('../config/database');
exports.list=async(req,res)=>{
  const {rows}=await getPool().query('SELECT id,name,email,role,status,created_at AS "createdAt" FROM users ORDER BY created_at DESC');
  return res.json({success:true,message:'Users fetched',data:rows});
};
exports.updateMe=async(req,res)=>{
  if(typeof req.body.name!=='string'||req.body.name.trim().length<2||req.body.name.length>100)return res.status(422).json({success:false,message:'Name must be between 2 and 100 characters'});
  const {rows:[user]}=await getPool().query('UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role',[req.body.name.trim(),req.user.id]);
  return res.json({success:true,message:'Profile updated',data:user});
};
exports.setStatus=async(req,res)=>{
  if(!['active','inactive','locked'].includes(req.body.status))return res.status(422).json({success:false,message:'Invalid status'});
  const {rows:[user]}=await getPool().query('UPDATE users SET status=$1,updated_at=NOW() WHERE id::text=$2 RETURNING id,name,email,role,status',[req.body.status,req.params.id]);
  if(!user)return res.status(404).json({success:false,message:'User not found'});
  return res.json({success:true,message:'User updated',data:user});
};
exports.setRole=async(req,res)=>{
  if(!['ADMIN','SELLER','CUSTOMER'].includes(req.body.role))return res.status(422).json({success:false,message:'Invalid role'});
  const {rows:[user]}=await getPool().query('UPDATE users SET role=$1,updated_at=NOW() WHERE id::text=$2 RETURNING id,name,email,role,status',[req.body.role,req.params.id]);
  if(!user)return res.status(404).json({success:false,message:'User not found'});
  return res.json({success:true,message:'User role updated',data:user});
};
