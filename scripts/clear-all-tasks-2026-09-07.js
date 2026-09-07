// Deletes every task and its related rows (test data cleanup before real use).
// Usage: SQL_CONNECTION_STRING="..." node scripts/clear-all-tasks-2026-09-07.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  const before = await pool.request().query('SELECT COUNT(*) AS count FROM Tasks');
  console.log(`Tasks before: ${before.recordset[0].count}`);

  // Child tables first (foreign keys reference Tasks.id).
  await pool.request().query('DELETE FROM ExtensionRequests');
  await pool.request().query('DELETE FROM TaskEvents');
  await pool.request().query('DELETE FROM Tasks');

  const after = await pool.request().query('SELECT COUNT(*) AS count FROM Tasks');
  console.log(`Tasks after: ${after.recordset[0].count}`);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
