// Adds the two tables meet mode needs (ActiveMeets, MeetAlertsSent). Safe to
// run more than once.
// Usage: SQL_CONNECTION_STRING="..." node scripts/add-meet-mode-tables-2026-10-29.js
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

  if (await tableExists(pool, 'ActiveMeets')) {
    console.log('ActiveMeets already exists - skipping.');
  } else {
    await pool.request().query(`
      CREATE TABLE ActiveMeets (
          id NVARCHAR(50) PRIMARY KEY,
          season INT NOT NULL,
          eventCode NVARCHAR(20) NOT NULL,
          teamNumber INT NOT NULL,
          testOnly BIT NOT NULL DEFAULT 0,
          startedBy NVARCHAR(100) NOT NULL,
          startedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          endedAt DATETIME2 NULL
      )
    `);
    console.log('Created ActiveMeets.');
  }

  if (await tableExists(pool, 'MeetAlertsSent')) {
    console.log('MeetAlertsSent already exists - skipping.');
  } else {
    await pool.request().query(`
      CREATE TABLE MeetAlertsSent (
          season INT NOT NULL,
          eventCode NVARCHAR(20) NOT NULL,
          matchKey NVARCHAR(50) NOT NULL,
          kind NVARCHAR(20) NOT NULL,
          sentAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          PRIMARY KEY (season, eventCode, matchKey, kind)
      )
    `);
    console.log('Created MeetAlertsSent.');
  }

  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
