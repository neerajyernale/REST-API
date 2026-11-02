const { getPool } = require('../config/database');
const slugify = value => value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const columns = { name:'name', slug:'slug', description:'description', image:'image', parent:'parent_id', status:'status' };
const select = `SELECT c.id,c.name,c.slug,c.description,c.image,c.parent_id AS "parentId",c.status,c.created_at AS "createdAt",c.updated_at AS "updatedAt",
 jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug) AS parent FROM categories c LEFT JOIN categories p ON p.id=c.parent_id`;

exports.list = async (req,res) => {
  const where = req.query.all === 'true' ? '' : " WHERE c.status='active'";
  const { rows } = await getPool().query(`${select}${where} ORDER BY c.name`);
  return res.json({ success:true,message:'Categories fetched',data:rows });
};
exports.get = async (req,res) => {
  const { rows:[category] } = await getPool().query(`${select} WHERE c.id::text=$1`,[req.params.id]);
  if (!category) return res.status(404).json({success:false,message:'Category not found'});
  return res.json({success:true,message:'Category fetched',data:category});
};
exports.create = async (req,res) => {
  const b=req.body;
  const { rows:[category] } = await getPool().query(
    `INSERT INTO categories(name,slug,description,image,parent_id,status) VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
    [b.name,b.slug||slugify(b.name),b.description||null,b.image?JSON.stringify(b.image):null,b.parent||null,b.status||'active'],
  );
  const result=await getPool().query(`${select} WHERE c.id=$1`,[category.id]);
  return res.status(201).json({success:true,message:'Category created',data:result.rows[0]});
};
async function update(req,res,replace){
  const {rows:[existing]}=await getPool().query('SELECT * FROM categories WHERE id::text=$1',[req.params.id]);
  if(!existing)return res.status(404).json({success:false,message:'Category not found'});
  if(replace&&(!req.body.name||!req.body.description))return res.status(422).json({success:false,message:'Name and description are required'});
  const body={...req.body};
  if(replace){for(const [key,defaultValue] of Object.entries({image:null,parent:null,status:'active'}))if(body[key]===undefined)body[key]=defaultValue}
  if(body.name&&!body.slug)body.slug=slugify(body.name);
  const params=[],sets=[];
  for(const [key,value] of Object.entries(body)){if(!columns[key])continue;params.push(key==='image'&&value!==null?JSON.stringify(value):value);sets.push(`${columns[key]}=$${params.length}${key==='image'&&value!==null?'::jsonb':''}`)}
  if(!sets.length)return res.status(422).json({success:false,message:'No editable category fields provided'});
  params.push(req.params.id);
  await getPool().query(`UPDATE categories SET ${sets.join(',')},updated_at=NOW() WHERE id::text=$${params.length}`,params);
  const {rows:[category]}=await getPool().query(`${select} WHERE c.id::text=$1`,[req.params.id]);
  return res.json({success:true,message:replace?'Category replaced':'Category updated',data:category});
}
exports.put=(req,res)=>update(req,res,true);
exports.patch=(req,res)=>update(req,res,false);
exports.remove=async(req,res)=>{
  const count=await getPool().query('SELECT 1 FROM products WHERE category_id::text=$1 AND deleted_at IS NULL LIMIT 1',[req.params.id]);
  if(count.rowCount)return res.status(409).json({success:false,message:'Move or archive products before deleting this category'});
  const result=await getPool().query('DELETE FROM categories WHERE id::text=$1 RETURNING id',[req.params.id]);
  if(!result.rowCount)return res.status(404).json({success:false,message:'Category not found'});
  return res.json({success:true,message:'Category deleted',data:null});
};
