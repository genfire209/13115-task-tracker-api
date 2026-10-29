// Adds the two tables meet mode needs (ActiveMeets, MeetAlertsSent). Safe to
// run more than once. The server now does this itself at startup (see
// src/schema.js); this is for setting up a database by hand.
// Usage: SQL_CONNECTION_STRING="..." node scripts/add-meet-mode-tables-2026-10-29.js
const { getPool } = require('../src/db');
const { ensureTables } = require('../src/schema');

async function main() {
  const pool = await getPool();
  const created = await ensureTables(pool);
  console.log(created.length ? `Created ${created.join(', ')}.` : 'All tables already exist - nothing to do.');
  await pool.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
