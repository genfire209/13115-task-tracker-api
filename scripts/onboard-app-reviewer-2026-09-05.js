// Pre-onboards the throwaway Google account used for Apple's Beta App
// Review, so the reviewer lands straight on the task board after signing
// in instead of hitting onboarding or the pending-approval screen.
// Ordinary member permissions, hidden from the team roster so it doesn't
// show up as a mystery account to real team members.
// Usage: SQL_CONNECTION_STRING="..." node scripts/onboard-app-reviewer-2026-09-05.js
const sql = require('mssql');

const EMAIL = '13115reviewer@gmail.com';

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  const existing = await pool
    .request()
    .input('id', sql.NVarChar, EMAIL)
    .query('SELECT id FROM Users WHERE id = @id');

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.NVarChar, EMAIL)
      .input('subteam', sql.NVarChar, 'mechanical')
      .query(
        `UPDATE Users SET subteam = @subteam, approved = 1, hiddenFromRoster = 1, banned = 0
         WHERE id = @id`,
      );
    console.log(`Updated existing row for ${EMAIL}.`);
  } else {
    await pool
      .request()
      .input('id', sql.NVarChar, EMAIL)
      .input('name', sql.NVarChar, 'App Reviewer')
      .input('email', sql.NVarChar, EMAIL)
      .input('authProvider', sql.NVarChar, 'google')
      .input('role', sql.NVarChar, 'member')
      .input('subteam', sql.NVarChar, 'mechanical')
      .query(
        `INSERT INTO Users (id, name, email, authProvider, role, subteam, isAdmin, hiddenFromRoster, approved)
         VALUES (@id, @name, @email, @authProvider, @role, @subteam, 0, 1, 1)`,
      );
    console.log(`Inserted new pre-approved row for ${EMAIL}.`);
  }

  const after = await pool
    .request()
    .input('id', sql.NVarChar, EMAIL)
    .query('SELECT id, name, role, subteam, isAdmin, hiddenFromRoster, approved FROM Users WHERE id = @id');
  console.log('Final state:', after.recordset[0]);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
