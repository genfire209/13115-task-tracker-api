const express = require('express');
const cors = require('cors');
const authRouter = require('./src/routes/auth');
const tasksRouter = require('./src/routes/tasks');
const extensionRequestsRouter = require('./src/routes/extensionRequests');
const usersRouter = require('./src/routes/users');
const cronRouter = require('./src/routes/cron');

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

app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/extension-requests', extensionRequestsRouter);
app.use('/api/users', usersRouter);
app.use('/api/cron', cronRouter);

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

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Task tracker API listening on ${port}`));
