// Adds the two tables the FTC live-match-tracking feature needs. Safe to
// run more than once.
// Usage: SQL_CONNECTION_STRING="..." node scripts/add-ftc-live-tables-2026-09-15.js
const sql = require('mssql');

async function tableExists(pool, name) {
  const result = await pool
    .request()
    .input('name', sql.NVarChar, name)
    .query("SELECT 1 AS found FROM sys.tables WHERE name = @name");
  return result.recordset.length > 0;
}

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  if (await tableExists(pool, 'WatchedFtcEvents')) {
    console.log('WatchedFtcEvents already exists - skipping.');
  } else {
    await pool.request().query(`
      CREATE TABLE WatchedFtcEvents (
          id NVARCHAR(50) PRIMARY KEY,
          season INT NOT NULL,
          eventCode NVARCHAR(20) NOT NULL,
          addedBy NVARCHAR(100) NOT NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      )
    `);
    console.log('Created WatchedFtcEvents.');
  }

  if (await tableExists(pool, 'NotifiedFtcMatches')) {
    console.log('NotifiedFtcMatches already exists - skipping.');
  } else {
    await pool.request().query(`
      CREATE TABLE NotifiedFtcMatches (
          season INT NOT NULL,
          eventCode NVARCHAR(20) NOT NULL,
          matchKey NVARCHAR(50) NOT NULL,
          notifiedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          PRIMARY KEY (season, eventCode, matchKey)
      )
    `);
    console.log('Created NotifiedFtcMatches.');
  }

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
