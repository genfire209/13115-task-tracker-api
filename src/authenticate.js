const { sql, getPool } = require('./db');
const { verifySessionToken, publicUserId } = require('./session');

// Identity comes only from the session token (see session.js) - never from
// actorId / requesterId / createdBy in the request, which anyone can type.
//
// ALLOW_LEGACY_CLIENTS=true is a temporary bridge for app builds released
// before session tokens existed: a request with no token at all is still
// served the old way (trusting the ids it sends), so those installs keep
// working until everyone has updated. It reopens the old hole while it's
// on - turn it off as soon as the new build is out.
function legacyClientsAllowed() {
  return process.env.ALLOW_LEGACY_CLIENTS === 'true';
}

function hasCaptainAccess(user) {
  return !!user && (user.role === 'captain' || !!user.isAdmin);
}

/** Express middleware: sets req.user from the Bearer token, or rejects the request. */
async function authenticate(req, res, next) {
  try {
    const match = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
    if (!match) {
      if (legacyClientsAllowed()) {
        req.legacy = true;
        return next();
      }
      return res.status(401).json({ error: 'Not signed in' });
    }

    const userId = verifySessionToken(match[1]);
    if (!userId) {
      return res.status(401).json({ error: 'Session expired - sign in again' });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT id, role, isAdmin, approved, isJunior, banned FROM Users WHERE id = @id');
    const row = result.recordset[0];
    if (!row || row.banned) {
      return res.status(403).json({ error: 'This account has been removed from the team' });
    }
    req.user = {
      id: row.id,
      role: row.role,
      isAdmin: !!row.isAdmin,
      approved: !!row.approved,
      isJunior: !!row.isJunior,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Middleware: a real signed-in user. For routes no legacy app build ever called. */
function requireSession(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Not signed in' });
}

/** Middleware: only members a captain/admin has let in. */
function requireApproved(req, res, next) {
  if (req.legacy || req.user.approved) return next();
  res.status(403).json({ error: 'Waiting for a captain to approve your account' });
}

/** Middleware: captains and admins only. */
function requireCaptainAccess(req, res, next) {
  if (req.legacy || hasCaptainAccess(req.user)) return next();
  res.status(403).json({ error: 'Only a captain or admin can do this' });
}

/** The user making the request. Legacy clients are taken at their word (claimedId). */
function actorIdFor(req, claimedId) {
  return req.legacy ? claimedId : req.user.id;
}

/** Permission check that legacy clients skip, so they keep their old behavior. */
function permitted(req, condition) {
  return !!req.legacy || condition;
}

/**
 * How user ids should appear to whoever made this request. Members only see
 * names - a user's id is their email, so everyone else's is swapped for
 * publicUserId. Their own id, captains/admins and legacy clients (whose old
 * app needs the real ids) see ids unchanged.
 */
function userIdsFor(req) {
  if (req.legacy || hasCaptainAccess(req.user)) return (id) => id;
  return (id) => (id == null || id === req.user.id ? id : publicUserId(id));
}

module.exports = {
  authenticate,
  requireSession,
  requireApproved,
  requireCaptainAccess,
  actorIdFor,
  permitted,
  hasCaptainAccess,
  userIdsFor,
};
