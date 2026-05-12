const db = require('./db');

async function cleanUp() {
  try {
    const productsToDelete = ['kncbcn', 'kxknx'];
    
    // Find IDs first to be sure
    const [rows] = await db.query('SELECT id, name FROM products WHERE name IN (?)', [productsToDelete]);
    
    if (rows.length === 0) {
      console.log('No products found with names:', productsToDelete);
      process.exit(0);
    }

    console.log('Found products:', rows);

    for (const row of rows) {
      const [res] = await db.query('DELETE FROM products WHERE id = ?', [row.id]);
      console.log(`Deleted product ${row.name} (ID: ${row.id}): ${res.affectedRows} row(s)`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err.message);
    process.exit(1);
  }
}

cleanUp();
