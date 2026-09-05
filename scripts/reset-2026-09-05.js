// Wipes all account/activity data for a fresh start (tasks, events, extension
// requests, login log, and users). Schema is left untouched.
// Usage: SQL_CONNECTION_STRING="..." node scripts/reset-2026-09-05.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  console.log('Clearing all account/activity data...');
  await pool.request().query('DELETE FROM TaskEvents');
  await pool.request().query('DELETE FROM ExtensionRequests');
  await pool.request().query('DELETE FROM LoginEvents');
  await pool.request().query('DELETE FROM Tasks');
  await pool.request().query('DELETE FROM Users');
  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
