const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const {
  sendToUser,
  sendToAllUsers,
  sendToCaptainsAndAdmins,
  sendTestNotification,
} = require('../push');
const { subteamsToDb, subteamsFromDb, isValidSubteamsArray } = require('../subteams');
const {
  requireApproved,
  requireCaptainAccess,
  actorIdFor,
  permitted,
  hasCaptainAccess,
} = require('../authenticate');

const router = express.Router();

// Changing who's captain is deliberately locked down to one specific
// account plus a PIN (CAPTAIN_CHANGE_PIN env var) - not just any admin.
const CAPTAIN_CHANGE_OWNER = '428akotilingala@frhsd.com';

// Wrong PINs lock the captain change for a while, so the PIN can't be
// brute-forced. In memory: the API runs as a single instance.
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
const pinFailures = new Map(); // requesterId -> { count, since }

function pinLockedOut(requesterId) {
  const entry = pinFailures.get(requesterId);
  if (entry && Date.now() - entry.since > PIN_LOCKOUT_MS) pinFailures.delete(requesterId);
  return (pinFailures.get(requesterId)?.count || 0) >= PIN_MAX_FAILURES;
}

function recordPinFailure(requesterId) {
  const entry = pinFailures.get(requesterId);
  if (entry) entry.count++;
  else pinFailures.set(requesterId, { count: 1, since: Date.now() });
}

function pinMatches(given, expected) {
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

// Names show up in captains' notifications and lists: one line, sensible length.
const NAME_MAX = 60;

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  // eslint-disable-next-line no-control-regex
  if (!trimmed || trimmed.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function withSubteams(row) {
  const { subteam, isJunior, ...rest } = row;
  return { ...rest, subteams: subteamsFromDb(subteam), isJunior: !!isJunior };
}

// POST /api/users/:id/test-notification
// Debug-only: sends a fixed test push and reports success/failure directly.
// To your own device, or anyone's for an admin.
router.post('/:id/test-notification', asyncHandler(async (req, res) => {
  if (!permitted(req, req.user?.id === req.params.id || !!req.user?.isAdmin)) {
    return res.status(403).json({ error: 'You can only test your own notifications' });
  }
  try {
    const result = await sendTestNotification(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}));

// POST /api/users/broadcast
// Body: { title, body }. Pushes to every non-banned user with a device
// token. Captains/admins only.
router.post('/broadcast', asyncHandler(async (req, res) => {
  const requesterId = actorIdFor(req, req.query.requesterId);
  const { title, body } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  const pool = await getPool();
  const requester = requesterId
    ? await pool
        .request()
        .input('id', sql.NVarChar, requesterId)
        .query('SELECT role, isAdmin FROM Users WHERE id = @id')
    : null;
  const hasCaptainAccess =
    requester?.recordset[0]?.role === 'captain' || !!requester?.recordset[0]?.isAdmin;
  if (!hasCaptainAccess) {
    return res.status(403).json({ error: 'Only a captain or admin can broadcast' });
  }

  const result = await sendToAllUsers({ title, body, data: { type: 'broadcast' } });
  res.json({ ok: true, ...result });
}));

// GET /api/users
// General-purpose roster: approved, non-banned, non-hidden members only.
router.get('/', requireApproved, asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, email, authProvider, role, subteam, isJunior FROM Users
    WHERE banned = 0 AND approved = 1 AND hiddenFromRoster = 0
    ORDER BY name ASC
  `);
  res.json(result.recordset.map(withSubteams));
}));

// GET /api/users/pending-approval
// New members waiting on a captain/admin to let them in.
router.get('/pending-approval', requireCaptainAccess, asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, email, authProvider, role, subteam, isJunior FROM Users
    WHERE banned = 0 AND approved = 0
    ORDER BY name ASC
  `);
  res.json(result.recordset.map(withSubteams));
}));

// GET /api/users/login-log
// Captains/admins see every account's login activity; everyone else sees only their own.
router.get('/login-log', asyncHandler(async (req, res) => {
  const requesterId = actorIdFor(req, req.query.requesterId);
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
    accounts: accounts.recordset.map(withSubteams),
  });
}));

// GET /api/users/:id
// Single-user lookup, used by the client to refresh its own approval status.
// Your own record, or anyone's for a captain/admin.
router.get('/:id', asyncHandler(async (req, res) => {
  if (!permitted(req, req.user?.id === req.params.id || hasCaptainAccess(req.user))) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.NVarChar, req.params.id)
    .query(
      'SELECT id, name, email, authProvider, role, subteam, isAdmin, approved, isJunior FROM Users WHERE id = @id AND banned = 0',
    );
  if (result.recordset.length === 0) {
    // Also covers a banned account — treat it as gone so the client drops
    // any locally cached session for them.
    return res.status(404).json({ error: 'User not found' });
  }
  const row = result.recordset[0];
  res.json({ ...withSubteams(row), isAdmin: !!row.isAdmin, approved: !!row.approved });
}));

