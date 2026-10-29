const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { sendToUser, sendToCaptainsAndAdmins } = require('../push');
const { actorIdFor, requireCaptainAccess, userIdsFor } = require('../authenticate');

const router = express.Router();

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function getTaskTitle(pool, taskId) {
  const result = await pool
    .request()
    .input('id', sql.NVarChar, taskId)
    .query('SELECT title FROM Tasks WHERE id = @id');
  return result.recordset[0]?.title || taskId;
}

async function getUserName(pool, userId) {
  const result = await pool
    .request()
    .input('id', sql.NVarChar, userId)
    .query('SELECT name FROM Users WHERE id = @id');
  return result.recordset[0]?.name || userId;
}

// POST /api/extension-requests
// Body: { taskId, newDueDate, reason }. Only the task's assignee can ask.
router.post('/', asyncHandler(async (req, res) => {
  const { taskId, newDueDate, reason } = req.body;
  const requestedBy = actorIdFor(req, req.body.requestedBy);

  if (!taskId || !requestedBy || !newDueDate || !reason) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const id = newId('ext');
  const pool = await getPool();

  if (!req.legacy) {
    const task = await pool
      .request()
      .input('id', sql.NVarChar, taskId)
      .query('SELECT assignedTo, status FROM Tasks WHERE id = @id');
    const row = task.recordset[0];
    if (!row || row.assignedTo !== requestedBy || row.status === 'completed') {
      return res.status(403).json({ error: 'Only the person doing this task can ask for more time' });
    }
  }

  await pool
    .request()
    .input('id', sql.NVarChar, id)
    .input('taskId', sql.NVarChar, taskId)
    .input('requestedBy', sql.NVarChar, requestedBy)
    .input('newDueDate', sql.DateTime2, new Date(newDueDate))
    .input('reason', sql.NVarChar, reason)
    .query(
      `INSERT INTO ExtensionRequests (id, taskId, requestedBy, newDueDate, reason, status)
       VALUES (@id, @taskId, @requestedBy, @newDueDate, @reason, 'pending')`,
    );

  await pool
    .request()
    .input('id', sql.NVarChar, newId('evt'))
    .input('taskId', sql.NVarChar, taskId)
    .input('action', sql.NVarChar, 'extension_requested')
    .input('actorId', sql.NVarChar, requestedBy)
    .input('reason', sql.NVarChar, reason)
    .query(
      `INSERT INTO TaskEvents (id, taskId, action, actorId, reason)
       VALUES (@id, @taskId, @action, @actorId, @reason)`,
    );

  const [title, requesterName] = await Promise.all([
    getTaskTitle(pool, taskId),
    getUserName(pool, requestedBy),
  ]);
  sendToCaptainsAndAdmins({
    title: 'Extension request',
    body: `${requesterName} requested more time on "${title}"`,
    data: { taskId, type: 'extension_requested' },
  });

  res.status(201).json({ id, taskId, requestedBy, newDueDate, reason, status: 'pending' });
}));

// GET /api/extension-requests?status=pending
router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const pool = await getPool();
  const request = pool.request();
  let query = 'SELECT * FROM ExtensionRequests';
  if (status) {
    request.input('status', sql.NVarChar, status);
    query += ' WHERE status = @status';
  }
  const result = await request.query(query);
  const shown = userIdsFor(req);
  res.json(result.recordset.map((r) => ({ ...r, requestedBy: shown(r.requestedBy) })));
}));

// PATCH /api/extension-requests/:id
// Body: { status: 'approved'|'denied' }. Captains/admins only.
router.patch('/:id', requireCaptainAccess, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const actorId = actorIdFor(req, req.body.actorId);

  if (!['approved', 'denied'].includes(status) || !actorId) {
    return res.status(400).json({ error: 'status must be approved or denied, and actorId is required' });
  }

  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.NVarChar, id)
    .query('SELECT * FROM ExtensionRequests WHERE id = @id');

  if (existing.recordset.length === 0) {
    return res.status(404).json({ error: 'Extension request not found' });
  }
  const extReq = existing.recordset[0];

  await pool
    .request()
    .input('id', sql.NVarChar, id)
    .input('status', sql.NVarChar, status)
    .query('UPDATE ExtensionRequests SET status = @status WHERE id = @id');

  if (status === 'approved') {
    await pool
      .request()
      .input('taskId', sql.NVarChar, extReq.taskId)
      .input('dueDate', sql.DateTime2, extReq.newDueDate)
      // New deadline hasn't had a reminder fire for it yet.
      .query('UPDATE Tasks SET dueDate = @dueDate, reminderSentAt = NULL WHERE id = @taskId');
  }

  await pool
    .request()
    .input('id', sql.NVarChar, newId('evt'))
    .input('taskId', sql.NVarChar, extReq.taskId)
    .input('action', sql.NVarChar, status === 'approved' ? 'extension_approved' : 'extension_denied')
    .input('actorId', sql.NVarChar, actorId)
    .query(
      `INSERT INTO TaskEvents (id, taskId, action, actorId)
       VALUES (@id, @taskId, @action, @actorId)`,
    );

  const title = await getTaskTitle(pool, extReq.taskId);
  sendToUser(extReq.requestedBy, {
    title: status === 'approved' ? 'Extension approved' : 'Extension denied',
    body: title,
    data: { taskId: extReq.taskId, type: `extension_${status}` },
  });

  res.json({ id, status });
}));

module.exports = router;
