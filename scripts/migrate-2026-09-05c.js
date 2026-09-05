// Adds Users.isAdmin, Users.hiddenFromRoster, Users.approved, and migrates
// the existing genfire2009 account from public captain to hidden admin.
// Usage: SQL_CONNECTION_STRING="..." node scripts/migrate-2026-09-05c.js
const sql = require('mssql');

async function addColumnIfMissing(pool, name, ddl) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = '${name}'
    )
    ${ddl}
  `);
}

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  console.log('Adding columns...');
  await addColumnIfMissing(pool, 'isAdmin', 'ALTER TABLE Users ADD isAdmin BIT NOT NULL DEFAULT 0;');
  await addColumnIfMissing(
    pool,
    'hiddenFromRoster',
    'ALTER TABLE Users ADD hiddenFromRoster BIT NOT NULL DEFAULT 0;',
  );
  await addColumnIfMissing(pool, 'approved', 'ALTER TABLE Users ADD approved BIT NOT NULL DEFAULT 1;');

  console.log('Migrating genfire2009@gmail.com to hidden admin...');
  await pool
    .request()
    .query(
      `UPDATE Users SET role = 'member', isAdmin = 1, hiddenFromRoster = 1, approved = 1
       WHERE id = 'genfire2009@gmail.com'`,
    );

  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
