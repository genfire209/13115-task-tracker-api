const express = require('express');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { sendToUser } = require('../push');

const router = express.Router();

// POST /api/cron/due-date-reminders
// Header: X-Cron-Secret must match CRON_SECRET. Meant to be hit on a
// schedule (see .github/workflows/due-date-reminders.yml), not by the app.
router.post('/due-date-reminders', asyncHandler(async (req, res) => {
  const secret = req.get('X-Cron-Secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, title, dueDate, assignedTo FROM Tasks
    WHERE assignedTo IS NOT NULL
      AND status IN ('pending_acceptance', 'accepted', 'in_progress')
      AND reminderSentAt IS NULL
      AND dueDate <= DATEADD(hour, 24, SYSUTCDATETIME())
  `);

  const now = new Date();
  for (const task of result.recordset) {
    const overdue = new Date(task.dueDate) < now;
    sendToUser(task.assignedTo, {
      title: overdue ? 'Task overdue' : 'Task due soon',
      body: task.title,
      data: { taskId: task.id, type: overdue ? 'task_overdue' : 'task_due_soon' },
    });
    await pool
      .request()
      .input('id', sql.NVarChar, task.id)
      .query('UPDATE Tasks SET reminderSentAt = SYSUTCDATETIME() WHERE id = @id');
  }

  res.json({ remindersSent: result.recordset.length });
}));

module.exports = router;