// PATCH /api/users/:id
// Body: { role?, name?, subteams?, banned?, approved?, pushToken?, isJunior?, pin? }
// subteams is a non-empty array of the 4 known subteam strings; a user can
// belong to more than one. You can change your own name, subteams and
// device token; captains/admins can also rename, re-team, approve, remove
// and move other members between junior and main. `role` (who's captain)
// is limited to CAPTAIN_CHANGE_OWNER with the CAPTAIN_CHANGE_PIN.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { role, name, subteams, banned, approved, pushToken, isJunior, pin } = req.body;
  const requesterId = actorIdFor(req, req.body.requesterId);

  if (!req.legacy) {
    const isSelf = req.user.id === req.params.id;
    const captain = hasCaptainAccess(req.user);
    const changesProfile = name !== undefined || subteams !== undefined;
    const changesMembership = banned !== undefined || approved !== undefined || isJunior !== undefined;
    if ((pushToken !== undefined && !isSelf) || (changesProfile && !isSelf && !captain) || (changesMembership && !captain)) {
      return res.status(403).json({ error: "You can't change that for this account" });
    }
    // Admins (and the owner account) can only be removed, renamed or changed
    // by another admin - so the captain can't lock out whoever runs the app.
    if (!isSelf && (changesProfile || changesMembership) && !req.user.isAdmin) {
      const target = await (await getPool())
        .request()
        .input('id', sql.NVarChar, req.params.id)
        .query('SELECT isAdmin FROM Users WHERE id = @id');
      if (target.recordset[0]?.isAdmin || req.params.id === CAPTAIN_CHANGE_OWNER) {
        return res.status(403).json({ error: "Only an admin can change an admin's account" });
      }
    }
  }

  if (role !== undefined) {
    if (!['captain', 'member'].includes(role)) {
      return res.status(400).json({ error: 'role must be captain or member' });
    }
    if (requesterId !== CAPTAIN_CHANGE_OWNER) {
      return res.status(403).json({ error: 'Only the team owner can change who is captain' });
    }
    if (pinLockedOut(requesterId)) {
      return res.status(429).json({ error: 'Too many wrong PINs - try again in 15 minutes' });
    }
    const expectedPin = process.env.CAPTAIN_CHANGE_PIN;
    if (!expectedPin || !pinMatches(pin, expectedPin)) {
      recordPinFailure(requesterId);
      return res.status(403).json({ error: 'Incorrect PIN' });
    }
    pinFailures.delete(requesterId);
  }
  if (name !== undefined && cleanName(name) === null) {
    return res.status(400).json({ error: `Name must be 1-${NAME_MAX} characters on one line` });
  }
  if (subteams !== undefined && !isValidSubteamsArray(subteams)) {
    return res.status(400).json({
      error: 'subteams must be a non-empty array of: mechanical, outreach, programming, strategy',
    });
  }
  if (
    role === undefined &&
    name === undefined &&
    subteams === undefined &&
    banned === undefined &&
    approved === undefined &&
    pushToken === undefined &&
    isJunior === undefined
  ) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const pool = await getPool();

  // A device token belongs to one phone: if another account signed in on
  // this phone before, stop sending that account's pushes here.
  if (pushToken) {
    await pool
      .request()
      .input('id', sql.NVarChar, req.params.id)
      .input('pushToken', sql.NVarChar, pushToken)
      .query('UPDATE Users SET pushToken = NULL WHERE pushToken = @pushToken AND id <> @id');
  }

  const existing = await pool
    .request()
    .input('id', sql.NVarChar, req.params.id)
    .query('SELECT name, approved, subteam FROM Users WHERE id = @id');
  const wasApproved = !!existing.recordset[0]?.approved;
  const wasOnboarded = !!existing.recordset[0]?.subteam;
  const currentName = existing.recordset[0]?.name;

  const request = pool.request().input('id', sql.NVarChar, req.params.id);
  const setClauses = [];

  if (role !== undefined) {
    request.input('role', sql.NVarChar, role);
    setClauses.push('role = @role');
  }
  if (name !== undefined) {
    request.input('name', sql.NVarChar, cleanName(name));
    setClauses.push('name = @name');
  }
  if (subteams !== undefined) {
    request.input('subteam', sql.NVarChar, subteamsToDb(subteams));
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
  if (isJunior !== undefined) {
    request.input('isJunior', sql.Bit, isJunior);
    setClauses.push('isJunior = @isJunior');
  }

  await request.query(`UPDATE Users SET ${setClauses.join(', ')} WHERE id = @id`);

  // Only when onboarding first completes - not on every later subteam
  // change, which let one unapproved account push captains endlessly.
  if (subteams !== undefined && !wasApproved && !wasOnboarded) {
    sendToCaptainsAndAdmins({
      title: 'New member needs approval',
      body: `${cleanName(name) || currentName || req.params.id} completed onboarding`,
      data: { userId: req.params.id, type: 'member_needs_approval' },
    });
  }
  if (approved === true && !wasApproved) {
    sendToUser(req.params.id, {
      title: "You're approved!",
      body: 'Welcome to the team — you can now see the task board.',
      data: { type: 'member_approved' },
    });
  }

  res.json({ id: req.params.id, role, name, subteams, banned, approved, isJunior });
}));

module.exports = router;
