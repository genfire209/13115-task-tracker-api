const express = require('express');
const authRouter = require('./src/routes/auth');
const tasksRouter = require('./src/routes/tasks');
const extensionRequestsRouter = require('./src/routes/extensionRequests');
const usersRouter = require('./src/routes/users');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/extension-requests', extensionRequestsRouter);
app.use('/api/users', usersRouter);

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
