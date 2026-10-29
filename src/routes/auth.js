const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const { verifyGoogleToken } = require('../authVerify');
const { createSessionToken } = require('../session');
const asyncHandler = require('../asyncHandler');
const { subteamsFromDb } = require('../subteams');

const router = express.Router();

// The one account shown to everyone as "Captain".
const CAPTAIN_EMAIL = '427cmisku@frhsd.com';
// Full captain-level permissions, but the public-facing role label stays
// whatever it already is (member, in both cases here).
const ADMIN_EMAILS = ['genfire2009@gmail.com', '428akotilingala@frhsd.com', 'akotilingala@gmail.com'];
// Never appears in any roster, regardless of role/approval.
const HIDDEN_FROM_ROSTER_EMAILS = ['genfire2009@gmail.com', 'akotilingala@gmail.com'];

function toUserJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    authProvider: row.authProvider,
    role: row.role,
    subteams: subteamsFromDb(row.subteam),
    isAdmin: !!row.isAdmin,
    approved: !!row.approved,
    isJunior: !!row.isJunior,
  };
}

// Records the user's latest login. One row per user, updated in place - a
// row per login let anyone replaying a Google token fill the free 32 MB
// database (and then every login, which writes here, would fail).
async function logLogin(pool, userId, email) {
  const updated = await pool
    .request()
    .input('userId', sql.NVarChar, userId)
    .query('UPDATE LoginEvents SET timestamp = SYSUTCDATETIME() WHERE userId = @userId');
  if (updated.rowsAffected[0] > 0) return;
  await pool
    .request()
    .input('id', sql.NVarChar, `login-${crypto.randomUUID()}`)
    .input('userId', sql.NVarChar, userId)
    .input('email', sql.NVarChar, email)
    .query('INSERT INTO LoginEvents (id, userId, email) VALUES (@id, @userId, @email)');
}

// Logins per Google account per window. A real person signs in a handful of
// times a day; this stops a script replaying one token. In memory: the API
// runs as a single instance.
const LOGIN_LIMIT = 20;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const recentLogins = new Map(); // email -> { count, since }

function loginAllowed(email) {
  const now = Date.now();
  const entry = recentLogins.get(email);
  if (!entry || now - entry.since > LOGIN_WINDOW_MS) {
    recentLogins.set(email, { count: 1, since: now });
    return true;
  }
  entry.count++;
  return entry.count <= LOGIN_LIMIT;
}

// POST /api/auth/login
// Body: { provider: 'google', idToken: string, name?: string }
// Returns the user plus `sessionToken`, which every other request must send
// as `Authorization: Bearer <sessionToken>`.
router.post('/login', asyncHandler(async (req, res) => {
  const { provider, idToken } = req.body;

  let email, name;
  try {
    if (provider === 'google') {
      ({ email, name } = await verifyGoogleToken(idToken));
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }
  } catch (err) {
    console.error('Token verification failed', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!loginAllowed(email)) {
    return res.status(429).json({ error: 'Too many sign-ins - wait a few minutes and try again' });
  }

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.NVarChar, email)
    .query('SELECT * FROM Users WHERE id = @id');

  if (existing.recordset.length > 0) {
    if (existing.recordset[0].banned) {
      return res.status(403).json({ error: 'This account has been removed from the team' });
    }
    await logLogin(pool, email, email);
    return res.json({ ...toUserJson(existing.recordset[0]), sessionToken: createSessionToken(email) });
  }

  const role = email === CAPTAIN_EMAIL ? 'captain' : 'member';
  const isAdmin = ADMIN_EMAILS.includes(email);
  const hiddenFromRoster = HIDDEN_FROM_ROSTER_EMAILS.includes(email);
  // Captains/admins are pre-vetted and don't need to approve themselves in.
  const approved = role === 'captain' || isAdmin;

  await pool
    .request()
    .input('id', sql.NVarChar, email)
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('authProvider', sql.NVarChar, provider)
    .input('role', sql.NVarChar, role)
    .input('isAdmin', sql.Bit, isAdmin)
    .input('hiddenFromRoster', sql.Bit, hiddenFromRoster)
    .input('approved', sql.Bit, approved)
    .query(
      `INSERT INTO Users (id, name, email, authProvider, role, isAdmin, hiddenFromRoster, approved)
       VALUES (@id, @name, @email, @authProvider, @role, @isAdmin, @hiddenFromRoster, @approved)`,
    );
  await logLogin(pool, email, email);

  res.status(201).json({
    id: email,
    name,
    email,
    authProvider: provider,
    role,
    subteams: [],
    isAdmin,
    approved,
    isJunior: false,
    sessionToken: createSessionToken(email),
  });
}));

module.exports = router;
