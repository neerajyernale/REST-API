require('dotenv').config();
const {getEnv}=require('../config/environment');
const {getPool}=require('../config/database');
const rows=[
 ['Samsung Galaxy S24','Samsung','Mobiles',79999,69999,'8GB RAM, 256GB storage'],['iPhone 15','Apple','Mobiles',79900,72900,'128GB storage, OLED'],['Pixel 8a','Google','Mobiles',52999,45999,'8GB RAM, 128GB storage'],['OnePlus 12R','OnePlus','Mobiles',45999,39999,'16GB RAM, 256GB storage'],['Redmi Note 13 Pro','Xiaomi','Mobiles',31999,27999,'8GB RAM, 256GB storage'],['Galaxy A55','Samsung','Mobiles',42999,36999,'8GB RAM, AMOLED'],['iPhone 14','Apple','Mobiles',69900,59900,'128GB storage'],['Nord CE4','OnePlus','Mobiles',29999,24999,'8GB RAM, 128GB storage'],
 ['MacBook Air M3','Apple','Laptops',134900,124900,'16GB RAM, 512GB SSD'],['Dell Inspiron 14','Dell','Laptops',78990,67990,'16GB RAM, 512GB SSD'],['HP Pavilion Plus','HP','Laptops',89990,76990,'OLED, 16GB RAM'],['Lenovo IdeaPad Slim 5','Lenovo','Laptops',72990,62990,'16GB RAM, 512GB SSD'],['ASUS Vivobook 15','ASUS','Laptops',59990,49990,'16GB RAM, 512GB SSD'],['Acer Swift Go 14','Acer','Laptops',84990,72990,'OLED, 16GB RAM'],['Surface Laptop Go','Microsoft','Laptops',79999,69999,'12.4 inch touchscreen'],
 ['Logitech MX Master 3S','Logitech','Accessories',9995,8495,'Wireless ergonomic mouse'],['Sony WH-1000XM5','Sony','Electronics',29990,24990,'Noise cancelling headphones'],['JBL Flip 6','JBL','Electronics',14999,11999,'Portable Bluetooth speaker'],['Samsung 55 inch QLED TV','Samsung','Electronics',89990,74990,'4K QLED smart TV'],['Sony Bravia 43 inch','Sony','Electronics',69990,59990,'4K Google TV'],['boAt Airdopes 141','boAt','Accessories',2490,1299,'Wireless earbuds'],['Anker 20W Charger','Anker','Accessories',1999,1499,'USB-C fast charger'],
 ['Levis 511 Jeans','Levis','Fashion',3999,2999,'Slim fit stretch denim'],['Nike Revolution 7','Nike','Fashion',4995,3995,'Road running shoes'],['Puma Essentials Hoodie','Puma','Fashion',3499,2799,'Cotton fleece hoodie'],['Adidas Classic Backpack','Adidas','Fashion',2999,2199,'21 litre backpack'],['Prestige Induction Cooktop','Prestige','Home Appliances',4995,3495,'1600W induction cooktop'],['Philips Air Fryer','Philips','Home Appliances',12995,9995,'4.1 litre air fryer'],['Dyson V8 Vacuum','Dyson','Home Appliances',45900,39900,'Cordless vacuum cleaner'],['Havells Mixer Grinder','Havells','Home Appliances',6995,5495,'750W, 3 jars'],
];
const slug=s=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
async function seed(){
  getEnv();const db=getPool();
  try{
    const {rows:[seller]}=await db.query("SELECT id FROM users WHERE role IN ('ADMIN','SELLER') AND status='active' ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END LIMIT 1");
    if(!seller)throw new Error('Create an admin or seller account first (npm run seed:accounts)');
    const categoryIds={};
    for(const name of [...new Set(rows.map(row=>row[2]))]){
      const {rows:[category]}=await db.query(`INSERT INTO categories(name,slug,description) VALUES($1,$2,$3)
        ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[name,slug(name),`${name} products`]);
      categoryIds[name]=category.id;
    }
    for(const [index,[name,brand,category,originalPrice,sellingPrice,specification]] of rows.entries()){
      const images=[
        {id:`seed-${index+1}-1`,url:`https://placehold.co/640x640?text=${encodeURIComponent(name)}`,publicId:null},
        {id:`seed-${index+1}-2`,url:`https://placehold.co/640x640?text=${encodeURIComponent(brand)}`,publicId:null},
      ];
      await db.query(`INSERT INTO products(name,slug,brand,category_id,short_description,description,images,thumbnail,original_price,selling_price,discount,stock,sku,specifications,features,seller_id,featured)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,25,$12,$13::jsonb,$14::jsonb,$15,$16)
        ON CONFLICT(sku) DO NOTHING`,[
        name,slug(name),brand,categoryIds[category],`${brand} ${name}`,`Shop ${name} by ${brand}. Quality assured, ready to ship.`,JSON.stringify(images),JSON.stringify(images[0]),originalPrice,sellingPrice,Math.round((originalPrice-sellingPrice)/originalPrice*100),`SEED-${String(index+1).padStart(3,'0')}`,JSON.stringify({Details:spec}),JSON.stringify([spec]),seller.id,index<6,
      ]);
    }
    console.log(`Seeded ${rows.length} PostgreSQL products across ${Object.keys(categoryIds).length} categories.`);
  }finally{await db.end()}
}
seed().catch(error=>{console.error(`Product seeding failed: ${error.message}`);process.exitCode=1});
