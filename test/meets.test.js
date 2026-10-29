// The /api/meets routes over HTTP, against the fake backend. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SESSION_SECRET = SECRET;
const { createSessionToken } = require('../src/session');

function startServer(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', './test/fakeBackend.js', 'server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), SESSION_SECRET: SECRET, ALLOW_LEGACY_CLIENTS: '', ...extraEnv },
    });
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve(child));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

let server;
let legacyServer;
const BASE = 'http://127.0.0.1:18741';
const LEGACY = 'http://127.0.0.1:18742';

before(async () => {
  server = await startServer(18741);
  legacyServer = await startServer(18742, { ALLOW_LEGACY_CLIENTS: 'true' });
});
after(() => {
  server.kill();
  legacyServer.kill();
});

async function call(method, url, { as, body, base = BASE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${createSessionToken(as)}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('the meet list flags the meets we attend', async () => {
  const r = await call('GET', '/api/meets?season=2026', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.events.map((e) => [e.code, e.weAttend]), [['USNJSOM1', true], ['USNJSOM4', false]]);
  assert.equal((await call('GET', '/api/meets?season=2026', { as: 'newbie@x.com' })).status, 403);
});

test('a meet has every match with team numbers and scores', async () => {
  const r = await call('GET', '/api/meets/2026/usnjsom1', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.matches.length, 21);
  assert.ok(r.body.matches.every((m) => m.teams.length === 4 && m.redScore !== null && 'estimatedStartTime' in m));
  assert.equal((await call('GET', '/api/meets/2026/NOPE', { as: 'bob@x.com' })).status, 404);
});

test('only captains/admins start and end meet mode', async () => {
  const body = { season: 2026, eventCode: 'USNJSOM1' };
  assert.equal((await call('POST', '/api/meets/active', { as: 'bob@x.com', body })).status, 403);
  assert.equal((await call('POST', '/api/meets/active', { as: 'captain@x.com', body: { ...body, testOnly: true } })).status, 403);
  const started = await call('POST', '/api/meets/active', { as: 'captain@x.com', body });
  assert.equal(started.status, 201);
  assert.equal(started.body.active.teamNumber, 13115);
  assert.equal((await call('GET', '/api/meets/active', { as: 'bob@x.com' })).body.active.eventCode, 'USNJSOM1');
  assert.equal((await call('DELETE', '/api/meets/active', { as: 'bob@x.com' })).status, 403);
  assert.equal((await call('DELETE', '/api/meets/active', { as: 'captain@x.com' })).status, 200);
  assert.equal((await call('GET', '/api/meets/active', { as: 'bob@x.com' })).body.active, null);
});

test("an admin's test run is invisible to everyone else", async () => {
  const r = await call('POST', '/api/meets/active', { as: 'admin@x.com', body: { season: 2026, eventCode: 'USNJSOM1', testOnly: true, teamNumber: 23743 } });
  assert.equal(r.status, 201);
  assert.equal((await call('GET', '/api/meets/active', { as: 'bob@x.com' })).body.active, null);
  assert.equal((await call('GET', '/api/meets/active', { as: 'admin@x.com' })).body.active.teamNumber, 23743);
  await call('DELETE', '/api/meets/active', { as: 'admin@x.com' });
});

test('meet routes always need a real session, even with legacy clients allowed', async () => {
  assert.equal((await call('GET', '/api/meets', { base: LEGACY })).status, 401);
  assert.equal((await call('POST', '/api/meets/active', { base: LEGACY, body: { season: 2026, eventCode: 'USNJSOM1' } })).status, 401);
});

test('a played match has the full FIRST breakdown, robots matched to teams', async () => {
  const r = await call('GET', '/api/meets/2026/USNJSOM1/matches/QUALIFICATION-0-8', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  const { red, blue, flowers } = r.body.breakdown;
  // The numbers on https://ftc-events.firstinspires.org/2026/USNJSOM1/qualifications/8
  assert.deepEqual([red.auto.points, red.teleop.points, red.penaltyPoints, red.total], [3, 34, 0, 37]);
  assert.deepEqual([blue.auto.points, blue.teleop.points, blue.penaltyPoints, blue.total], [8, 18, 0, 26]);
  assert.deepEqual(red.auto.robots, [
    { leave: true, park: false, teamNumber: 36975 },
    { leave: false, park: false, teamNumber: 10974 },
  ]);
  assert.deepEqual(blue.auto.robots[0], { leave: true, park: true, teamNumber: 32294 });
  assert.deepEqual([red.teleop.tips, red.teleop.hiveBalls, blue.teleop.hiveBalls, blue.teleop.gardenBalls], [1, 2, 3, 2]);
  assert.deepEqual(flowers, { redWall: [], scoring: [], blueWall: [], audience: [] });
  // Red won but missed SWARM (3 + 0 + 10 < 16); blue lost but got it (3 + 5 + 10).
  assert.deepEqual(r.body.rankingPoints.red, { win: 3, swarm: false, pollinator1: false, pollinator2: false, total: 3, bonusKnown: true });
  assert.deepEqual(r.body.rankingPoints.blue, { win: 0, swarm: true, pollinator1: false, pollinator2: false, total: 1, bonusKnown: true });
});

test('a match without a posted breakdown still shows its score', async () => {
  const r = await call('GET', '/api/meets/2026/USNJSOM1/matches/QUALIFICATION-0-1', { as: 'bob@x.com' });
  assert.equal(r.status, 200);
  assert.equal(r.body.breakdown, null);
  assert.equal(r.body.match.redScore, 48);
  assert.equal(r.body.rankingPoints.red.bonusKnown, false);
  assert.equal((await call('GET', '/api/meets/2026/USNJSOM1/matches/QUALIFICATION-0-99', { as: 'bob@x.com' })).status, 404);
});
