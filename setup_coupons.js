const db = require('./db');

async function setup() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_percent INT NOT NULL,
        customer_id INT,
        expiry_date DATE,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Coupons table created');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to create coupons table:', err.message);
    process.exit(1);
  }
}

setup();
