require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool } = require('./db');

const app = express();
const port = Number(process.env.PORT || 5000);

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((value) => value.trim())
    : false,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const response = {
    success: true,
    service: 'CIE Multi-Institute API',
    status: 'ok',
    database: 'not_configured'
  };

  if (process.env.DATABASE_URL) {
    try {
      await pool.query('SELECT 1');
      response.database = 'connected';
    } catch (error) {
      response.success = false;
      response.status = 'degraded';
      response.database = 'unavailable';
      console.error('Health check database error:', error.message);
      return res.status(503).json(response);
    }
  }

  return res.json(response);
});

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error.message);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

const server = app.listen(port, () => {
  console.log(`CIE Multi-Institute API listening on port ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
