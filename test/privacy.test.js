// Members see teammates' names, not their emails (2026-10-29). A user's id
// is their email, so every other person's id reaches a member as an opaque
// 'u_...' stand-in; captains, admins and old tokenless builds are unchanged.
// `npm test`.
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

const BASE = 'http://127.0.0.1:18771';
const LEGACY = 'http://127.0.0.1:18772';
let server;
let legacyServer;
after(() => {
  server.kill();
  legacyServer.kill();
});

async function call(method, url, { as, body, base = BASE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${createSessionToken(as)}`;
  const res = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

/** Every email address in a response body. */
const emailsIn = (text) => text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];

// Servers up, then something to look at: a task the captain assigned to
// Alice, with history, an extension request from Alice, and meet mode on.
// (One hook: top-level before() hooks don't wait for each other.)
before(async () => {
  server = await startServer(18771);
  legacyServer = await startServer(18772, { ALLOW_LEGACY_CLIENTS: 'true' });
  const made = await call('POST', '/api/tasks', {
    as: 'captain@x.com',
    body: { title: 'Fix the lift', category: 'mechanical', assignedTo: 'alice@x.com', dueDate: '2030-02-01' },
  });
  assert.equal(made.status, 201);
  assert.equal((await call('PATCH', `/api/tasks/${made.body.id}`, { as: 'alice@x.com', body: { action: 'accept' } })).status, 200);
  const ext = await call('POST', '/api/extension-requests', {
    as: 'alice@x.com',
    body: { taskId: made.body.id, newDueDate: '2030-03-01', reason: 'Waiting on parts' },
  });
  assert.equal(ext.status, 201);
  assert.equal((await call('POST', '/api/meets/active', { as: 'captain@x.com', body: { season: 2026, eventCode: 'USNJSOM1' } })).status, 201);
});

const MEMBER_READS = [
  '/api/tasks',
  '/api/tasks/task-alice/events',
  '/api/users',
  '/api/extension-requests',
  '/api/meets',
  '/api/meets/active',
  '/api/meets/2026/USNJSOM1',
  '/api/ftc-live/watched',
];

test("a member's responses carry no one's email but their own", async () => {
  const { body: tasks } = await call('GET', '/api/tasks', { as: 'bob@x.com' });
  const ours = tasks.find((t) => t.title === 'Fix the lift');
  for (const url of [...MEMBER_READS, `/api/tasks/${ours.id}/events`]) {
    const r = await call('GET', url, { as: 'bob@x.com' });
    assert.equal(r.status, 200, url);
    assert.deepEqual(emailsIn(r.text).filter((e) => e !== 'bob@x.com'), [], url);
  }
  const roster = (await call('GET', '/api/users', { as: 'bob@x.com' })).body;
  assert.equal(roster.find((u) => u.name === 'Alice').email, '');
  assert.equal(roster.find((u) => u.name === 'Bob').email, 'bob@x.com');
});

test('the stand-in ids match across tasks, history, requests and the roster', async () => {
  const roster = (await call('GET', '/api/users', { as: 'bob@x.com' })).body;
  const idOf = (name) => roster.find((u) => u.name === name).id;
  assert.match(idOf('Alice'), /^u_[\w-]{16}$/);
  assert.equal(idOf('Bob'), 'bob@x.com');

  const task = (await call('GET', '/api/tasks', { as: 'bob@x.com' })).body.find((t) => t.title === 'Fix the lift');
  assert.equal(task.createdBy, idOf('Cap'));
  assert.equal(task.assignedTo, idOf('Alice'));
  const events = (await call('GET', `/api/tasks/${task.id}/events`, { as: 'bob@x.com' })).body;
  assert.deepEqual(
    events.map((e) => e.actorId),
    [idOf('Cap'), idOf('Alice'), idOf('Alice')], // assigned, accepted, asked for more time
  );
  const requests = (await call('GET', '/api/extension-requests', { as: 'bob@x.com' })).body;
  assert.equal(requests.find((r) => r.taskId === task.id).requestedBy, idOf('Alice'));
  assert.equal((await call('GET', '/api/meets/active', { as: 'bob@x.com' })).body.active.startedBy, idOf('Cap'));
});

test('captains and admins still see emails', async () => {
  for (const as of ['captain@x.com', 'admin@x.com']) {
    const roster = (await call('GET', '/api/users', { as })).body;
    assert.equal(roster.find((u) => u.name === 'Alice').email, 'alice@x.com', as);
    assert.equal(roster.find((u) => u.name === 'Alice').id, 'alice@x.com', as);
    const task = (await call('GET', '/api/tasks', { as })).body.find((t) => t.title === 'Fix the lift');
    assert.equal(task.assignedTo, 'alice@x.com', as);
  }
});

test('a member still works their own tasks: claim, complete, ask for more time', async () => {
  const claimed = await call('PATCH', '/api/tasks/task-open', { as: 'bob@x.com', body: { action: 'claim' } });
  assert.equal(claimed.status, 200);
  const task = (await call('GET', '/api/tasks', { as: 'bob@x.com' })).body.find((t) => t.id === 'task-open');
  assert.equal(task.assignedTo, 'bob@x.com'); // their own id, so the app knows it's theirs
  const ext = await call('POST', '/api/extension-requests', {
    as: 'bob@x.com',
    body: { taskId: 'task-open', newDueDate: '2030-04-01', reason: 'Exams' },
  });
  assert.equal(ext.status, 201);
  assert.equal((await call('PATCH', '/api/tasks/task-open', { as: 'bob@x.com', body: { action: 'complete' } })).status, 200);
});

test("a stand-in id sent back by a member is refused, never a server error", async () => {
  const alice = (await call('GET', '/api/users', { as: 'bob@x.com' })).body.find((u) => u.name === 'Alice').id;
  const attempts = [
    call('GET', `/api/users/${alice}`, { as: 'bob@x.com' }),
    call('PATCH', `/api/users/${alice}`, { as: 'bob@x.com', body: { name: 'Hacked' } }),
    call('PATCH', `/api/users/${alice}`, { as: 'bob@x.com', body: { pushToken: 'stolen' } }),
    call('POST', `/api/users/${alice}/test-notification`, { as: 'bob@x.com' }),
    call('POST', '/api/tasks', {
      as: 'bob@x.com',
      body: { title: 'For Alice', category: 'mechanical', assignedTo: alice, dueDate: '2030-01-01' },
    }),
    call('PATCH', '/api/tasks/task-alice', { as: 'bob@x.com', body: { action: 'reassign', newAssigneeId: alice } }),
  ];
  for (const r of await Promise.all(attempts)) assert.equal(r.status, 403, r.text);
});

test('old app builds without a token keep getting real ids (legacy mode)', async () => {
  const roster = (await call('GET', '/api/users', { base: LEGACY })).body;
  assert.equal(roster.find((u) => u.name === 'Alice').email, 'alice@x.com');
  const task = (await call('GET', '/api/tasks', { base: LEGACY })).body.find((t) => t.id === 'task-alice');
  assert.equal(task.assignedTo, 'alice@x.com');
});
