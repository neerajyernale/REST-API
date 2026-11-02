const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const productSchema = require('../validators/product.validator');
const { getPool } = require('../config/database');
const cloudinary = require('../config/cloudinary');

function slugify(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
const select = `SELECT p.id,p.name,p.slug,p.brand,p.category_id AS "categoryId",c.name AS "categoryName",c.slug AS "categorySlug",
 p.subcategory,p.short_description AS "shortDescription",p.description,p.images,p.thumbnail,
 p.original_price::float8 AS "originalPrice",p.selling_price::float8 AS "sellingPrice",p.discount::float8 AS discount,
 p.stock,p.sku,p.specifications,p.features,p.colors,p.sizes,p.average_rating::float8 AS "averageRating",
 p.total_reviews AS "totalReviews",p.status,p.featured,p.seller_id AS "sellerId",p.created_at AS "createdAt",p.updated_at AS "updatedAt"
 FROM products p JOIN categories c ON c.id=p.category_id`;
function present(row) {
  if (!row) return row;
  const { categoryId, categoryName, categorySlug, ...rest } = row;
  return { ...rest, category: { id: categoryId, name: categoryName, slug: categorySlug } };
}

async function insertProduct(client, input, sellerId) {
  const value = (key, fallback) => input[key] === undefined ? fallback : input[key];
  const { rows: [row] } = await client.query(
    `INSERT INTO products (name,slug,brand,category_id,subcategory,short_description,description,images,thumbnail,
      original_price,selling_price,discount,stock,sku,specifications,features,colors,sizes,status,featured,seller_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$21)
     RETURNING id`,
    [input.name, input.slug || slugify(input.name), input.brand, input.category, value('subcategory', null), input.shortDescription,
      input.description, JSON.stringify(value('images', [])), JSON.stringify(value('thumbnail', null)), input.originalPrice,
      input.sellingPrice, value('discount', input.originalPrice ? Math.max(0, Math.round((input.originalPrice-input.sellingPrice)/input.originalPrice*100)) : 0),
      value('stock', 0), input.sku, JSON.stringify(value('specifications', {})), JSON.stringify(value('features', [])),
      JSON.stringify(value('colors', [])), JSON.stringify(value('sizes', [])), value('status', 'active'), value('featured', false), sellerId],
  );
  const result = await client.query(`${select} WHERE p.id=$1`, [row.id]);
  return present(result.rows[0]);
}

exports.list = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const where = ['p.deleted_at IS NULL', "p.status='active'"];
  const params = [];
  const add = (condition, value) => { params.push(value); where.push(condition.replace('?', `$${params.length}`)); };
  if (req.query.category) {
    const { rows: [category] } = await getPool().query('SELECT id FROM categories WHERE slug=$1 OR id::text=$1 LIMIT 1', [req.query.category]);
    if (!category) return res.json({ success: true, message: 'Products fetched successfully', data: [], pagination: { currentPage: page, totalPages: 0, totalProducts: 0, limit, hasNextPage: false, hasPreviousPage: page > 1 } });
    add('p.category_id=?', category.id);
  }
  if (req.query.minPrice !== undefined) {
    const value = Number(req.query.minPrice); if (!Number.isFinite(value) || value < 0) return res.status(400).json({ success: false, message: 'minPrice must be a non-negative number' });
    add('p.selling_price>=?', value);
  }
  if (req.query.maxPrice !== undefined) {
    const value = Number(req.query.maxPrice); if (!Number.isFinite(value) || value < 0) return res.status(400).json({ success: false, message: 'maxPrice must be a non-negative number' });
    add('p.selling_price<=?', value);
  }
  if (req.query.search) {
    params.push(`%${String(req.query.search).slice(0, 100)}%`);
    const p = `$${params.length}`;
    where.push(`(p.name ILIKE ${p} OR p.brand ILIKE ${p} OR p.short_description ILIKE ${p} OR p.description ILIKE ${p})`);
  }
  if (req.query.featured === 'true') where.push('p.featured=TRUE');
  const sortFields = { price: 'p.selling_price', rating: 'p.average_rating', popularity: 'p.total_reviews', date: 'p.created_at' };
  const sortField = sortFields[req.query.sortBy] || 'p.created_at';
  const order = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const condition = where.join(' AND ');
  const count = await getPool().query(`SELECT COUNT(*)::int AS total FROM products p WHERE ${condition}`, params);
  const totalProducts = count.rows[0].total;
  const offset = (page - 1) * limit;
  const rows = await getPool().query(`${select} WHERE ${condition} ORDER BY ${sortField} ${order} LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]);
  res.json({ success: true, message: 'Products fetched successfully', data: rows.rows.map(present), pagination: { currentPage: page, totalPages: Math.ceil(totalProducts/limit), totalProducts, limit, hasNextPage: page*limit<totalProducts, hasPreviousPage: page>1 } });
};

exports.get = async (req, res) => {
  const key = req.params.id || req.params.slug;
  const { rows: [row] } = await getPool().query(`${select} WHERE p.deleted_at IS NULL AND (p.id::text=$1 OR p.slug=$1)`, [key]);
  if (!row) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, message: 'Product fetched successfully', data: present(row) });
};

exports.featured = async (req, res) => {
  const { rows } = await getPool().query(`${select} WHERE p.featured=TRUE AND p.status='active' AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 20`);
  res.json({ success: true, message: 'Featured products fetched successfully', data: rows.map(present) });
};

exports.create = async (req, res) => {
  const product = await insertProduct(getPool(), req.body, req.user.id);
  return res.status(201).json({ success: true, message: 'Product created successfully', data: product });
};

exports.bulk = async (req, res) => {
  if (!Array.isArray(req.body) || req.body.length === 0 || req.body.length > 100) return res.status(422).json({ success: false, message: 'Provide between 1 and 100 products' });
  const prepared = req.body.map((item, index) => {
    const { error, value } = productSchema.validate(item, { stripUnknown: true });
    if (error) throw Object.assign(new Error(`Product ${index + 1}: ${error.details[0].message}`), { statusCode: 422 });
    return value;
  });
  const client = await getPool().connect();
  try { await client.query('BEGIN'); const data = []; for (const item of prepared) data.push(await insertProduct(client, item, req.user.id)); await client.query('COMMIT'); return res.status(201).json({ success: true, message: 'Products created successfully', data }); }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

async function updateProduct(req, res, replace) {
  const q = 'SELECT * FROM products WHERE id::text=$1 AND deleted_at IS NULL' + (req.user.role === 'SELLER' ? ' AND seller_id=$2' : '');
  const values = req.user.role === 'SELLER' ? [req.params.id, req.user.id] : [req.params.id];
  const { rows: [existing] } = await getPool().query(q, values);
  if (!existing) { res.status(404).json({ success: false, message: 'Product not found' }); return; }
  const body = { ...req.body };
  delete body.seller; delete body.averageRating; delete body.totalReviews;
  if (replace) {
    for (const key of ['name','brand','category','shortDescription','description','originalPrice','sellingPrice','stock','sku']) {
      if (body[key] === undefined) { res.status(422).json({ success: false, message: `${key} is required` }); return; }
    }
    for (const [key, fallback] of Object.entries({ subcategory: null, images: [], thumbnail: null, discount: 0, specifications: {}, features: [], colors: [], sizes: [], status: 'active', featured: false })) if (body[key] === undefined) body[key] = fallback;
  }
  const columns = { name:'name', slug:'slug', brand:'brand', category:'category_id', subcategory:'subcategory', shortDescription:'short_description', description:'description', images:'images', thumbnail:'thumbnail', originalPrice:'original_price', sellingPrice:'selling_price', discount:'discount', stock:'stock', sku:'sku', specifications:'specifications', features:'features', colors:'colors', sizes:'sizes', status:'status', featured:'featured' };
  const sets = [], params = [];
  for (const [key, value] of Object.entries(body)) {
    if (!columns[key]) continue;
    params.push(['images','thumbnail','specifications','features','colors','sizes'].includes(key) ? JSON.stringify(value) : value);
    sets.push(`${columns[key]}=$${params.length}${['images','thumbnail','specifications','features','colors','sizes'].includes(key) ? '::jsonb' : ''}`);
  }
  if (body.name && body.slug === undefined) { params.push(slugify(body.name)); sets.push(`slug=$${params.length}`); }
  params.push(req.params.id);
  const sellerCondition = req.user.role === 'SELLER' ? ` AND seller_id=$${params.push(req.user.id)}` : '';
  const sql = `UPDATE products SET ${sets.join(',')},updated_at=NOW() WHERE id::text=$${params.length-(sellerCondition ? 1 : 0)} AND deleted_at IS NULL${sellerCondition} RETURNING id`;
  await getPool().query(sql, params);
  const { rows: [row] } = await getPool().query(`${select} WHERE p.id::text=$1`, [req.params.id]);
  if (body.originalPrice !== undefined || body.sellingPrice !== undefined) {
    const originalPrice = body.originalPrice ?? existing.original_price;
    const sellingPrice = body.sellingPrice ?? existing.selling_price;
    const discount = originalPrice ? Math.max(0, Math.round((originalPrice-sellingPrice)/originalPrice*100)) : 0;
    await getPool().query('UPDATE products SET discount=$1,updated_at=NOW() WHERE id=$2', [discount, req.params.id]);
    row.discount = discount;
  }
  return row;
}

exports.replace = async (req, res) => { const row = await updateProduct(req, res, true); if (row) res.json({ success: true, message: 'Product replaced successfully', data: present(row) }); };
exports.patch = async (req, res) => { const row = await updateProduct(req, res, false); if (row) res.json({ success: true, message: 'Product updated successfully', data: present(row) }); };

exports.updateStock = async (req, res) => {
  const params = [req.params.id, req.body.stock];
  const sellerCondition = req.user.role === 'SELLER' ? ` AND seller_id=$${params.push(req.user.id)}` : '';
  const { rowCount } = await getPool().query(`UPDATE products SET stock=$2,updated_at=NOW() WHERE id::text=$1 AND deleted_at IS NULL${sellerCondition}`, params);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Product not found' });
  const { rows: [row] } = await getPool().query(`${select} WHERE p.id::text=$1`, [req.params.id]);
  res.json({ success: true, message: 'Stock updated', data: present(row) });
};

exports.remove = async (req, res) => {
  const params = [req.params.id];
  const sellerCondition = req.user.role === 'SELLER' ? ` AND seller_id=$${params.push(req.user.id)}` : '';
  const { rowCount } = await getPool().query(`UPDATE products SET status='archived',deleted_at=NOW(),updated_at=NOW() WHERE id::text=$1${sellerCondition}`, params);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, message: 'Product archived successfully', data: null });
};

exports.upload = async (req, res) => {
  const productResult = await getPool().query('SELECT id,seller_id,images,thumbnail FROM products WHERE id::text=$1 AND deleted_at IS NULL', [req.params.id]);
  const product = productResult.rows[0];
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (req.user.role === 'SELLER' && product.seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Forbidden' });
  const images = [];
  for (const file of req.files || []) {
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const uploaded = await cloudinary.uploader.upload(file.path, { folder: 'products', resource_type: 'image' });
      images.push({ id: crypto.randomUUID(), url: uploaded.secure_url, publicId: uploaded.public_id });
      fs.unlinkSync(file.path);
    } else {
      images.push({ id: crypto.randomUUID(), url: `${req.protocol}://${req.get('host')}/uploads/${file.filename}`, publicId: file.filename });
    }
  }
  const nextImages = [...(product.images || []), ...images];
  const thumbnail = product.thumbnail || images[0] || null;
  await getPool().query('UPDATE products SET images=$1::jsonb,thumbnail=$2::jsonb,updated_at=NOW() WHERE id=$3', [JSON.stringify(nextImages), JSON.stringify(thumbnail), product.id]);
  res.status(201).json({ success: true, message: 'Images uploaded', data: nextImages });
};

exports.deleteImage = async (req, res) => {
  const { rows: [product] } = await getPool().query('SELECT id,seller_id,images,thumbnail FROM products WHERE id::text=$1', [req.params.id]);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
  if (req.user.role === 'SELLER' && product.seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Forbidden' });
  const target = (product.images || []).find(image => image.id === req.params.imageId);
  if (!target) return res.status(404).json({ success: false, message: 'Image not found' });
  if (target.publicId && process.env.CLOUDINARY_CLOUD_NAME) await cloudinary.uploader.destroy(target.publicId);
  else if (target.publicId) { try { fs.unlinkSync(path.join(process.env.UPLOAD_DIR || 'uploads', path.basename(target.publicId))); } catch {} }
  const images = product.images.filter(image => image.id !== target.id);
  const thumbnail = product.thumbnail?.id === target.id ? (images[0] || null) : product.thumbnail;
  await getPool().query('UPDATE products SET images=$1::jsonb,thumbnail=$2::jsonb,updated_at=NOW() WHERE id=$3', [JSON.stringify(images), JSON.stringify(thumbnail), product.id]);
  return res.json({ success: true, message: 'Image deleted', data: images });
};
