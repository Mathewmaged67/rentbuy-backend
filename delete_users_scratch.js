const db = require('./db');

const emailsToDelete = [
  'ywsfksb710@gmail.com',
  'yyms1677@gmail.com',
  'srwrylamt@gmail.com',
  'lamtsrwy670@gmail.com',
  'ywsfhsn621@gmail.com',
  'fyalatrsh@gmail.com'
];

async function deleteUsers() {
  try {
    for (const email of emailsToDelete) {
      // Delete from customers
      const [res1] = await db.query('DELETE FROM customers WHERE email = ?', [email]);
      console.log(`Deleted ${email} from customers: ${res1.affectedRows} row(s)`);

      // Also delete from pending_registrations just in case
      const [res2] = await db.query('DELETE FROM pending_registrations WHERE email = ?', [email]);
      console.log(`Deleted ${email} from pending_registrations: ${res2.affectedRows} row(s)`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Error deleting users:', err.message);
    process.exit(1);
  }
}

deleteUsers();
