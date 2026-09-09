// Grants isAdmin to specific accounts by exact email. Defaults to a DRY RUN
// that only prints current state - nothing changes until --execute.
//
// Usage:
//   SQL_CONNECTION_STRING="..." node scripts/promote-admins-2026-09-09.js
//   SQL_CONNECTION_STRING="..." node scripts/promote-admins-2026-09-09.js --execute
const sql = require('mssql');

// 428mhenkel@frhsd.com confirmed by the user over the banned personal gmail
// account that also matched a "henkel" name search.
const EMAILS = ['428abudhiraja@frhsd.com', '428kpatel@frhsd.com', '428mhenkel@frhsd.com'];
const EXECUTE = process.argv.includes('--execute');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  for (const email of EMAILS) {
    const result = await pool
      .request()
      .input('id', sql.NVarChar, email)
      .query('SELECT id, name, email, role, isAdmin, banned FROM Users WHERE id = @id');
    if (result.recordset.length === 0) {
      console.log(`${email}: NOT FOUND in Users table`);
      continue;
    }
    const u = result.recordset[0];
    console.log(`${email}: name="${u.name}" role=${u.role} isAdmin=${u.isAdmin} banned=${u.banned}`);
  }

  if (!EXECUTE) {
    console.log('\nDry run only - no changes made. Re-run with --execute to apply.');
    await pool.close();
    return;
  }

  for (const email of EMAILS) {
    await pool
      .request()
      .input('id', sql.NVarChar, email)
      .query('UPDATE Users SET isAdmin = 1 WHERE id = @id');
    console.log(`Promoted ${email} to admin.`);
  }

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
