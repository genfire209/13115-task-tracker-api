const { app } = require('@azure/functions');
const { sql, getPool } = require('../db');

// GET /api/users - used to populate the "assign to" list in the app
app.http('listUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users',
  handler: async () => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT id, name, email, role FROM Users ORDER BY name ASC');
    return { jsonBody: result.recordset };
  },
});

// PATCH /api/users/{id} - captain-only role change, e.g. promoting a co-captain
// Body: { role: 'captain'|'member' }
app.http('updateUserRole', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'users/{id}',
  handler: async (request) => {
    const body = await request.json();
    const { role } = body;
    if (!['captain', 'member'].includes(role)) {
      return { status: 400, jsonBody: { error: 'role must be captain or member' } };
    }
    const pool = await getPool();
    await pool
      .request()
      .input('id', sql.NVarChar, request.params.id)
      .input('role', sql.NVarChar, role)
      .query('UPDATE Users SET role = @role WHERE id = @id');
    return { jsonBody: { id: request.params.id, role } };
  },
});
