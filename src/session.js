const crypto = require('crypto');

// Server-issued session tokens. /api/auth/login hands one out after Google
// verifies who you are; every other request has to carry it, and the user
// it names is the only identity the server trusts. Format:
// base64url(JSON payload) + '.' + base64url(HMAC-SHA256 of that part).
const SESSION_DAYS = 30;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET must be set (at least 32 characters)');
  }
  return value;
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

/** Returns a token for userId (their email), valid for SESSION_DAYS. */
function createSessionToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Returns the user id a token was issued to, or null if it's forged, malformed or expired. */
function verifySessionToken(token) {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof sub !== 'string' || typeof exp !== 'number' || exp < Date.now()) return null;
    return sub;
  } catch {
    return null;
  }
}

module.exports = { createSessionToken, verifySessionToken };
