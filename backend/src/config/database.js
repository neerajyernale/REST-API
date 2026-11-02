const { Pool } = require('pg');

let pool;
function getPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      application_name: 'angular-commerce-api',
    });
    pool.on('error', error => console.error('Unexpected PostgreSQL pool error:', error.message));
  }
  return pool;
}

async function connectDatabase(connectionString) {
  const client = await getPool(connectionString).connect();
  try { await client.query('SELECT 1'); } finally { client.release(); }
  return getPool(connectionString);
}

module.exports = { getPool, connectDatabase };
