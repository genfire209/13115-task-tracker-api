const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const { verifyGoogleToken } = require('../authVerify');
const asyncHandler = require('../asyncHandler');

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
    subteam: row.subteam,
    isAdmin: !!row.isAdmin,
    approved: !!row.approved,
  };
}

async function logLogin(pool, userId, email) {
  await pool
    .request()
    .input('id', sql.NVarChar, `login-${crypto.randomUUID()}`)
    .input('userId', sql.NVarChar, userId)
    .input('email', sql.NVarChar, email)
    .query('INSERT INTO LoginEvents (id, userId, email) VALUES (@id, @userId, @email)');
}

// POST /api/auth/login
// Body: { provider: 'google', idToken: string, name?: string }
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
    return res.json(toUserJson(existing.recordset[0]));
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
    subteam: null,
    isAdmin,
    approved,
  });
}));

module.exports = router;
