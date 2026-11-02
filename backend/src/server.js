require('dotenv').config();
const { getEnv } = require('./config/environment');
const { connectDatabase } = require('./config/database');
const app = require('./app');
const env = getEnv();

connectDatabase(env.DATABASE_URL)
  .then(() => app.listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`)))
  .catch(error => { console.error(`PostgreSQL connection failed: ${error.message}`); process.exit(1); });
