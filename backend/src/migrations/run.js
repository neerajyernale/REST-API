require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool } = require('../config/database');
const { getEnv } = require('../config/environment');

async function migrate() {
  getEnv();
  const pool = getPool();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '001_initial.sql'), 'utf8');
    await pool.query(sql);
    console.log('PostgreSQL schema is ready.');
  } finally {
    await pool.end();
  }
}

migrate().catch(error => {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
});
