// Fixes from the security review (2026-10-29): login flooding, onboarding
// push spam, names, and Google's email-verified flag. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SESSION_SECRET = SECRET;
const { createSessionToken } = require('../src/session');
const { identityFromPayload } = require('../src/authVerify');

let server;
const BASE = 'http://127.0.0.1:18761';

before(
  () =>
    new Promise((resolve, reject) => {
      server = spawn(process.execPath, ['-r', './test/fakeBackend.js', 'server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: '18761', SESSION_SECRET: SECRET, ALLOW_LEGACY_CLIENTS: '' },
      });
      server.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
      server.stderr.on('data', (d) => process.stderr.write(d));
      server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    }),
);
after(() => server.kill());

async function call(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${createSessionToken(as)}`;
  const res = await fetch(BASE + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const tables = async () => (await call('GET', '/__test/tables')).body;
const login = (email) => call('POST', '/api/auth/login', { body: { provider: 'google', idToken: email } });

test('logging in again updates one row instead of adding rows', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await login('alice@x.com')).status, 200);
  assert.equal((await tables()).LoginEvents.filter((e) => e.userId === 'alice@x.com').length, 1);
});

test('one account can only sign in 20 times in 10 minutes', async () => {
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await login('bob@x.com')).status);
  assert.deepEqual([statuses[19], statuses[20]], [200, 429]);
});

test('captains hear about a new member once, not on every save', async () => {
  const onboard = (body) => call('PATCH', '/api/users/fresh@x.com', { as: 'fresh@x.com', body });
  assert.equal((await onboard({ name: 'Fresh Face', subteams: ['strategy'] })).status, 200);
  assert.equal((await onboard({ name: 'Click evil.example now', subteams: ['outreach'] })).status, 200);
  assert.equal((await onboard({ subteams: ['mechanical'] })).status, 200);
  const alerts = (await tables()).PushLog.filter((p) => p.title === 'New member needs approval');
  assert.deepEqual(alerts.map((a) => a.body), ['Fresh Face completed onboarding']);
});

test('names are one line, 1-60 characters, trimmed', async () => {
  const rename = (name) => call('PATCH', '/api/users/fresh@x.com', { as: 'fresh@x.com', body: { name } });
  assert.equal((await rename('x'.repeat(61))).status, 400);
  assert.equal((await rename('Line one\nLine two')).status, 400);
  assert.equal((await rename('   ')).status, 400);
  assert.equal((await rename('  Fresh  ')).status, 200);
  assert.equal((await tables()).Users.find((u) => u.id === 'fresh@x.com').name, 'Fresh');
});

test("Google tokens must carry a verified email", () => {
  assert.deepEqual(identityFromPayload({ email: 'a@x.com', email_verified: true, name: 'A' }), { email: 'a@x.com', name: 'A' });
  assert.throws(() => identityFromPayload({ email: 'a@x.com', email_verified: false }));
  assert.throws(() => identityFromPayload({ email: 'a@x.com' }));
  assert.throws(() => identityFromPayload({ email_verified: true }));
});
