const { sql, getPool } = require('./db');

// Forced updates. The app sends its build number (the +N in pubspec.yaml)
// as X-App-Build on every request. Once a new build is out, an admin raises
// the oldest build still allowed - from a phone already running it - and
// every request from an older build gets 426 Upgrade Required, so it can't
// be used until it's updated. Builds from before this existed send no build
// number, so they count as build 0.
const SETTING = 'minimumAppBuild';
const CACHE_MS = 30 * 1000;
let cached = null; // { value, at } - the API runs as a single instance

const UPDATE_MESSAGE = 'This version of the app is out of date. Open TestFlight and update it to keep using the app.';

async function minimumBuild() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const result = await (await getPool())
    .request()
    .input('name', sql.NVarChar, SETTING)
    .query('SELECT value FROM AppSettings WHERE name = @name');
  const value = parseInt(result.recordset[0]?.value, 10) || 0;
  cached = { value, at: Date.now() };
  return value;
}

function buildOf(req) {
  return parseInt(req.get('X-App-Build'), 10) || 0;
}

// Builds 8 and older have no update screen and don't show the server's
// error, but they do list whatever GET /api/tasks returns - so they get one
// task card telling them to update.
function updateTaskCard() {
  return {
    id: 'update-required',
    title: 'Update required: open TestFlight and install the new version',
    description: UPDATE_MESSAGE,
    category: 'programming',
    createdBy: 'update-required',
    assignedTo: null,
    status: 'open',
    dueDate: new Date().toISOString(),
  };
}

/** Express middleware: turns away app builds older than the minimum. */
async function requireCurrentApp(req, res, next) {
  let minimum;
  try {
    minimum = await minimumBuild();
  } catch (err) {
    // Can't read the setting: let everyone in rather than lock everyone out.
    console.error('Reading the minimum app build failed', err);
    return next();
  }
  if (buildOf(req) >= minimum) return next();
  res.status(426);
  if (req.method === 'GET' && req.path === '/tasks') return res.json([updateTaskCard()]);
  res.json({ error: UPDATE_MESSAGE, updateRequired: true, minimumBuild: minimum });
}

// GET /api/app-version
// Open (no sign-in), so the app can check before anything else.
async function showMinimumBuild(req, res) {
  res.json({ minimumBuild: await minimumBuild() });
}

// PUT /api/app-version
// Body: { minimumBuild }. Admins only, and never above the build the admin
// is running, so nobody can require a build that isn't out yet. Lowering it
// lets older builds back in.
async function setMinimumBuild(req, res) {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Only an admin can require an app update' });
  }
  const value = req.body.minimumBuild;
  if (!Number.isInteger(value) || value < 0) {
    return res.status(400).json({ error: 'minimumBuild must be a whole number, 0 or more' });
  }
  if (value > buildOf(req)) {
    return res.status(400).json({ error: `This phone is on build ${buildOf(req)} - update it before requiring build ${value}` });
  }

  const pool = await getPool();
  const save = (query) =>
    pool
      .request()
      .input('name', sql.NVarChar, SETTING)
      .input('value', sql.NVarChar, String(value))
      .input('updatedBy', sql.NVarChar, req.user.id)
      .query(query);
  const updated = await save(
    'UPDATE AppSettings SET value = @value, updatedBy = @updatedBy, updatedAt = SYSUTCDATETIME() WHERE name = @name',
  );
  if (updated.rowsAffected[0] === 0) {
    await save('INSERT INTO AppSettings (name, value, updatedBy) VALUES (@name, @value, @updatedBy)');
  }
  cached = { value, at: Date.now() };
  res.json({ minimumBuild: value });
}

module.exports = { requireCurrentApp, showMinimumBuild, setMinimumBuild };
