require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function setup() {
  try {
    // Connect without database first to create it
    let connectionConfig;
    if (process.env.DATABASE_URL) {
      const url = new URL(process.env.DATABASE_URL);
      connectionConfig = {
        host: url.hostname,
        port: url.port || 3306,
        user: url.username,
        password: url.password,
        multipleStatements: true
      };
    } else {
      connectionConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
      };
    }

    const connection = await mysql.createConnection(connectionConfig);

    console.log('Connected to MySQL server.');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema.sql...');
    await connection.query(schemaSql);
    
    console.log('Database and tables created successfully with initial data!');
    await connection.end();
  } catch (error) {
    console.error('Failed to setup database:', error.message);
  }
}

setup();
