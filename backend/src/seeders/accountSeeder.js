require('dotenv').config();
const bcrypt=require('bcryptjs');
const {getEnv}=require('../config/environment');
const {getPool}=require('../config/database');

async function seed(){
  getEnv();
  const db=getPool();
  try{
    for(const [role,prefix] of [['ADMIN','ADMIN'],['SELLER','SELLER'],['CUSTOMER','CUSTOMER']]){
      const email=process.env[`SEED_${prefix}_EMAIL`],password=process.env[`SEED_${prefix}_PASSWORD`];
      if(!email||!password){console.log(`Skipping ${role}: set SEED_${prefix}_EMAIL and SEED_${prefix}_PASSWORD`);continue}
      const hash=await bcrypt.hash(password,12);
      await db.query(`INSERT INTO users(name,email,password_hash,role,email_verified) VALUES($1,$2,$3,$4,TRUE) ON CONFLICT(email) DO NOTHING`,[`Sample ${role.toLowerCase()}`,email.toLowerCase(),hash,role]);
      console.log(`Ensured ${role} account: ${email}`);
    }
  }finally{await db.end()}
}
seed().catch(error=>{console.error(`Account seeding failed: ${error.message}`);process.exitCode=1});
