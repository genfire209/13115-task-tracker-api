// Read-only check: does this user have a pushToken saved?
// Usage: SQL_CONNECTION_STRING="..." node scripts/check-push-token.js <email>
const sql = require('mssql');

async function main() {
  const email = process.argv[2];
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);
  const result = await pool
    .request()
    .input('id', sql.NVarChar, email)
    .query('SELECT id, pushToken FROM Users WHERE id = @id');
  console.log(result.recordset);
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
