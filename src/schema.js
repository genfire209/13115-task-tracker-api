const { sql } = require('./db');

// Tables added after the database was first set up, created if they're
// missing. The server runs this at startup, so deploying is enough - no
// separate migration step. Safe to run any number of times.
const TABLES = {
  // Meet mode (2026-10-29): which meet is on, and which alerts went out.
  ActiveMeets: `
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
  `,
  // Forced updates (2026-10-30): the oldest app build still allowed.
  AppSettings: `
    CREATE TABLE AppSettings (
        name NVARCHAR(50) PRIMARY KEY,
        value NVARCHAR(200) NOT NULL,
        updatedBy NVARCHAR(100) NULL,
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `,
  MeetAlertsSent: `
    CREATE TABLE MeetAlertsSent (
        season INT NOT NULL,
        eventCode NVARCHAR(20) NOT NULL,
        matchKey NVARCHAR(50) NOT NULL,
        kind NVARCHAR(20) NOT NULL,
        sentAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        PRIMARY KEY (season, eventCode, matchKey, kind)
    )
  `,
};

async function tableExists(pool, name) {
  const result = await pool
    .request()
    .input('name', sql.NVarChar, name)
    .query('SELECT 1 AS found FROM sys.tables WHERE name = @name');
  return result.recordset.length > 0;
}

/** Creates any of TABLES that don't exist yet. Returns the names it created. */
async function ensureTables(pool) {
  const created = [];
  for (const [name, createSql] of Object.entries(TABLES)) {
    if (await tableExists(pool, name)) continue;
    await pool.request().query(createSql);
    created.push(name);
  }
  return created;
}

module.exports = { ensureTables };
