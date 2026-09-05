// Adds Tasks.reminderSentAt for the due-date reminder cron.
// Usage: SQL_CONNECTION_STRING="..." node scripts/migrate-2026-09-05d.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  console.log('Adding Tasks.reminderSentAt...');
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Tasks') AND name = 'reminderSentAt'
    )
    ALTER TABLE Tasks ADD reminderSentAt DATETIME2 NULL;
  `);
  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
