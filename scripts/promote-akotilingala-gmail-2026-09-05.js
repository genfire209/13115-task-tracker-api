// Makes akotilingala@gmail.com a fully hidden admin (same treatment as
// genfire2009@gmail.com): full captain-level permissions, never shown in
// any roster, no approval gate. Safe to re-run.
// Usage: SQL_CONNECTION_STRING="..." node scripts/promote-akotilingala-gmail-2026-09-05.js
const sql = require('mssql');

const EMAIL = 'akotilingala@gmail.com';

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  const before = await pool
    .request()
    .input('id', sql.NVarChar, EMAIL)
    .query('SELECT id, name, isAdmin, hiddenFromRoster, approved FROM Users WHERE id = @id');

  if (before.recordset.length === 0) {
    console.log(`No existing row for ${EMAIL} — nothing to update. It will get isAdmin/hiddenFromRoster/approved set correctly automatically on first login now that auth.js includes it.`);
    await pool.close();
    return;
  }

  await pool
    .request()
    .input('id', sql.NVarChar, EMAIL)
    .query('UPDATE Users SET isAdmin = 1, hiddenFromRoster = 1, approved = 1 WHERE id = @id');

  const after = await pool
    .request()
    .input('id', sql.NVarChar, EMAIL)
    .query('SELECT id, name, isAdmin, hiddenFromRoster, approved FROM Users WHERE id = @id');

  console.log('Before:', before.recordset[0]);
  console.log('After: ', after.recordset[0]);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
