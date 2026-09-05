// Adds Users.banned. Usage: SQL_CONNECTION_STRING="..." node scripts/migrate-2026-09-05b.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  console.log('Adding Users.banned...');
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('Users') AND name = 'banned'
    )
    ALTER TABLE Users ADD banned BIT NOT NULL DEFAULT 0;
  `);
  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
