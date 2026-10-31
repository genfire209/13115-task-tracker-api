// Pre-onboards the throwaway Google accounts used for app review (Apple's
// Beta App Review and Google Play's reviewers), so whichever one signs in
// lands straight on the task board instead of hitting onboarding or the
// pending-approval screen. Ordinary member permissions, hidden from the
// team roster so they don't show up as mystery accounts to real members.
// Both old and new accounts are kept live at once, since App Store Connect
// / Play Console review notes may already reference either one.
// Usage: SQL_CONNECTION_STRING="..." node scripts/onboard-app-reviewer-2026-09-05.js
const sql = require('mssql');

const EMAILS = ['13115reviewer@gmail.com', '13115reviewer2@gmail.com'];

async function onboard(pool, email) {
  const existing = await pool
    .request()
    .input('id', sql.NVarChar, email)
    .query('SELECT id FROM Users WHERE id = @id');

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.NVarChar, email)
      .input('subteam', sql.NVarChar, 'system_integration')
      .query(
        `UPDATE Users SET subteam = @subteam, approved = 1, hiddenFromRoster = 1, banned = 0
         WHERE id = @id`,
      );
    console.log(`Updated existing row for ${email}.`);
  } else {
    await pool
      .request()
      .input('id', sql.NVarChar, email)
      .input('name', sql.NVarChar, 'App Reviewer')
      .input('email', sql.NVarChar, email)
      .input('authProvider', sql.NVarChar, 'google')
      .input('role', sql.NVarChar, 'member')
      .input('subteam', sql.NVarChar, 'system_integration')
      .query(
        `INSERT INTO Users (id, name, email, authProvider, role, subteam, isAdmin, hiddenFromRoster, approved)
         VALUES (@id, @name, @email, @authProvider, @role, @subteam, 0, 1, 1)`,
      );
    console.log(`Inserted new pre-approved row for ${email}.`);
  }

  const after = await pool
    .request()
    .input('id', sql.NVarChar, email)
    .query('SELECT id, name, role, subteam, isAdmin, hiddenFromRoster, approved FROM Users WHERE id = @id');
  console.log('Final state:', after.recordset[0]);
}

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  for (const email of EMAILS) {
    await onboard(pool, email);
  }
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
