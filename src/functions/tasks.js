const { app } = require('@azure/functions');
const crypto = require('crypto');
const { sql, getPool } = require('../db');

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
app.http('listTasks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: async () => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM Tasks ORDER BY dueDate ASC');
    return { jsonBody: result.recordset };
  },
});

// GET /api/tasks/{id}/events
app.http('taskEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tasks/{id}/events',
  handler: async (request) => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('taskId', sql.NVarChar, request.params.id)
      .query('SELECT * FROM TaskEvents WHERE taskId = @taskId ORDER BY timestamp ASC');
    return { jsonBody: result.recordset };
  },
});

// POST /api/tasks
// Body: { title, description, category, createdBy, assignedTo, dueDate }
app.http('createTask', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'tasks',
  handler: async (request) => {
    const body = await request.json();
    const { title, description, category, createdBy, assignedTo, dueDate } = body;

    if (!title || !category || !createdBy || !dueDate) {
      return { status: 400, jsonBody: { error: 'Missing required fields' } };
    }

    // Self-published work (assignee === creator) is auto-accepted;
    // a captain assigning to someone else needs their acceptance first.
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

    return { status: 201, jsonBody: { id, title, description, category, createdBy, assignedTo, status, dueDate } };
  },
});

// PATCH /api/tasks/{id}
// Body: { action: 'claim'|'accept'|'decline'|'complete', actorId, reason? }
app.http('updateTask', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'tasks/{id}',
  handler: async (request) => {
    const taskId = request.params.id;
    const body = await request.json();
    const { action, actorId, reason } = body;

    if (!action || !actorId) {
      return { status: 400, jsonBody: { error: 'Missing action or actorId' } };
    }
    if (action === 'decline' && !reason) {
      return { status: 400, jsonBody: { error: 'A reason is required to decline a task' } };
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
        return { status: 400, jsonBody: { error: 'Unknown action' } };
    }

    const req = pool.request().input('id', sql.NVarChar, taskId).input('status', sql.NVarChar, newStatus);
    let setClause = 'status = @status';
    if (newAssignedTo !== undefined) {
      req.input('assignedTo', sql.NVarChar, newAssignedTo);
      setClause += ', assignedTo = @assignedTo';
    }
    await req.query(`UPDATE Tasks SET ${setClause} WHERE id = @id`);

    await logEvent(pool, taskId, action, actorId, reason);

    return { jsonBody: { id: taskId, status: newStatus } };
  },
});
