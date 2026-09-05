const express = require('express');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const SUBTEAMS = ['mechanical', 'outreach', 'programming', 'strategy'];

// GET /api/users
router.get('/', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .query('SELECT id, name, email, role, subteam FROM Users ORDER BY name ASC');
  res.json(result.recordset);
}));

// GET /api/users/login-log
router.get('/login-log', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const accountCount = await pool.request().query('SELECT COUNT(*) AS count FROM Users');
  const accounts = await pool.request().query(`
    SELECT u.id, u.name, u.email, u.role, u.subteam,
           (SELECT MAX(timestamp) FROM LoginEvents le WHERE le.userId = u.id) AS lastLoginAt
    FROM Users u
    ORDER BY lastLoginAt DESC
  `);
  res.json({
    accountCount: accountCount.recordset[0].count,
    accounts: accounts.recordset,
  });
}));

// PATCH /api/users/:id
// Body: { role?: 'captain'|'member', name?: string, subteam?: string }
router.patch('/:id', asyncHandler(async (req, res) => {
  const { role, name, subteam } = req.body;

  if (role !== undefined && !['captain', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be captain or member' });
  }
  if (subteam !== undefined && !SUBTEAMS.includes(subteam)) {
    return res.status(400).json({ error: `subteam must be one of: ${SUBTEAMS.join(', ')}` });
  }
  if (role === undefined && name === undefined && subteam === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const pool = await getPool();
  const request = pool.request().input('id', sql.NVarChar, req.params.id);
  const setClauses = [];

  if (role !== undefined) {
    request.input('role', sql.NVarChar, role);
    setClauses.push('role = @role');
  }
  if (name !== undefined) {
    request.input('name', sql.NVarChar, name);
    setClauses.push('name = @name');
  }
  if (subteam !== undefined) {
    request.input('subteam', sql.NVarChar, subteam);
    setClauses.push('subteam = @subteam');
  }

  await request.query(`UPDATE Users SET ${setClauses.join(', ')} WHERE id = @id`);
  res.json({ id: req.params.id, role, name, subteam });
}));

module.exports = router;
