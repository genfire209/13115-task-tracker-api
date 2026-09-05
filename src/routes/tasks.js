const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');

const router = express.Router();

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function logEvent(pool, taskId, action, actorId, reason) {
  await pool
    .request()
    .input('id', sql.NVarChar, newId('evt'))
    .input('taskId', sql.NVarChar, taskId)
    .input('action', sql.NVarChar, action)
    .input('actorId', sql.NVarChar, actorId)
    .input('reason', sql.NVarChar, reason || null)
    .query(
      `INSERT INTO TaskEvents (id, taskId, action, actorId, reason)
       VALUES (@id, @taskId, @action, @actorId, @reason)`,
    );
}

// GET /api/tasks
router.get('/', async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Tasks ORDER BY dueDate ASC');
  res.json(result.recordset);
});

// GET /api/tasks/:id/events
router.get('/:id/events', async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('taskId', sql.NVarChar, req.params.id)
    .query('SELECT * FROM TaskEvents WHERE taskId = @taskId ORDER BY timestamp ASC');
  res.json(result.recordset);
});

// POST /api/tasks
// Body: { title, description, category, createdBy, assignedTo, dueDate }
router.post('/', async (req, res) => {
  const { title, description, category, createdBy, assignedTo, dueDate } = req.body;

  if (!title || !category || !createdBy || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const selfPublished = assignedTo && assignedTo === createdBy;
  const status = !assignedTo ? 'open' : selfPublished ? 'accepted' : 'pending_acceptance';

  const id = newId('task');
  const pool = await getPool();

  await pool
    .request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, title)
    .input('description', sql.NVarChar, description || '')
    .input('category', sql.NVarChar, category)
    .input('createdBy', sql.NVarChar, createdBy)
    .input('assignedTo', sql.NVarChar, assignedTo || null)
    .input('status', sql.NVarChar, status)
    .input('dueDate', sql.DateTime2, new Date(dueDate))
    .query(
      `INSERT INTO Tasks (id, title, description, category, createdBy, assignedTo, status, dueDate)
       VALUES (@id, @title, @description, @category, @createdBy, @assignedTo, @status, @dueDate)`,
    );

  await logEvent(
    pool,
    id,
    !assignedTo ? 'created_open' : selfPublished ? 'self_published' : 'assigned',
    createdBy,
  );

  res.status(201).json({ id, title, description, category, createdBy, assignedTo, status, dueDate });
});

// PATCH /api/tasks/:id
// Body: { action: 'claim'|'accept'|'decline'|'complete', actorId, reason? }
router.patch('/:id', async (req, res) => {
  const taskId = req.params.id;
  const { action, actorId, reason } = req.body;

  if (!action || !actorId) {
    return res.status(400).json({ error: 'Missing action or actorId' });
  }
  if (action === 'decline' && !reason) {
    return res.status(400).json({ error: 'A reason is required to decline a task' });
  }

  const pool = await getPool();
  let newStatus;
  let newAssignedTo; // undefined = leave unchanged

  switch (action) {
    case 'claim':
      newStatus = 'accepted';
      newAssignedTo = actorId;
      break;
    case 'accept':
      newStatus = 'accepted';
      break;
    case 'decline':
      newStatus = 'declined';
      newAssignedTo = null;
      break;
    case 'complete':
      newStatus = 'completed';
      break;
    default:
      return res.status(400).json({ error: 'Unknown action' });
  }

  const request = pool.request().input('id', sql.NVarChar, taskId).input('status', sql.NVarChar, newStatus);
  let setClause = 'status = @status';
  if (newAssignedTo !== undefined) {
    request.input('assignedTo', sql.NVarChar, newAssignedTo);
    setClause += ', assignedTo = @assignedTo';
  }
  await request.query(`UPDATE Tasks SET ${setClause} WHERE id = @id`);

  await logEvent(pool, taskId, action, actorId, reason);

  res.json({ id: taskId, status: newStatus });
});

module.exports = router;
