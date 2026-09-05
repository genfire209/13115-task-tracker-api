const { app } = require('@azure/functions');
const { sql, getPool } = require('../db');
const { verifyGoogleToken, verifyAppleToken } = require('../authVerify');

/**
 * POST /api/auth/login
 * Body: { provider: 'google'|'apple', idToken: string, name?: string }
 * Verifies the id token server-side, then creates or fetches the matching
 * user row. Returns { id, name, email, authProvider, role }.
 */
app.http('authLogin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: async (request, context) => {
    const body = await request.json();
    const { provider, idToken, name: fallbackName } = body;

    let email, name;
    try {
      if (provider === 'google') {
        ({ email, name } = await verifyGoogleToken(idToken));
      } else if (provider === 'apple') {
        ({ email } = await verifyAppleToken(idToken));
        name = fallbackName || email;
      } else {
        return { status: 400, jsonBody: { error: 'Unknown provider' } };
      }
    } catch (err) {
      context.error('Token verification failed', err);
      return { status: 401, jsonBody: { error: 'Invalid token' } };
    }

    const pool = await getPool();

    const existing = await pool
      .request()
      .input('id', sql.NVarChar, email)
      .query('SELECT * FROM Users WHERE id = @id');

    if (existing.recordset.length > 0) {
      const user = existing.recordset[0];
      return { jsonBody: toUserJson(user) };
    }

    await pool
      .request()
      .input('id', sql.NVarChar, email)
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('authProvider', sql.NVarChar, provider)
      .query(
        `INSERT INTO Users (id, name, email, authProvider, role)
         VALUES (@id, @name, @email, @authProvider, 'member')`,
      );

    return {
      jsonBody: {
        id: email,
        name,
        email,
        authProvider: provider,
        role: 'member',
      },
    };
  },
});

function toUserJson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    authProvider: row.authProvider,
    role: row.role,
  };
}
