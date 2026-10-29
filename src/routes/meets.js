const express = require('express');
const { getPool } = require('../db');
const asyncHandler = require('../asyncHandler');
const { requireCaptainAccess } = require('../authenticate');
const { fetchEventMatches, fetchRankings, fetchRegionEvents, fetchTeamEventCodes } = require('../ftcApi');
const { rankingPoints } = require('../scoreDetails');
const {
  OUR_TEAM,
  currentSeason,
  withEstimates,
  hasTeam,
  getActiveMeet,
  startMeet,
  breakdownFor,
} = require('../meetAlerts');

const router = express.Router();

// Which meets the app lists: every event in this FIRST region.
const REGION = process.env.MEET_REGION || 'USNJ';

/** The active meet as this user should see it - a test run is only visible to whoever started it. */
async function visibleActiveMeet(pool, user) {
  const meet = await getActiveMeet(pool);
  if (!meet || (meet.testOnly && meet.startedBy !== user.id)) return null;
  return meet;
}

function nextMatchFor(matches, teamNumber) {
  const next = withEstimates(matches).find((m) => !m.hasBeenPlayed && hasTeam(m, teamNumber));
  return next || null;
}

// GET /api/meets?season=2026
// Every meet in the region this season, flagged with the ones we're
// registered for and the one in meet mode.
router.get('/', asyncHandler(async (req, res) => {
  const season = parseInt(req.query.season, 10) || currentSeason();
  const pool = await getPool();
  const [events, ourCodes, active] = await Promise.all([
    fetchRegionEvents(season, REGION),
    fetchTeamEventCodes(season, OUR_TEAM).catch(() => []),
    visibleActiveMeet(pool, req.user),
  ]);
  res.json({
    season,
    ourTeam: OUR_TEAM,
    events: events.map((e) => ({
      ...e,
      weAttend: ourCodes.includes(e.code),
      isActive: !!active && active.season === season && active.eventCode === e.code,
    })),
    active: active && { ...active, eventName: events.find((e) => e.code === active.eventCode)?.name ?? null },
  });
}));

// GET /api/meets/active
// The meet in meet mode (or null) and our next match there, for the
// banner on the task board.
router.get('/active', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const active = await visibleActiveMeet(pool, req.user);
  if (!active) return res.json({ active: null });
  const event = await fetchEventMatches(active.season, active.eventCode);
  res.json({
    active: {
      ...active,
      eventName: event?.name ?? active.eventCode,
      waitingForFirstMatch: !event?.matches.some((m) => m.hasBeenPlayed),
      nextMatch: event ? nextMatchFor(event.matches, active.teamNumber) : null,
    },
  });
}));

// GET /api/meets/:season/:code
// One meet: every match (with estimated start times once play has begun),
// team names, scores, and rankings.
router.get('/:season/:code', asyncHandler(async (req, res) => {
  const season = parseInt(req.params.season, 10);
  const code = String(req.params.code).toUpperCase();
  if (!season) return res.status(400).json({ error: 'season must be a year, e.g. 2026' });

  const pool = await getPool();
  const [event, rankings, active] = await Promise.all([
    fetchEventMatches(season, code),
    fetchRankings(season, code),
    visibleActiveMeet(pool, req.user),
  ]);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const isActive = !!active && active.season === season && active.eventCode === code;
  res.json({
    ...event,
    season,
    ourTeam: isActive ? active.teamNumber : OUR_TEAM,
    isActive,
    activeMeet: isActive ? active : null,
    waitingForFirstMatch: !event.matches.some((m) => m.hasBeenPlayed),
    matches: withEstimates(event.matches),
    rankings,
  });
}));

// GET /api/meets/:season/:code/matches/:matchKey
// One match in full, like its page on ftc-events.firstinspires.org: the
// auto / teleop / penalty split, what each robot did, HIVE, GARDEN and
// FLOWER contents, and the ranking points each alliance earned.
router.get('/:season/:code/matches/:matchKey', asyncHandler(async (req, res) => {
  const season = parseInt(req.params.season, 10);
  const code = String(req.params.code).toUpperCase();
  const pool = await getPool();
  const [event, active] = await Promise.all([fetchEventMatches(season, code), visibleActiveMeet(pool, req.user)]);
  const match = event && withEstimates(event.matches).find((m) => m.matchKey === req.params.matchKey);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const breakdown = await breakdownFor(season, code, match);
  const isActive = !!active && active.season === season && active.eventCode === code;
  res.json({
    season,
    eventCode: code,
    eventName: event.name,
    ourTeam: isActive ? active.teamNumber : OUR_TEAM,
    match,
    breakdown,
    rankingPoints: match.hasBeenPlayed
      ? { red: rankingPoints(match, 'Red', breakdown), blue: rankingPoints(match, 'Blue', breakdown) }
      : null,
  });
}));

// POST /api/meets/active
// Body: { season, eventCode, testOnly?, teamNumber? }. Captains/admins start
// meet mode for the meet we're at; the team then gets our match alerts.
// testOnly (alerts only to you) and a different teamNumber are admin-only,
// for rehearsing at a meet we're not in.
router.post('/active', requireCaptainAccess, asyncHandler(async (req, res) => {
  const season = parseInt(req.body.season, 10);
  const eventCode = String(req.body.eventCode || '').toUpperCase();
  const testOnly = req.body.testOnly === true;
  const teamNumber = req.body.teamNumber ? parseInt(req.body.teamNumber, 10) : OUR_TEAM;
  if (!season || !eventCode || !teamNumber) {
    return res.status(400).json({ error: 'season and eventCode are required' });
  }
  if ((testOnly || teamNumber !== OUR_TEAM) && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Only an admin can run a test or follow another team' });
  }

  const pool = await getPool();
  const meet = await startMeet(pool, { season, eventCode, teamNumber, testOnly, startedBy: req.user.id });
  if (!meet) return res.status(404).json({ error: 'Event not found' });
  res.status(201).json({ active: meet });
}));

// DELETE /api/meets/active
// Turns meet mode off.
router.delete('/active', requireCaptainAccess, asyncHandler(async (req, res) => {
  const pool = await getPool();
  await pool.request().query('UPDATE ActiveMeets SET endedAt = SYSUTCDATETIME() WHERE endedAt IS NULL');
  res.json({ ok: true });
}));

module.exports = router;
