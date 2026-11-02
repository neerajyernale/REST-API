const { getPool } = require('../config/database');
async function refresh(productId, client=getPool()) {
  await client.query(`UPDATE products p SET average_rating=stats.average,total_reviews=stats.count,updated_at=NOW()
    FROM (SELECT COALESCE(AVG(rating),0)::numeric(3,2) AS average,COUNT(*)::int AS count FROM reviews WHERE product_id=$1) stats WHERE p.id=$1`,[productId]);
}
const select=`SELECT r.id,r.product_id AS "productId",r.user_id AS "userId",r.rating,r.title,r.comment,r.created_at AS "createdAt",r.updated_at AS "updatedAt",u.name AS "userName"
 FROM reviews r JOIN users u ON u.id=r.user_id`;

exports.create=async(req,res)=>{
  const {rows:[product]}=await getPool().query("SELECT id FROM products WHERE id::text=$1 AND status='active' AND deleted_at IS NULL",[req.body.productId]);
  if(!product)return res.status(404).json({success:false,message:'Product not found'});
  try{
    const {rows:[review]}=await getPool().query('INSERT INTO reviews(product_id,user_id,rating,title,comment) VALUES($1,$2,$3,$4,$5) RETURNING id,product_id AS "productId",user_id AS "userId",rating,title,comment,created_at AS "createdAt",updated_at AS "updatedAt"',[product.id,req.user.id,req.body.rating,req.body.title||null,req.body.comment||null]);
    await refresh(product.id);
    return res.status(201).json({success:true,message:'Review created',data:review});
  }catch(error){if(error.code==='23505')return res.status(409).json({success:false,message:'You have already reviewed this product'});throw error}
};
exports.list=async(req,res)=>{
  const {rows}=await getPool().query(`${select} WHERE r.product_id::text=$1 ORDER BY r.created_at DESC`,[req.params.productId]);
  return res.json({success:true,message:'Reviews fetched',data:rows.map(({userName,...review})=>({...review,user:{name:userName}}))});
};
exports.update=async(req,res)=>{
  const {rows:[review]}=await getPool().query('SELECT id,product_id,user_id FROM reviews WHERE id::text=$1',[req.params.id]);
  if(!review)return res.status(404).json({success:false,message:'Review not found'});
  if(req.user.role!=='ADMIN'&&review.user_id!==req.user.id)return res.status(403).json({success:false,message:'Forbidden'});
  const fields={rating:'rating',title:'title',comment:'comment'},params=[],sets=[];
  for(const [key,column] of Object.entries(fields))if(req.body[key]!==undefined){params.push(req.body[key]||null);sets.push(`${column}=$${params.length}`)}
  if(!sets.length)return res.status(422).json({success:false,message:'No review fields provided'});
  params.push(req.params.id);
  const {rows:[updated]}=await getPool().query(`UPDATE reviews SET ${sets.join(',')},updated_at=NOW() WHERE id::text=$${params.length} RETURNING id,product_id AS "productId",user_id AS "userId",rating,title,comment,created_at AS "createdAt",updated_at AS "updatedAt"`,params);
  await refresh(review.product_id);
  return res.json({success:true,message:'Review updated',data:updated});
};
exports.remove=async(req,res)=>{
  const {rows:[review]}=await getPool().query('SELECT id,product_id,user_id FROM reviews WHERE id::text=$1',[req.params.id]);
  if(!review)return res.status(404).json({success:false,message:'Review not found'});
  if(req.user.role!=='ADMIN'&&review.user_id!==req.user.id)return res.status(403).json({success:false,message:'Forbidden'});
  await getPool().query('DELETE FROM reviews WHERE id=$1',[review.id]);
  await refresh(review.product_id);
  return res.json({success:true,message:'Review deleted',data:null});
};
