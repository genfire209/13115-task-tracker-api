// One-off migration run directly against the live Azure SQL database:
//   1. wipes existing test data (fresh start for login/onboarding testing)
//   2. adds Users.subteam and the LoginEvents table
//
// Usage: SQL_CONNECTION_STRING="..." node scripts/migrate-2026-09-05.js
const sql = require('mssql');

async function main() {
  const pool = await sql.connect(process.env.SQL_CONNECTION_STRING);

  console.log('Clearing existing test data...');
  await pool.request().query('DELETE FROM TaskEvents');
  await pool.request().query('DELETE FROM ExtensionRequests');
  await pool.request().query('DELETE FROM Tasks');
  await pool.request().query('DELETE FROM Users');

  console.log('Adding Users.subteam...');
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('Users') AND name = 'subteam'
    )
    ALTER TABLE Users ADD subteam NVARCHAR(20) NULL;
  `);

  console.log('Creating LoginEvents...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LoginEvents')
    CREATE TABLE LoginEvents (
      id NVARCHAR(50) PRIMARY KEY,
      userId NVARCHAR(100) NOT NULL REFERENCES Users(id),
      email NVARCHAR(200) NOT NULL,
      timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LoginEvents_UserId')
    CREATE INDEX IX_LoginEvents_UserId ON LoginEvents(userId);
  `);

  console.log('Done.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
