// Widens Users.subteam from NVARCHAR(20) to NVARCHAR(100) now that it holds
// a comma-separated list (a user can be on more than one subteam) instead of
// a single value. Non-destructive — existing single-value data is untouched.
// Usage: SQL_CONNECTION_STRING="..." node scripts/widen-subteam-column-2026-09-07.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  await pool.request().query('ALTER TABLE Users ALTER COLUMN subteam NVARCHAR(100) NULL');
  console.log('Users.subteam widened to NVARCHAR(100).');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
