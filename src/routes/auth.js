const express = require('express');
const { sql, getPool } = require('../db');
const { verifyGoogleToken } = require('../authVerify');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function toUserJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    authProvider: row.authProvider,
    role: row.role,
  };
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
    return res.json(toUserJson(existing.recordset[0]));
  }

  await pool
    .request()
    .input('id', sql.NVarChar, email)
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('authProvider', sql.NVarChar, provider)
    .query(
      `INSERT INTO Users (id, name, email, authProvider, role)
       VALUES (@id, @name, @email, @authProvider, 'member')`,
    );

  res.status(201).json({ id: email, name, email, authProvider: provider, role: 'member' });
}));

module.exports = router;
