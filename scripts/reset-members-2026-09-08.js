// Clears all tasks/activity and every user account EXCEPT admins (isAdmin = 1)
// and captains (role = 'captain') - e.g. for a fresh start on a new build.
//
// Defaults to a DRY RUN: prints who would be kept/removed and how much task
// data exists, but changes nothing. Pass --execute to actually delete.
//
// Usage:
//   SQL_CONNECTION_STRING="..." node scripts/reset-members-2026-09-08.js
//   SQL_CONNECTION_STRING="..." node scripts/reset-members-2026-09-08.js --execute
const sql = require('mssql');

const EXECUTE = process.argv.includes('--execute');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  const users = await pool
    .request()
    .query('SELECT id, name, email, role, isAdmin, hiddenFromRoster FROM Users ORDER BY isAdmin DESC, role, name');
  const keep = users.recordset.filter((u) => u.isAdmin || u.role === 'captain');
  const remove = users.recordset.filter((u) => !(u.isAdmin || u.role === 'captain'));

  const taskCount = (await pool.request().query('SELECT COUNT(*) AS count FROM Tasks')).recordset[0].count;

  console.log(`Users total: ${users.recordset.length}`);
  console.log(`\nKEEP (${keep.length}) - admin or captain:`);
  keep.forEach((u) => console.log(`  ${u.email}  role=${u.role} isAdmin=${u.isAdmin} hidden=${u.hiddenFromRoster}`));
  console.log(`\nREMOVE (${remove.length}) - everyone else:`);
  remove.forEach((u) => console.log(`  ${u.email}  role=${u.role}`));
  console.log(`\nTasks that will be deleted (ALL, regardless of owner): ${taskCount}`);

  if (!EXECUTE) {
    console.log('\nDry run only - no changes made. Re-run with --execute to apply.');
    await pool.close();
    return;
  }

  // Tasks/events must go first: Tasks.createdBy/assignedTo and TaskEvents.actorId
  // are foreign keys into Users, so a user who created/was assigned a task can't
  // be deleted while that row still exists.
  console.log('\nClearing all tasks and related activity...');
  await pool.request().query('DELETE FROM ExtensionRequests');
  await pool.request().query('DELETE FROM TaskEvents');
  await pool.request().query('DELETE FROM Tasks');

  if (remove.length === 0) {
    console.log('\nNo accounts to remove.');
  } else {
    const keepIds = keep.map((u) => u.id);
    const keepIdList = keepIds.length ? keepIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',') : "''";

    console.log('Deleting login history for removed accounts...');
    await pool.request().query(`DELETE FROM LoginEvents WHERE userId NOT IN (${keepIdList})`);

    console.log('Deleting removed accounts...');
    await pool.request().query(`DELETE FROM Users WHERE id NOT IN (${keepIdList})`);
  }

  const afterUsers = (await pool.request().query('SELECT COUNT(*) AS count FROM Users')).recordset[0].count;
  const afterTasks = (await pool.request().query('SELECT COUNT(*) AS count FROM Tasks')).recordset[0].count;
  console.log(`\nDone. Users remaining: ${afterUsers}. Tasks remaining: ${afterTasks}.`);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
