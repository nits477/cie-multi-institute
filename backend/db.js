const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not configured. Database-backed routes will be unavailable.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params)
};
