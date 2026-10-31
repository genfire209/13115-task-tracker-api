const express = require('express');
const asyncHandler = require('../asyncHandler');
const { fetchTeamInfo, fetchTeamEventCodes, fetchEventMatches, fetchRankings } = require('../ftcApi');
const { searchTeamsByName } = require('../ftcScoutSearch');
const { currentSeason, withEstimates, hasTeam, breakdownFor } = require('../meetAlerts');
const { rankingPoints } = require('../scoreDetails');

const router = express.Router();

/**
 * The whole-number total of ranking points a team earned across matches it's
 * already played at an event - what FIRST's "Ranking Points" ranking-table
 * column doesn't show, since that's actually the per-match average
 * (rankings[].sortOrder1 / ftcApi.js's rankingScore). Null if none played yet.
 */
async function totalRankingPoints(season, code, matches, teamNumber) {
  const played = matches.filter((m) => m.hasBeenPlayed);
  if (!played.length) return null;
  const totals = await Promise.all(
    played.map(async (m) => {
      const alliance = m.teams.find((t) => t.teamNumber === teamNumber)?.alliance;
      if (!alliance) return 0;
      const breakdown = await breakdownFor(season, code, m);
      return rankingPoints(m, alliance, breakdown).total;
    }),
  );
  return totals.reduce((sum, t) => sum + t, 0);
}

// GET /api/teams/search?q=brave
// Name search for the lookup screen's search box. A plain team number goes
// straight through without touching FTCScout; everything else is a name,
// which only FTCScout's API can search (see ftcScoutSearch.js).
router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  if (/^\d+$/.test(q)) {
    return res.json({ results: [{ number: parseInt(q, 10), name: null }] });
  }
  const results = await searchTeamsByName(q, 20);
  res.json({ results });
}));

// GET /api/teams/:number?season=2026
// One team: public info, plus every event it attended this season with
// that event's ranking row and the matches it played - the same match
// shape /api/meets/:season/:code returns, so the existing match list and
// match-detail screens work unchanged.
router.get('/:number', asyncHandler(async (req, res) => {
  const teamNumber = parseInt(req.params.number, 10);
  if (!teamNumber) return res.status(400).json({ error: 'Team number must be a number' });
  const season = parseInt(req.query.season, 10) || currentSeason();

  const info = await fetchTeamInfo(season, teamNumber);
  if (!info) return res.status(404).json({ error: 'Team not found' });

  const codes = await fetchTeamEventCodes(season, teamNumber);
  const events = await Promise.all(
    codes.map(async (code) => {
      const [event, rankings] = await Promise.all([fetchEventMatches(season, code), fetchRankings(season, code)]);
      if (!event) return null;
      const matches = withEstimates(event.matches).filter((m) => hasTeam(m, teamNumber));
      return {
        code: event.code,
        name: event.name,
        timezone: event.timezone,
        dateStart: event.dateStart,
        dateEnd: event.dateEnd,
        venue: event.venue,
        city: event.city,
        ranking: rankings.find((r) => r.teamNumber === teamNumber) || null,
        totalRankingPoints: await totalRankingPoints(season, code, matches, teamNumber),
        matches,
      };
    }),
  );

  res.json({
    season,
    teamNumber,
    info,
    events: events.filter(Boolean).sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart))),
  });
}));

module.exports = router;
