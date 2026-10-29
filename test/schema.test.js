// The server creates tables newer versions need at startup (src/schema.js),
// so a deploy doesn't need a separate migration step. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tables, pool } = require('./fakeBackend');
const { ensureTables } = require('../src/schema');

test('missing meet tables are created once, existing ones are left alone', async () => {
  delete tables.ActiveMeets;
  tables.MeetAlertsSent.push({ season: 2026, eventCode: 'X', matchKey: 'Q1', kind: 'result' });
  assert.deepEqual(await ensureTables(pool), ['ActiveMeets']);
  assert.deepEqual(tables.ActiveMeets, []);
  assert.equal(tables.MeetAlertsSent.length, 1);
  assert.deepEqual(await ensureTables(pool), []);
});
