require('dotenv').config({ path: require('path').resolve(__dirname, '.env'), override: true });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'web_project',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test the connection on startup so errors surface immediately
pool.getConnection()
  .then(conn => {
    console.log(`✅ MySQL connected — host: ${process.env.DB_HOST || 'localhost'}, db: ${process.env.DB_NAME || 'web_project'}`);
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('   Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in backend/.env');
  });

module.exports = pool;
