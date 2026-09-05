const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');

const router = express.Router();

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// POST /api/extension-requests
// Body: { taskId, requestedBy, newDueDate, reason }
router.post('/', async (req, res) => {
  const { taskId, requestedBy, newDueDate, reason } = req.body;

  if (!taskId || !requestedBy || !newDueDate || !reason) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const id = newId('ext');
  const pool = await getPool();

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

  res.status(201).json({ id, taskId, requestedBy, newDueDate, reason, status: 'pending' });
});

// GET /api/extension-requests?status=pending
router.get('/', async (req, res) => {
  const status = req.query.status;
  const pool = await getPool();
  const request = pool.request();
  let query = 'SELECT * FROM ExtensionRequests';
  if (status) {
    request.input('status', sql.NVarChar, status);
    query += ' WHERE status = @status';
  }
  const result = await request.query(query);
  res.json(result.recordset);
});

// PATCH /api/extension-requests/:id
// Body: { status: 'approved'|'denied', actorId }
router.patch('/:id', async (req, res) => {
  const id = req.params.id;
  const { status, actorId } = req.body;

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
      .query('UPDATE Tasks SET dueDate = @dueDate WHERE id = @taskId');
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

  res.json({ id, status });
});

module.exports = router;
