// Runs the real server against test/fakeBackend.js and checks that identity
// comes only from the session token. `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.SESSION_SECRET = SECRET;
const { createSessionToken } = require('../src/session');

function startServer(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', './test/fakeBackend.js', 'server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        SESSION_SECRET: SECRET,
        CAPTAIN_CHANGE_PIN: '4321',
        ALLOW_LEGACY_CLIENTS: '',
        ...extraEnv,
      },
    });
    child.stdout.on('data', (d) => d.toString().includes('listening') && resolve(child));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

let server;
let legacyServer;
const BASE = 'http://127.0.0.1:18731';
const LEGACY = 'http://127.0.0.1:18732';

before(async () => {
  server = await startServer(18731);
  legacyServer = await startServer(18732, { ALLOW_LEGACY_CLIENTS: 'true' });
});
after(() => {
  server.kill();
  legacyServer.kill();
});

async function call(method, url, { as, token, body, base = BASE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token || (as && createSessionToken(as));
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const tables = async (base = BASE) => (await call('GET', '/__test/tables', { base })).body;
const user = async (id, base) => (await tables(base)).Users.find((u) => u.id === id);

test('health and login stay open; login returns a working session token', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  const login = await call('POST', '/api/auth/login', { body: { provider: 'google', idToken: 'alice@x.com' } });
  assert.equal(login.status, 200);
  assert.ok(login.body.sessionToken);
  assert.equal((await call('GET', '/api/tasks', { token: login.body.sessionToken })).status, 200);
});

test('no token, forged token, expired token and banned user are all rejected', async () => {
  assert.equal((await call('GET', '/api/tasks')).status, 401);
  assert.equal((await call('GET', '/api/tasks', { token: 'abc.def' })).status, 401);
  const payload = Buffer.from(JSON.stringify({ sub: 'captain@x.com', exp: Date.now() + 1e6 })).toString('base64url');
  const forged = `${payload}.${crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('base64url')}`;
  assert.equal((await call('GET', '/api/tasks', { token: forged })).status, 401);
  const old = Buffer.from(JSON.stringify({ sub: 'alice@x.com', exp: Date.now() - 1000 })).toString('base64url');
  const expired = `${old}.${crypto.createHmac('sha256', SECRET).update(old).digest('base64url')}`;
  assert.equal((await call('GET', '/api/tasks', { token: expired })).status, 401);
  assert.equal((await call('GET', '/api/tasks', { as: 'gone@x.com' })).status, 403);
});

test('a member cannot approve, ban, rename or hijack pushes of someone else', async () => {
  for (const body of [{ approved: true }, { banned: true }, { name: 'x' }, { pushToken: 'evil' }, { isJunior: true }]) {
    const r = await call('PATCH', '/api/users/newbie@x.com', { as: 'bob@x.com', body: { ...body, requesterId: 'captain@x.com' } });
    assert.equal(r.status, 403, JSON.stringify(body));
  }
  assert.equal((await user('newbie@x.com')).approved, 0);
  assert.equal((await call('GET', '/api/users/alice@x.com', { as: 'bob@x.com' })).status, 403);
  assert.equal((await call('GET', '/api/users/pending-approval', { as: 'bob@x.com' })).status, 403);
});

test('a waiting member can onboard but not approve themselves or see the board', async () => {
  assert.equal((await call('GET', '/api/tasks', { as: 'newbie@x.com' })).status, 403);
  assert.equal((await call('GET', '/api/users/newbie@x.com', { as: 'newbie@x.com' })).status, 200);
  const onboard = await call('PATCH', '/api/users/newbie@x.com', { as: 'newbie@x.com', body: { name: 'Newt', subteams: ['strategy'] } });
  assert.equal(onboard.status, 200);
  assert.equal((await call('PATCH', '/api/users/newbie@x.com', { as: 'newbie@x.com', body: { approved: true } })).status, 403);
});

test('a captain can approve members', async () => {
  assert.equal((await call('PATCH', '/api/users/newbie@x.com', { as: 'captain@x.com', body: { approved: true } })).status, 200);
  assert.equal((await user('newbie@x.com')).approved, true);
});

test('only admins delete tasks, only captains/admins broadcast', async () => {
  const asBob = await call('DELETE', '/api/tasks/task-open?requesterId=admin@x.com', { as: 'bob@x.com' });
  assert.equal(asBob.status, 403);
  assert.equal((await call('POST', '/api/users/broadcast?requesterId=admin@x.com', { as: 'bob@x.com', body: { title: 't', body: 'b' } })).status, 403);
  assert.equal((await call('POST', '/api/users/broadcast', { as: 'captain@x.com', body: { title: 't', body: 'b' } })).status, 200);
});

test('tasks: creator and actor come from the token; assignment and actions are checked', async () => {
  const other = await call('POST', '/api/tasks', {
    as: 'bob@x.com',
    body: { title: 'x', category: 'outreach', assignedTo: 'alice@x.com', dueDate: '2030-01-01' },
  });
  assert.equal(other.status, 403);
  const mine = await call('POST', '/api/tasks', {
    as: 'bob@x.com',
    body: { title: 'mine', category: 'outreach', createdBy: 'captain@x.com', assignedTo: 'bob@x.com', dueDate: '2030-01-01' },
  });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.createdBy, 'bob@x.com');

  assert.equal((await call('PATCH', '/api/tasks/task-alice', { as: 'bob@x.com', body: { action: 'complete', actorId: 'alice@x.com' } })).status, 403);
  assert.equal((await call('PATCH', '/api/tasks/task-alice', { as: 'bob@x.com', body: { action: 'reassign', newAssigneeId: 'bob@x.com' } })).status, 403);
  assert.equal((await call('PATCH', '/api/tasks/task-open', { as: 'bob@x.com', body: { action: 'claim' } })).status, 200);
  assert.equal((await tables()).Tasks.find((t) => t.id === 'task-open').assignedTo, 'bob@x.com');
});

