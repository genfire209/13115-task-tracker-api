const express = require('express');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const SUBTEAMS = ['mechanical', 'outreach', 'programming', 'strategy'];

// GET /api/users
// General-purpose roster: approved, non-banned, non-hidden members only.
router.get('/', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, email, authProvider, role, subteam FROM Users
    WHERE banned = 0 AND approved = 1 AND hiddenFromRoster = 0
    ORDER BY name ASC
  `);
  res.json(result.recordset);
}));

// GET /api/users/pending-approval
// New members waiting on a captain/admin to let them in.
router.get('/pending-approval', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, email, authProvider, role, subteam FROM Users
    WHERE banned = 0 AND approved = 0
    ORDER BY name ASC
  `);
  res.json(result.recordset);
}));

// GET /api/users/login-log?requesterId=...
// Captains/admins see every account's login activity; everyone else sees only their own.
router.get('/login-log', asyncHandler(async (req, res) => {
  const { requesterId } = req.query;
  const pool = await getPool();

  const accountCount = await pool
    .request()
    .query('SELECT COUNT(*) AS count FROM Users WHERE banned = 0 AND hiddenFromRoster = 0');

  const requester = requesterId
    ? await pool
        .request()
        .input('id', sql.NVarChar, requesterId)
        .query('SELECT role, isAdmin FROM Users WHERE id = @id')
    : null;
  const hasCaptainAccess =
    requester?.recordset[0]?.role === 'captain' || !!requester?.recordset[0]?.isAdmin;

  const accountsQuery = `
    SELECT u.id, u.name, u.email, u.role, u.subteam,
           (SELECT MAX(timestamp) FROM LoginEvents le WHERE le.userId = u.id) AS lastLoginAt
    FROM Users u
    WHERE u.banned = 0 AND u.hiddenFromRoster = 0 ${hasCaptainAccess ? '' : 'AND u.id = @requesterId'}
    ORDER BY lastLoginAt DESC
  `;
  const request = pool.request();
  if (!hasCaptainAccess) request.input('requesterId', sql.NVarChar, requesterId || '');
  const accounts = await request.query(accountsQuery);

  res.json({
    accountCount: accountCount.recordset[0].count,
    accounts: accounts.recordset,
  });
}));

// GET /api/users/:id
// Single-user lookup, used by the client to refresh its own approval status.
router.get('/:id', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.NVarChar, req.params.id)
    .query(
      'SELECT id, name, email, authProvider, role, subteam, isAdmin, approved FROM Users WHERE id = @id',
    );
  if (result.recordset.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.recordset[0];
  res.json({ ...row, isAdmin: !!row.isAdmin, approved: !!row.approved });
}));

// PATCH /api/users/:id
// Body: { role?, name?, subteam?, banned?, approved?, pushToken? }
router.patch('/:id', asyncHandler(async (req, res) => {
  const { role, name, subteam, banned, approved, pushToken } = req.body;

  if (role !== undefined && !['captain', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be captain or member' });
  }
  if (subteam !== undefined && !SUBTEAMS.includes(subteam)) {
    return res.status(400).json({ error: `subteam must be one of: ${SUBTEAMS.join(', ')}` });
  }
  if (
    role === undefined &&
    name === undefined &&
    subteam === undefined &&
    banned === undefined &&
    approved === undefined &&
    pushToken === undefined
  ) {
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
  if (banned !== undefined) {
    request.input('banned', sql.Bit, banned);
    setClauses.push('banned = @banned');
  }
  if (approved !== undefined) {
    request.input('approved', sql.Bit, approved);
    setClauses.push('approved = @approved');
  }
  if (pushToken !== undefined) {
    request.input('pushToken', sql.NVarChar, pushToken);
    setClauses.push('pushToken = @pushToken');
  }

  await request.query(`UPDATE Users SET ${setClauses.join(', ')} WHERE id = @id`);
  res.json({ id: req.params.id, role, name, subteam, banned, approved });
}));

module.exports = router;
