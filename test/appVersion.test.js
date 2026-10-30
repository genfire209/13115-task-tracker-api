// Forced updates (2026-10-30): once an admin requires a build, older builds
// - including the ones from before builds were sent at all - can't use the
// app until they update. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SESSION_SECRET = SECRET;
const { createSessionToken } = require('../src/session');

const BASE = 'http://127.0.0.1:18781';
let server;

// Legacy clients allowed, as in production during the rollout: requiring
// an update has to shut them out too.
before(
  () =>
    new Promise((resolve, reject) => {
      server = spawn(process.execPath, ['-r', './test/fakeBackend.js', 'server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: '18781', SESSION_SECRET: SECRET, ALLOW_LEGACY_CLIENTS: 'true' },
      });
      server.stdout.on('data', (d) => d.toString().includes('listening') && resolve());
      server.stderr.on('data', (d) => process.stderr.write(d));
      server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    }),
);
after(() => server.kill());

async function call(method, url, { as, build, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${createSessionToken(as)}`;
  if (build !== undefined) headers['X-App-Build'] = String(build);
  const res = await fetch(BASE + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const requireBuild = (minimumBuild, { as = 'admin@x.com', build = 9 } = {}) =>
  call('PUT', '/api/app-version', { as, build, body: { minimumBuild } });

test('with no minimum set, every build works, old ones included', async () => {
  assert.deepEqual((await call('GET', '/api/app-version')).body, { minimumBuild: 0 });
  assert.equal((await call('GET', '/api/tasks')).status, 200); // build 8: no token, no build
  assert.equal((await call('GET', '/api/tasks', { as: 'alice@x.com', build: 9 })).status, 200);
});

test('only an admin can require a build, and only one their phone has', async () => {
  assert.equal((await requireBuild(9, { as: 'alice@x.com' })).status, 403);
  assert.equal((await requireBuild(9, { as: 'captain@x.com' })).status, 403);
  assert.equal((await requireBuild(10)).status, 400); // admin is on 9
  assert.equal((await requireBuild(-1)).status, 400);
  assert.equal((await requireBuild('9')).status, 400);
  assert.equal((await call('GET', '/api/app-version')).body.minimumBuild, 0);
});

test('requiring build 9 locks out older builds until they update', async () => {
  assert.equal((await requireBuild(9)).status, 200);
  assert.equal((await call('GET', '/api/app-version')).body.minimumBuild, 9);

  // A build that knows about updates gets 426 and a reason.
  const old = await call('GET', '/api/users', { as: 'alice@x.com', build: 8 });
  assert.equal(old.status, 426);
  assert.equal(old.body.updateRequired, true);
  assert.equal(old.body.minimumBuild, 9);

  // Builds from before this existed: no build number, no token.
  const login = await call('POST', '/api/auth/login', { body: { provider: 'google', idToken: 'alice@x.com' } });
  assert.equal(login.status, 426);
  assert.equal((await call('PATCH', '/api/tasks/task-open', { body: { action: 'claim', actorId: 'bob@x.com' } })).status, 426);
  // ...and their task list is one card telling them to update.
  const tasks = await call('GET', '/api/tasks');
  assert.equal(tasks.status, 426);
  assert.equal(tasks.body.length, 1);
  assert.match(tasks.body[0].title, /^Update required/);
  for (const field of ['id', 'title', 'category', 'createdBy', 'status', 'dueDate']) {
    assert.equal(typeof tasks.body[0][field], 'string', field);
  }

  // Build 9 and newer carry on; health and the version check stay open.
  assert.equal((await call('GET', '/api/tasks', { as: 'alice@x.com', build: 9 })).status, 200);
  assert.equal((await call('GET', '/api/tasks', { as: 'alice@x.com', build: 10 })).status, 200);
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('lowering the minimum lets older builds back in', async () => {
  assert.equal((await requireBuild(0)).status, 200);
  assert.equal((await call('GET', '/api/tasks')).status, 200);
  assert.equal((await call('GET', '/api/users', { as: 'alice@x.com', build: 8 })).status, 200);
});
