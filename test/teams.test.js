// The /api/teams routes over HTTP, against the fake backend. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SESSION_SECRET = SECRET;
const { createSessionToken } = require('../src/session');

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', './test/fakeBackend.js', 'server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), SESSION_SECRET: SECRET, ALLOW_LEGACY_CLIENTS: '' },
    });
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve(child));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

let server;
const BASE = 'http://127.0.0.1:18743';

before(async () => {
  server = await startServer(18743);
});
after(() => {
  server.kill();
});

async function call(method, url, { as } = {}) {
  const headers = {};
  if (as) headers.Authorization = `Bearer ${createSessionToken(as)}`;
  const res = await fetch(BASE + url, { method, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('searching by number returns that number without going to FTCScout', async () => {
  const r = await call('GET', '/api/teams/search?q=13115', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, [{ number: 13115, name: null }]);
});

test('searching by name resolves through FTCScout', async () => {
  const r = await call('GET', '/api/teams/search?q=brave', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, [{ number: 13115, name: 'Brave Robotics' }]);
  assert.deepEqual((await call('GET', '/api/teams/search?q=zzz-nope', { as: 'bob@x.com' })).body.results, []);
});

test('a team lookup has its info and the matches it played this season', async () => {
  const r = await call('GET', '/api/teams/13115?season=2026', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.info.nameFull, 'Brave Robotics');
  assert.equal(r.body.events.length, 1);
  const [event] = r.body.events;
  assert.equal(event.code, 'USNJSOM1');
  assert.ok(event.matches.length > 0);
  assert.ok(event.matches.every((m) => m.teams.some((t) => t.teamNumber === 13115)));
});

test('total ranking points is the whole-number sum across played matches, not the average', async () => {
  const r = await call('GET', '/api/teams/13115?season=2026', { as: 'bob@x.com' });
  const [event] = r.body.events;
  // 1 win (3 RP, no posted breakdown so no bonus RP) and 5 losses (0 RP each).
  assert.equal(event.totalRankingPoints, 3);
  assert.ok(Number.isInteger(event.totalRankingPoints));
});

test('a team not registered this season still returns its info with no events', async () => {
  const r = await call('GET', '/api/teams/23743?season=2026', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.info.nameFull, 'Some Other Team');
  assert.deepEqual(r.body.events, []);
});

test('an unknown team number is a 404', async () => {
  assert.equal((await call('GET', '/api/teams/99999999?season=2026', { as: 'bob@x.com' })).status, 404);
});

test('team routes need a real session', async () => {
  assert.equal((await call('GET', '/api/teams/13115')).status, 401);
  assert.equal((await call('GET', '/api/teams/search?q=brave')).status, 401);
});