test('extensions: only the assignee asks, only captains/admins decide', async () => {
  assert.equal((await call('POST', '/api/extension-requests', { as: 'bob@x.com', body: { taskId: 'task-alice', newDueDate: '2031-01-01', reason: 'r' } })).status, 403);
  const ask = await call('POST', '/api/extension-requests', { as: 'alice@x.com', body: { taskId: 'task-alice', newDueDate: '2031-01-01', reason: 'r' } });
  assert.equal(ask.status, 201);
  assert.equal(ask.body.requestedBy, 'alice@x.com');
  assert.equal((await call('PATCH', `/api/extension-requests/${ask.body.id}`, { as: 'alice@x.com', body: { status: 'approved' } })).status, 403);
  assert.equal((await call('PATCH', `/api/extension-requests/${ask.body.id}`, { as: 'captain@x.com', body: { status: 'approved' } })).status, 200);
  assert.equal((await call('PATCH', '/api/tasks/task-alice', { as: 'alice@x.com', body: { action: 'complete' } })).status, 200);
});

test('a device token moves to whoever registers it last', async () => {
  assert.equal((await call('PATCH', '/api/users/bob@x.com', { as: 'bob@x.com', body: { pushToken: 'device-1' } })).status, 200);
  assert.equal((await user('alice@x.com')).pushToken, null);
  assert.equal((await user('bob@x.com')).pushToken, 'device-1');
});

test('captain change: owner only, and wrong PINs lock it after 5 tries', async () => {
  assert.equal((await call('PATCH', '/api/users/bob@x.com', { as: 'admin@x.com', body: { role: 'captain', pin: '4321', requesterId: '428akotilingala@frhsd.com' } })).status, 403);
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('PATCH', '/api/users/bob@x.com', { as: '428akotilingala@frhsd.com', body: { role: 'captain', pin: '0000' } })).status, 403);
  }
  assert.equal((await call('PATCH', '/api/users/bob@x.com', { as: '428akotilingala@frhsd.com', body: { role: 'captain', pin: '4321' } })).status, 429);
  assert.equal((await user('bob@x.com')).role, 'member');
});

test('ALLOW_LEGACY_CLIENTS=true keeps tokenless old app builds working', async () => {
  assert.equal((await call('GET', '/api/tasks', { base: LEGACY })).status, 200);
  assert.equal((await call('PATCH', '/api/users/newbie@x.com', { base: LEGACY, body: { approved: true } })).status, 200);
  // A request that does carry a token is still checked properly.
  assert.equal((await call('PATCH', '/api/users/newbie@x.com', { base: LEGACY, as: 'bob@x.com', body: { banned: true } })).status, 403);
});
