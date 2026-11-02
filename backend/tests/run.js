require('dotenv').config();
const assert=require('node:assert').strict;
const fs=require('fs');
const path=require('path');
const request=require('supertest');

let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed+=1;process.stdout.write(`PASS ${name}\n`)}
  catch(error){failed+=1;process.stderr.write(`FAIL ${name}\n${error.stack||error}\n`)}
  finally{if(globalThis.pool)await pool.query('TRUNCATE reviews,cart_items,carts,refresh_tokens,products,categories,users RESTART IDENTITY CASCADE')}
}
function assertTestDatabase(uri){
  if(!uri)throw new Error('TEST_DATABASE_URL is required. Configure a separate PostgreSQL database for tests.');
  const dbName=new URL(uri).pathname.replace(/^\//,'').split('/')[0];
  if(!/(^|[_-])test($|[_-])/i.test(dbName))throw new Error('Refusing to run tests: TEST_DATABASE_URL database name must include "test".');
}

async function main(){
  const testUrl=process.env.TEST_DATABASE_URL;
  assertTestDatabase(testUrl);
  process.env.DATABASE_URL=testUrl;
  process.env.NODE_ENV='test';
  process.env.CLIENT_URL='http://localhost:4200';
  process.env.ACCESS_TOKEN_SECRET='a'.repeat(40);
  process.env.REFRESH_TOKEN_SECRET='b'.repeat(40);
  process.env.CSRF_SECRET='c'.repeat(40);
  process.env.ACCESS_TOKEN_EXPIRY='15m';
  process.env.REFRESH_TOKEN_EXPIRY='7d';
  process.env.COOKIE_SAME_SITE='lax';

  const {getPool}=require('../src/config/database');
  globalThis.pool=getPool(testUrl);
  const sql=fs.readFileSync(path.join(__dirname,'../src/migrations/001_initial.sql'),'utf8');
  await pool.query(sql);
  await pool.query('TRUNCATE reviews,cart_items,carts,refresh_tokens,products,categories,users RESTART IDENTITY CASCADE');
  const app=require('../src/app');

  await test('signup, login, current user, and invalid credentials',async()=>{
    const agent=request.agent(app);
    const signup=await agent.post('/api/v1/auth/signup').send({name:'Customer One',email:'one@example.com',password:'Password123!'});
    assert.equal(signup.status,201);
    const bad=await agent.post('/api/v1/auth/login').send({email:'one@example.com',password:'incorrect'});
    assert.equal(bad.status,401);
    const login=await agent.post('/api/v1/auth/login').send({email:'one@example.com',password:'Password123!'});
    assert.equal(login.status,200);assert.ok(login.body.data.csrfToken);
    assert.ok(login.headers['set-cookie'].some(cookie=>cookie.includes('HttpOnly')));
    const me=await agent.get('/api/v1/auth/me');assert.equal(me.status,200);assert.equal(me.body.data.email,'one@example.com');
  });

  await test('product creation rejects anonymous callers and customers',async()=>{
    const anonymous=await request(app).post('/api/v1/products').send({});assert.equal(anonymous.status,401);
    const agent=request.agent(app);
    await agent.post('/api/v1/auth/signup').send({name:'Customer',email:'customer@example.com',password:'Password123!'});
    const validLogin=await agent.post('/api/v1/auth/login').send({email:'customer@example.com',password:'Password123!'});
    const response=await agent.post('/api/v1/products').set('X-CSRF-Token',validLogin.body.data.csrfToken).send({});
    assert.equal(response.status,403);
  });

  await test('product listing supports search and pagination metadata',async()=>{
    const {rows:[seller]}=await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES('Seller','seller@example.com','unused','SELLER') RETURNING id");
    const {rows:[category]}=await pool.query("INSERT INTO categories(name,slug) VALUES('Mobiles','mobiles') RETURNING id");
    await pool.query(`INSERT INTO products(name,slug,brand,category_id,short_description,description,original_price,selling_price,stock,sku,seller_id)
      VALUES('Search Phone','search-phone','Brand',$1,'phone','smart mobile',1000,800,3,'T-1',$2)`,[category.id,seller.id]);
    const response=await request(app).get('/api/v1/products?search=mobile&page=1&limit=1');
    assert.equal(response.status,200);assert.equal(response.body.data.length,1);
    assert.deepEqual({currentPage:response.body.pagination.currentPage,limit:response.body.pagination.limit,totalProducts:response.body.pagination.totalProducts,hasNextPage:response.body.pagination.hasNextPage},{currentPage:1,limit:1,totalProducts:1,hasNextPage:false});
  });

  await test('refresh rotates tokens and logout revokes the session',async()=>{
    await request(app).post('/api/v1/auth/signup').send({name:'Customer',email:'refresh@example.com',password:'Password123!'});
    const agent=request.agent(app);const login=await agent.post('/api/v1/auth/login').send({email:'refresh@example.com',password:'Password123!'});
    const refreshed=await agent.post('/api/v1/auth/refresh-token').set('X-CSRF-Token',login.body.data.csrfToken);
    assert.equal(refreshed.status,200);assert.ok(refreshed.headers['set-cookie']);
    const logout=await agent.post('/api/v1/auth/logout').set('X-CSRF-Token',login.body.data.csrfToken);assert.equal(logout.status,200);
    const {rows:[token]}=await pool.query('SELECT revoked_at FROM refresh_tokens LIMIT 1');assert.ok(token.revoked_at);
  });

  await test('customer cart rejects quantities above stock',async()=>{
    await request(app).post('/api/v1/auth/signup').send({name:'Customer',email:'cart@example.com',password:'Password123!'});
    const {rows:[user]}=await pool.query("SELECT id FROM users WHERE email='cart@example.com'");
    const {rows:[category]}=await pool.query("INSERT INTO categories(name,slug) VALUES('Mobiles','mobiles') RETURNING id");
    const {rows:[product]}=await pool.query(`INSERT INTO products(name,slug,brand,category_id,short_description,description,original_price,selling_price,stock,sku,seller_id)
      VALUES('Phone','phone','Brand',$1,'phone','phone',10,8,2,'P-1',$2) RETURNING id`,[category.id,user.id]);
    const agent=request.agent(app);const login=await agent.post('/api/v1/auth/login').send({email:'cart@example.com',password:'Password123!'});
    const response=await agent.post('/api/v1/cart/add').set('X-CSRF-Token',login.body.data.csrfToken).send({productId:product.id,quantity:3});
    assert.equal(response.status,422);
  });

  await test('review creation enforces one review per customer and updates product rating',async()=>{
    await request(app).post('/api/v1/auth/signup').send({name:'Reviewer',email:'review@example.com',password:'Password123!'});
    const {rows:[user]}=await pool.query("SELECT id FROM users WHERE email='review@example.com'");
    const {rows:[category]}=await pool.query("INSERT INTO categories(name,slug) VALUES('Mobiles','mobiles') RETURNING id");
    const {rows:[product]}=await pool.query(`INSERT INTO products(name,slug,brand,category_id,short_description,description,original_price,selling_price,stock,sku,seller_id)
      VALUES('Phone','phone','Brand',$1,'phone','phone',10,8,3,'P-2',$2) RETURNING id`,[category.id,user.id]);
    const agent=request.agent(app);const login=await agent.post('/api/v1/auth/login').send({email:'review@example.com',password:'Password123!'});
    const review=await agent.post('/api/v1/reviews').set('X-CSRF-Token',login.body.data.csrfToken).send({productId:product.id,rating:5,comment:'Good'});
    assert.equal(review.status,201);
    const duplicate=await agent.post('/api/v1/reviews').set('X-CSRF-Token',login.body.data.csrfToken).send({productId:product.id,rating:4});assert.equal(duplicate.status,409);
    const {rows:[rating]}=await pool.query('SELECT average_rating::float8 AS average,total_reviews AS count FROM products WHERE id=$1',[product.id]);
    assert.deepEqual(rating,{average:5,count:1});
  });

  await pool.end();globalThis.pool=null;
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if(failed)process.exitCode=1;
}

main().catch(async error=>{process.stderr.write(`${error.stack||error}\n`);if(globalThis.pool)await pool.end().catch(()=>{});process.exitCode=1});
