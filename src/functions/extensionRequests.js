const { app } = require('@azure/functions');
const crypto = require('crypto');
const { sql, getPool } = require('../db');

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

// POST /api/extension-requests
// Body: { taskId, requestedBy, newDueDate, reason }
app.http('createExtensionRequest', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'extension-requests',
  handler: async (request) => {
    const body = await request.json();
    const { taskId, requestedBy, newDueDate, reason } = body;

    if (!taskId || !requestedBy || !newDueDate || !reason) {
      return { status: 400, jsonBody: { error: 'Missing required fields' } };
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

    return { status: 201, jsonBody: { id, taskId, requestedBy, newDueDate, reason, status: 'pending' } };
  },
});

// GET /api/extension-requests?status=pending
app.http('listExtensionRequests', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'extension-requests',
  handler: async (request) => {
    const status = request.query.get('status');
    const pool = await getPool();
    const req = pool.request();
    let query = 'SELECT * FROM ExtensionRequests';
    if (status) {
      req.input('status', sql.NVarChar, status);
      query += ' WHERE status = @status';
    }
    const result = await req.query(query);
    return { jsonBody: result.recordset };
  },
});

// PATCH /api/extension-requests/{id}
// Body: { status: 'approved'|'denied', actorId }
app.http('decideExtensionRequest', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'extension-requests/{id}',
  handler: async (request) => {
    const id = request.params.id;
    const body = await request.json();
    const { status, actorId } = body;

    if (!['approved', 'denied'].includes(status) || !actorId) {
      return { status: 400, jsonBody: { error: 'status must be approved or denied, and actorId is required' } };
    }

    const pool = await getPool();
    const existing = await pool
      .request()
      .input('id', sql.NVarChar, id)
      .query('SELECT * FROM ExtensionRequests WHERE id = @id');

    if (existing.recordset.length === 0) {
      return { status: 404, jsonBody: { error: 'Extension request not found' } };
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

    return { jsonBody: { id, status } };
  },
});
