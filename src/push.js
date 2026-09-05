// Best-effort push notifications via Firebase Cloud Messaging. Every function
// here swallows its own errors — a failed push should never break the
// request that triggered it.
const admin = require('firebase-admin');
const { sql, getPool } = require('./db');

let initialized = false;

function ensureInitialized() {
  if (initialized) return true;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set; push notifications disabled');
    return false;
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
  initialized = true;
  return true;
}

function stringifyData(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    out[key] = String(value);
  }
  return out;
}

async function sendToToken(token, { title, body, data }) {
  try {
    await admin.messaging().send({
      token,
      notification: { title, body },
      data: stringifyData(data),
    });
  } catch (err) {
    console.error('Push notification failed', err);
  }
}

/** Sends to a single user by id, if they have a registered device token. */
async function sendToUser(userId, { title, body, data }) {
  if (!ensureInitialized()) return;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT pushToken FROM Users WHERE id = @id');
    const token = result.recordset[0]?.pushToken;
    if (token) await sendToToken(token, { title, body, data });
  } catch (err) {
    console.error('Push notification (single user) failed', err);
  }
}

/** Sends to every captain/admin with a registered device token. */
async function sendToCaptainsAndAdmins({ title, body, data }) {
  if (!ensureInitialized()) return;
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT pushToken FROM Users
      WHERE banned = 0 AND pushToken IS NOT NULL AND (role = 'captain' OR isAdmin = 1)
    `);
    await Promise.all(
      result.recordset.map((row) => sendToToken(row.pushToken, { title, body, data })),
    );
  } catch (err) {
    console.error('Push notification (captains/admins) failed', err);
  }
}

module.exports = { sendToUser, sendToCaptainsAndAdmins };
