// Adds the isJunior column to Users (junior/freshman team members - see
// schema.sql). Non-destructive; safe to run even if it's already there.
// Usage: SQL_CONNECTION_STRING="..." node scripts/add-junior-flag-2026-09-09.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  const existing = await pool.request().query(`
    SELECT 1 AS found FROM sys.columns
    WHERE object_id = OBJECT_ID('Users') AND name = 'isJunior'
  `);
  if (existing.recordset.length > 0) {
    console.log('isJunior column already exists - nothing to do.');
  } else {
    await pool.request().query('ALTER TABLE Users ADD isJunior BIT NOT NULL DEFAULT 0');
    console.log('Added isJunior column to Users.');
  }
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
