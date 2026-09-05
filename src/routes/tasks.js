const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const FK_VIOLATION = 547;

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
router.get('/', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM Tasks ORDER BY dueDate ASC');
  res.json(result.recordset);
}));

// GET /api/tasks/:id/events
router.get('/:id/events', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('taskId', sql.NVarChar, req.params.id)
    .query('SELECT * FROM TaskEvents WHERE taskId = @taskId ORDER BY timestamp ASC');
  res.json(result.recordset);
}));

// POST /api/tasks
// Body: { title, description, category, createdBy, assignedTo, dueDate }
router.post('/', asyncHandler(async (req, res) => {
  const { title, description, category, createdBy, assignedTo, dueDate } = req.body;

  if (!title || !category || !createdBy || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const selfPublished = assignedTo && assignedTo === createdBy;
  const status = !assignedTo ? 'open' : selfPublished ? 'accepted' : 'pending_acceptance';

  const id = newId('task');
  const pool = await getPool();

  try {
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
  } catch (err) {
    if (err.number === FK_VIOLATION) {
      return res.status(400).json({ error: 'createdBy or assignedTo does not match a known user id' });
    }
    throw err;
  }

  await logEvent(
    pool,
    id,
    !assignedTo ? 'created_open' : selfPublished ? 'self_published' : 'assigned',
    createdBy,
  );

  res.status(201).json({ id, title, description, category, createdBy, assignedTo, status, dueDate });
}));

// PATCH /api/tasks/:id
// Body: { action: 'claim'|'accept'|'decline'|'complete'|'reassign'|'approve_volunteer'|'volunteer', actorId, reason?, newAssigneeId? }
router.patch('/:id', asyncHandler(async (req, res) => {
  const taskId = req.params.id;
  const { action, actorId, reason, newAssigneeId } = req.body;

  if (!action || !actorId) {
    return res.status(400).json({ error: 'Missing action or actorId' });
  }
  if (action === 'decline' && !reason) {
    return res.status(400).json({ error: 'A reason is required to decline a task' });
  }
  if ((action === 'reassign' || action === 'approve_volunteer') && !newAssigneeId) {
    return res.status(400).json({ error: 'newAssigneeId is required to reassign a task' });
  }

  const pool = await getPool();

  // 'volunteer' just records interest on a declined task for the captain to
  // review; it doesn't change the task's status or assignee.
  if (action === 'volunteer') {
    try {
      await logEvent(pool, taskId, action, actorId, reason);
    } catch (err) {
      if (err.number === FK_VIOLATION) {
        return res.status(400).json({ error: 'actorId does not match a known user id' });
      }
      throw err;
    }
    return res.json({ id: taskId });
  }

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
    case 'reassign':
      // Captain-picked assignee who hasn't opted in yet still has to accept.
      newStatus = 'pending_acceptance';
      newAssignedTo = newAssigneeId;
      break;
    case 'approve_volunteer':
      // They already said they'd take it, so skip the redundant accept step.
      newStatus = 'accepted';
      newAssignedTo = newAssigneeId;
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

  try {
    await request.query(`UPDATE Tasks SET ${setClause} WHERE id = @id`);
  } catch (err) {
    if (err.number === FK_VIOLATION) {
      return res.status(400).json({ error: 'actorId does not match a known user id' });
    }
    throw err;
  }

  await logEvent(pool, taskId, action, actorId, reason);

  res.json({ id: taskId, status: newStatus });
}));

module.exports = router;
