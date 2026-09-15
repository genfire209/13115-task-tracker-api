const express = require('express');
const crypto = require('crypto');
const { sql, getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { fetchEventMatches } = require('../ftcApi');

const router = express.Router();

function newId() {
  return `ftcevt-${crypto.randomUUID()}`;
}

// GET /api/ftc-live/event?season=2026&code=USNYLI1
// Live status for one event: proxies FTCScout, no auth needed - it's just
// public sports data.
router.get('/event', asyncHandler(async (req, res) => {
  const season = parseInt(req.query.season, 10);
  const code = req.query.code;
  if (!season || !code) {
    return res.status(400).json({ error: 'season and code are required' });
  }
  const event = await fetchEventMatches(season, String(code).toUpperCase());
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}));

// GET /api/ftc-live/watched
router.get('/watched', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(
    'SELECT id, season, eventCode, addedBy, createdAt FROM WatchedFtcEvents ORDER BY createdAt DESC',
  );
  res.json(result.recordset);
}));

// POST /api/ftc-live/watched
// Body: { season, eventCode, requesterId }
router.post('/watched', asyncHandler(async (req, res) => {
  const { season, eventCode, requesterId } = req.body;
  if (!season || !eventCode || !requesterId) {
    return res.status(400).json({ error: 'season, eventCode, and requesterId are required' });
  }
  const id = newId();
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.NVarChar, id)
    .input('season', sql.Int, season)
    .input('eventCode', sql.NVarChar, String(eventCode).toUpperCase())
    .input('addedBy', sql.NVarChar, requesterId)
    .query(
      `INSERT INTO WatchedFtcEvents (id, season, eventCode, addedBy)
       VALUES (@id, @season, @eventCode, @addedBy)`,
    );
  res.status(201).json({ id, season, eventCode: String(eventCode).toUpperCase(), addedBy: requesterId });
}));

// DELETE /api/ftc-live/watched/:id
router.delete('/watched/:id', asyncHandler(async (req, res) => {
  const pool = await getPool();
  await pool.request().input('id', sql.NVarChar, req.params.id).query(
    'DELETE FROM WatchedFtcEvents WHERE id = @id',
  );
  res.json({ ok: true });
}));

module.exports = router;
