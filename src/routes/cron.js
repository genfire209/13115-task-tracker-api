const express = require('express');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { sendToUser, sendToAllUsers } = require('../push');
const { fetchEventMatches } = require('../ftcScout');

const router = express.Router();

function requireCronSecret(req, res) {
  const secret = req.get('X-Cron-Secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function formatMatchNotification(m) {
  const teamsFor = (alliance) =>
    m.teams.filter((t) => t.alliance === alliance).map((t) => t.teamNumber).join(', ');
  const red = teamsFor('Red');
  const blue = teamsFor('Blue');
  if (m.redScore == null || m.blueScore == null) {
    return { title: `${m.description} final`, body: `Red (${red}) vs Blue (${blue})` };
  }
  if (m.redScore === m.blueScore) {
    return {
      title: `${m.description}: Tie`,
      body: `Red (${red}) ${m.redScore} - ${m.blueScore} Blue (${blue})`,
    };
  }
  const winner = m.redScore > m.blueScore ? 'Red' : 'Blue';
  const winTeams = winner === 'Red' ? red : blue;
  const loseTeams = winner === 'Red' ? blue : red;
  const winScore = Math.max(m.redScore, m.blueScore);
  const loseScore = Math.min(m.redScore, m.blueScore);
  return {
    title: `${m.description}: ${winner} wins`,
    body: `${winner} (${winTeams}) beat the other alliance (${loseTeams}) ${winScore}-${loseScore}`,
  };
}

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

// POST /api/cron/ftc-match-results
// Header: X-Cron-Secret must match CRON_SECRET. Polls every watched FTC
// event; for each match that's finished and hasn't been notified yet,
// broadcasts a push and records it so it's never sent twice.
router.post('/ftc-match-results', asyncHandler(async (req, res) => {
  if (!requireCronSecret(req, res)) return;

  const pool = await getPool();
  const watched = (await pool.request().query('SELECT season, eventCode FROM WatchedFtcEvents')).recordset;

  let notified = 0;
  for (const { season, eventCode } of watched) {
    let event;
    try {
      event = await fetchEventMatches(season, eventCode);
    } catch (err) {
      console.error(`FTC live: failed to fetch ${season} ${eventCode}`, err);
      continue;
    }
    if (!event) continue;

    for (const m of event.matches) {
      if (!m.hasBeenPlayed) continue;
      const already = await pool
        .request()
        .input('season', sql.Int, season)
        .input('eventCode', sql.NVarChar, eventCode)
        .input('matchId', sql.Int, m.id)
        .query(
          'SELECT 1 AS found FROM NotifiedFtcMatches WHERE season = @season AND eventCode = @eventCode AND matchId = @matchId',
        );
      if (already.recordset.length > 0) continue;

      const { title, body } = formatMatchNotification(m);
      await sendToAllUsers({ title, body, data: { type: 'ftc_match_result' } });
      await pool
        .request()
        .input('season', sql.Int, season)
        .input('eventCode', sql.NVarChar, eventCode)
        .input('matchId', sql.Int, m.id)
        .query(
          'INSERT INTO NotifiedFtcMatches (season, eventCode, matchId) VALUES (@season, @eventCode, @matchId)',
        );
      notified++;
    }
  }

  res.json({ eventsChecked: watched.length, matchesNotified: notified });
}));

module.exports = router;
