const express = require('express');
const cors = require('cors');
const authRouter = require('./src/routes/auth');
const tasksRouter = require('./src/routes/tasks');
const extensionRequestsRouter = require('./src/routes/extensionRequests');
const usersRouter = require('./src/routes/users');
const cronRouter = require('./src/routes/cron');
const ftcLiveRouter = require('./src/routes/ftcLive');
const meetsRouter = require('./src/routes/meets');
const { authenticate, requireSession, requireApproved } = require('./src/authenticate');
const { requireCurrentApp, showMinimumBuild, setMinimumBuild } = require('./src/appVersion');
const asyncHandler = require('./src/asyncHandler');
const { runMeetTick } = require('./src/meetAlerts');
const { getPool } = require('./src/db');
const { ensureTables } = require('./src/schema');

const app = express();
// Only the browser-based web build needs this — native iOS/Android requests
// aren't subject to CORS at all. Allowlisted rather than wide open so a
// random third-party site can't drive the API from someone's browser
// session.
const ALLOWED_ORIGINS = [
  'https://13115robotics.com',
  'https://www.13115robotics.com',
  /^http:\/\/localhost(:\d+)?$/, // local `flutter run -d chrome` during development
];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin))) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
  }),
);
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Cron has its own shared secret, and the app checks the minimum build
// before anything else - both open, and neither sent by an app build.
app.use('/api/cron', cronRouter);
app.get('/api/app-version', asyncHandler(showMinimumBuild));

// From here on, app builds older than the minimum get 426 (src/appVersion.js).
app.use('/api', requireCurrentApp);

// Open: login hands out the session token.
app.use('/api/auth', authRouter);

// Everything below needs a session token (see src/authenticate.js).
app.use('/api', authenticate);
app.put('/api/app-version', requireSession, asyncHandler(setMinimumBuild));
app.use('/api/tasks', requireApproved, tasksRouter);
app.use('/api/extension-requests', requireApproved, extensionRequestsRouter);
// Gated per route: members still onboarding or awaiting approval need to
// read and update their own record.
app.use('/api/users', usersRouter);
app.use('/api/ftc-live', requireApproved, ftcLiveRouter);
app.use('/api/meets', requireSession, requireApproved, meetsRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Last-resort safety net: log and keep running instead of crashing the
// whole app on an unexpected rejection outside the request/response cycle.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// Meet-mode alerts need minute-level timing, finer than the GitHub Actions
// cron can give, so the server checks every minute itself (the cron ping is
// the backup, and keeps the free-tier app from going to sleep).
// Creates tables a newer version needs (see src/schema.js) before the first
// meet tick uses them. A failure is logged, not fatal: tasks still work, and
// the next restart tries again.
const tablesReady = getPool()
  .then(ensureTables)
  .then((created) => created.length && console.log(`Created tables: ${created.join(', ')}`))
  .catch((err) => console.error('Creating missing tables failed', err));

setInterval(() => {
  tablesReady.then(runMeetTick).catch((err) => console.error('Meet tick failed', err));
}, 60 * 1000);

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Task tracker API listening on ${port}`));
