// Removes specific accounts and everything tied to them (tasks they created
// or were assigned, their task events, extension requests, login history).
// Usage: SQL_CONNECTION_STRING="..." node scripts/remove-accounts-2026-09-05.js
const sql = require('mssql');

const EMAILS = ['akotilingala@gmail.com', '428akotilingala@frhsd.com'];

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  const idList = EMAILS.map((e) => `'${e}'`).join(',');

  console.log('Finding affected tasks...');
  const affectedTasks = await pool
    .request()
    .query(`SELECT id FROM Tasks WHERE createdBy IN (${idList}) OR assignedTo IN (${idList})`);
  const taskIds = affectedTasks.recordset.map((r) => r.id);
  const taskIdList = taskIds.length ? taskIds.map((id) => `'${id}'`).join(',') : "''";

  console.log(`Deleting ${taskIds.length} affected task(s) and their events...`);
  await pool
    .request()
    .query(`DELETE FROM TaskEvents WHERE taskId IN (${taskIdList}) OR actorId IN (${idList})`);
  await pool
    .request()
    .query(`DELETE FROM ExtensionRequests WHERE taskId IN (${taskIdList}) OR requestedBy IN (${idList})`);
  await pool.request().query(`DELETE FROM Tasks WHERE id IN (${taskIdList})`);

  console.log('Deleting login history...');
  await pool.request().query(`DELETE FROM LoginEvents WHERE userId IN (${idList})`);

  console.log('Deleting accounts...');
  await pool.request().query(`DELETE FROM Users WHERE id IN (${idList})`);

  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
