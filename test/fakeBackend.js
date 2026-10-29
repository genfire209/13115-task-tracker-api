// Preloaded with `node -r ./test/fakeBackend.js server.js` by the tests: swaps
// the Azure SQL pool for a tiny in-memory database that understands the
// handful of query shapes the routes use, and Google token checks for
// "the id token is the email". Never used in production.
const path = require('path');

const tables = {
  Users: [
    { id: 'captain@x.com', name: 'Cap', email: 'captain@x.com', authProvider: 'google', role: 'captain', subteam: 'programming', banned: 0, isAdmin: 0, hiddenFromRoster: 0, approved: 1, isJunior: 0, pushToken: null },
    { id: 'admin@x.com', name: 'Admin', email: 'admin@x.com', authProvider: 'google', role: 'member', subteam: 'programming', banned: 0, isAdmin: 1, hiddenFromRoster: 1, approved: 1, isJunior: 0, pushToken: null },
    { id: '428akotilingala@frhsd.com', name: 'Owner', email: '428akotilingala@frhsd.com', authProvider: 'google', role: 'member', subteam: 'programming', banned: 0, isAdmin: 1, hiddenFromRoster: 0, approved: 1, isJunior: 0, pushToken: null },
    { id: 'alice@x.com', name: 'Alice', email: 'alice@x.com', authProvider: 'google', role: 'member', subteam: 'mechanical', banned: 0, isAdmin: 0, hiddenFromRoster: 0, approved: 1, isJunior: 0, pushToken: 'device-1' },
    { id: 'bob@x.com', name: 'Bob', email: 'bob@x.com', authProvider: 'google', role: 'member', subteam: 'outreach', banned: 0, isAdmin: 0, hiddenFromRoster: 0, approved: 1, isJunior: 0, pushToken: null },
    { id: 'newbie@x.com', name: 'New', email: 'newbie@x.com', authProvider: 'google', role: 'member', subteam: null, banned: 0, isAdmin: 0, hiddenFromRoster: 0, approved: 0, isJunior: 0, pushToken: null },
    { id: 'gone@x.com', name: 'Gone', email: 'gone@x.com', authProvider: 'google', role: 'member', subteam: 'outreach', banned: 1, isAdmin: 0, hiddenFromRoster: 0, approved: 1, isJunior: 0, pushToken: null },
  ],
  Tasks: [
    { id: 'task-alice', title: 'Wire the hub', description: '', category: 'programming', createdBy: 'captain@x.com', assignedTo: 'alice@x.com', status: 'accepted', dueDate: new Date('2030-01-01'), reminderSentAt: null },
    { id: 'task-open', title: 'Sweep', description: '', category: 'mechanical', createdBy: 'captain@x.com', assignedTo: null, status: 'open', dueDate: new Date('2030-01-01'), reminderSentAt: null },
  ],
  TaskEvents: [],
  ExtensionRequests: [],
  LoginEvents: [],
  WatchedFtcEvents: [],
};

const value = (token, params) => {
  if (token.startsWith('@')) return params[token.slice(1)];
  if (token === 'NULL') return null;
  if (token.startsWith("'")) return token.slice(1, -1);
  if (token === 'SYSUTCDATETIME()') return new Date();
  return Number(token);
};

function matches(row, where, params) {
  if (!where) return true;
  return where.split(/ AND /i).every((cond) => {
    const [, col, op, rhs] = cond.trim().match(/^(\w+) (=|<>) (.+)$/);
    const v = value(rhs.trim(), params);
    // eslint-disable-next-line eqeqeq
    return op === '=' ? row[col] == v : row[col] != v;
  });
}

function run(text, params) {
  const q = text.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = q.match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY .+)?$/i))) {
    const rows = tables[m[2]].filter((r) => matches(r, m[3], params));
    const cols = m[1].trim() === '*' ? null : m[1].split(',').map((c) => c.trim());
    const out = rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r }));
    return { recordset: out, rowsAffected: [out.length] };
  }
  if ((m = q.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i))) {
    const rows = tables[m[1]].filter((r) => matches(r, m[3], params));
    for (const r of rows) {
      for (const clause of m[2].split(',')) {
        const [col, rhs] = clause.split('=').map((s) => s.trim());
        r[col] = value(rhs, params);
      }
    }
    return { recordset: [], rowsAffected: [rows.length] };
  }
  if ((m = q.match(/^INSERT INTO (\w+) \((.+?)\) VALUES \((.+)\)$/i))) {
    const cols = m[2].split(',').map((c) => c.trim());
    const vals = m[3].split(',').map((v) => value(v.trim(), params));
    tables[m[1]].push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
    return { recordset: [], rowsAffected: [1] };
  }
  if ((m = q.match(/^DELETE FROM (\w+) WHERE (.+)$/i))) {
    const before = tables[m[1]].length;
    tables[m[1]] = tables[m[1]].filter((r) => !matches(r, m[2], params));
    return { recordset: [], rowsAffected: [before - tables[m[1]].length] };
  }
  throw new Error(`fake db: unsupported query: ${q}`);
}

const pool = {
  request() {
    const params = {};
    const req = {
      input(name, _type, v) {
        params[name] = v;
        return req;
      },
      query: async (text) => run(text, params),
    };
    return req;
  },
};

const stub = (file, exports) => {
  const id = require.resolve(path.join(__dirname, '..', 'src', file));
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('db.js', { sql: new Proxy({}, { get: (_, k) => k }), getPool: async () => pool });
stub('authVerify.js', { verifyGoogleToken: async (idToken) => ({ email: idToken, name: idToken }) });

// Lets a test read the in-memory tables over HTTP.
const express = require('express');
const original = express.application.listen;
express.application.listen = function listen(...args) {
  this.get('/__test/tables', (req, res) => res.json(tables));
  return original.apply(this, args);
};
