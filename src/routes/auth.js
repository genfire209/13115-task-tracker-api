const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const { verifyGoogleToken } = require('../authVerify');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

// This account always gets the captain role on account creation.
const CAPTAIN_EMAIL = 'genfire2009@gmail.com';

function toUserJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    authProvider: row.authProvider,
    role: row.role,
    subteam: row.subteam,
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
  await pool
    .request()
    .input('id', sql.NVarChar, email)
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('authProvider', sql.NVarChar, provider)
    .input('role', sql.NVarChar, role)
    .query(
      `INSERT INTO Users (id, name, email, authProvider, role)
       VALUES (@id, @name, @email, @authProvider, @role)`,
    );
  await logLogin(pool, email, email);

  res.status(201).json({ id: email, name, email, authProvider: provider, role, subteam: null });
}));

module.exports = router;
