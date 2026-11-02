const { getPool } = require('../config/database');

async function readCart(userId) {
  const { rows } = await getPool().query(
    `SELECT ci.product_id AS id,ci.quantity,p.name,p.slug,p.images,p.thumbnail,p.selling_price::float8 AS "sellingPrice",p.stock,p.status
     FROM carts c JOIN cart_items ci ON ci.cart_id=c.id JOIN products p ON p.id=ci.product_id WHERE c.user_id=$1 ORDER BY ci.created_at`,
    [userId],
  );
  const items=rows.map(row=>({product:{id:row.id,name:row.name,slug:row.slug,images:row.images,thumbnail:row.thumbnail,sellingPrice:row.sellingPrice,stock:row.stock,status:row.status},quantity:row.quantity}));
  const subtotal=items.reduce((sum,item)=>sum+item.quantity*item.product.sellingPrice,0);
  return {items,subtotal,total:subtotal};
}

exports.get=async(req,res)=>res.json({success:true,message:'Cart fetched',data:await readCart(req.user.id)});

exports.add=async(req,res)=>{
  const {productId,quantity=1}=req.body;
  const client=await getPool().connect();
  try{
    await client.query('BEGIN');
    const {rows:[product]}=await client.query("SELECT id,selling_price::float8 AS price,stock FROM products WHERE id::text=$1 AND status='active' AND deleted_at IS NULL FOR UPDATE",[productId]);
    if(!product){await client.query('ROLLBACK');return res.status(404).json({success:false,message:'Product unavailable'})}
    const {rows:[cart]}=await client.query('INSERT INTO carts(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET updated_at=NOW() RETURNING id',[req.user.id]);
    const {rows:[existing]}=await client.query('SELECT quantity FROM cart_items WHERE cart_id=$1 AND product_id=$2 FOR UPDATE',[cart.id,product.id]);
    if(quantity+(existing?.quantity||0)>product.stock){await client.query('ROLLBACK');return res.status(422).json({success:false,message:'Invalid quantity or insufficient stock'})}
    await client.query(`INSERT INTO cart_items(cart_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4)
      ON CONFLICT(cart_id,product_id) DO UPDATE SET quantity=cart_items.quantity+EXCLUDED.quantity,unit_price=EXCLUDED.unit_price,updated_at=NOW()`,[cart.id,product.id,quantity,product.price]);
    await client.query('COMMIT');
    return res.status(201).json({success:true,message:'Cart updated',data:await readCart(req.user.id)});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
};

exports.update=async(req,res)=>{
  const client=await getPool().connect();
  try{
    await client.query('BEGIN');
    const {rows:[product]}=await client.query("SELECT id,selling_price::float8 AS price,stock FROM products WHERE id::text=$1 AND status='active' AND deleted_at IS NULL FOR UPDATE",[req.params.productId]);
    if(!product||req.body.quantity>product.stock){await client.query('ROLLBACK');return res.status(422).json({success:false,message:'Invalid quantity or insufficient stock'})}
    const {rowCount}=await client.query(`UPDATE cart_items ci SET quantity=$1,unit_price=$2,updated_at=NOW() FROM carts c
      WHERE ci.cart_id=c.id AND c.user_id=$3 AND ci.product_id=$4`,[req.body.quantity,product.price,req.user.id,product.id]);
    if(!rowCount){await client.query('ROLLBACK');return res.status(404).json({success:false,message:'Cart item not found'})}
    await client.query('COMMIT');
    return res.json({success:true,message:'Cart updated',data:await readCart(req.user.id)});
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
};

exports.remove=async(req,res)=>{
  const result=await getPool().query(`DELETE FROM cart_items ci USING carts c WHERE ci.cart_id=c.id AND c.user_id=$1 AND ci.product_id::text=$2`,[req.user.id,req.params.productId]);
  if(!result.rowCount)return res.status(404).json({success:false,message:'Cart item not found'});
  return res.json({success:true,message:'Item removed',data:await readCart(req.user.id)});
};
exports.clear=async(req,res)=>{
  await getPool().query('DELETE FROM cart_items ci USING carts c WHERE ci.cart_id=c.id AND c.user_id=$1',[req.user.id]);
  return res.json({success:true,message:'Cart cleared',data:null});
};
