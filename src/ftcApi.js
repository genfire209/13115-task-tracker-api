// Client for FIRST's official FTC Events API (ftc-api.firstinspires.org).
// Requires FTC_API_USERNAME / FTC_API_TOKEN env vars (Basic Auth) - request
// a key at https://ftc-events.firstinspires.org/services/API.
//
// Docs note the important bit that shapes this file: "All times are listed
// in the local time to the event venue" with no offset in the string at
// all - so these must never be run through `new Date(...)` (Node would
// silently interpret them as the SERVER's own timezone, not the venue's).
// Every time value here stays a raw venue-local string; meetAlerts.js does
// its arithmetic on the wall-clock fields, never as an instant.
const { normalizeMatchScores } = require('./scoreDetails');

const BASE = 'https://ftc-api.firstinspires.org/v2.0';

function authHeader() {
  const { FTC_API_USERNAME, FTC_API_TOKEN } = process.env;
  if (!FTC_API_USERNAME || !FTC_API_TOKEN) {
    throw new Error('FTC_API_USERNAME/FTC_API_TOKEN not configured');
  }
  return 'Basic ' + Buffer.from(`${FTC_API_USERNAME}:${FTC_API_TOKEN}`).toString('base64');
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader() } });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`FTC API ${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Small in-memory cache so a room full of phones refreshing a meet doesn't
// turn into a request each to FIRST. Concurrent callers share one fetch; a
// failed fetch isn't cached.
const cache = new Map();

function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = load();
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  promise.catch(() => cache.delete(key));
  return promise;
}

const MINUTE = 60 * 1000;

// "Red1"/"Blue2" -> "Red"/"Blue"
function allianceFromStation(station) {
  return station.replace(/\d+$/, '');
}

function matchKey(tournamentLevel, series, matchNumber) {
  return `${tournamentLevel}-${series}-${matchNumber}`;
}

async function fetchLevel(season, eventCode, level) {
  const [schedule, results] = await Promise.all([
    get(`/${season}/schedule/${eventCode}?tournamentLevel=${level}`).catch(() => null),
    get(`/${season}/matches/${eventCode}?tournamentLevel=${level}`).catch(() => null),
  ]);

  const resultsByKey = new Map();
  for (const m of results?.matches || []) {
    resultsByKey.set(matchKey(m.tournamentLevel, m.series, m.matchNumber), m);
  }

  return (schedule?.schedule || []).map((s) => {
    const key = matchKey(s.tournamentLevel, s.series, s.matchNumber);
    const result = resultsByKey.get(key);
    return {
      matchKey: key,
      series: s.series,
      matchNum: s.matchNumber,
      tournamentLevel: s.tournamentLevel,
      description: s.description,
      hasBeenPlayed: !!result,
      scheduledStartTime: s.startTime, // raw "yyyy-MM-ddTHH:mm:ss", venue-local
      actualStartTime: result?.actualStartTime ?? null,
      postResultTime: result?.postResultTime ?? null,
      teams: s.teams.map((t) => ({
        alliance: allianceFromStation(t.station),
        station: parseInt(String(t.station).replace(/\D/g, ''), 10) || null, // Red1 -> 1: "Robot 1"
        teamNumber: t.teamNumber,
        teamName: t.teamName ?? null,
      })),
      redScore: result?.scoreRedFinal ?? null,
      blueScore: result?.scoreBlueFinal ?? null,
    };
  });
}

/**
 * Returns { code, name, timezone, dateStart, dateEnd, venue, city, matches: [...] }
 * for an event, or null if not found. Matches are in schedule order:
 * qualifications, then playoffs.
 */
function fetchEventMatches(season, eventCode) {
  return cached(`matches:${season}:${eventCode}`, 20 * 1000, async () => {
    const eventList = await get(`/${season}/events?eventCode=${eventCode}`);
    const eventInfo = eventList?.events?.[0];
    if (!eventInfo) return null;

    // Playoffs don't exist as a schedule until quals finish and alliances are
    // picked - a fetch failure there just means "no playoff matches yet",
    // not a real error.
    const [qual, playoff] = await Promise.all([
      fetchLevel(season, eventCode, 'qual').catch(() => []),
      fetchLevel(season, eventCode, 'playoff').catch(() => []),
    ]);

    return {
      code: eventInfo.code,
      name: eventInfo.name,
      timezone: eventInfo.timezone,
      dateStart: eventInfo.dateStart,
      dateEnd: eventInfo.dateEnd,
      venue: eventInfo.venue,
      city: eventInfo.city,
      matches: [...qual, ...playoff],
    };
  });
}

/**
 * Full score breakdowns for one round ('qual' or 'playoff') of an event,
 * keyed "series-matchNumber" (see scoreDetails.js).
 */
function fetchScoreDetails(season, eventCode, level) {
  return cached(`scores:${season}:${eventCode}:${level}`, 30 * 1000, async () =>
    normalizeMatchScores(await get(`/${season}/scores/${eventCode}/${level}`)),
  );
}

/** Qualification rankings for an event, best first ([] before any are posted). */
function fetchRankings(season, eventCode) {
  return cached(`rankings:${season}:${eventCode}`, 30 * 1000, async () => {
    const data = await get(`/${season}/rankings/${eventCode}`).catch(() => null);
    return (data?.rankings || []).map((r) => ({
      rank: r.rank,
      teamNumber: r.teamNumber,
      teamName: r.teamName ?? null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      matchesPlayed: r.matchesPlayed,
      rankingScore: r.sortOrder1,
    }));
  });
}

/** Every event in a region for a season (e.g. 'USNJ'), soonest first. */
function fetchRegionEvents(season, regionCode) {
  return cached(`events:${season}:${regionCode}`, 60 * MINUTE, async () => {
    const data = await get(`/${season}/events`);
    return (data?.events || [])
      .filter((e) => e.regionCode === regionCode || (!e.regionCode && `US${e.stateprov}` === regionCode))
      .map((e) => ({
        code: e.code,
        name: e.name,
        typeName: e.typeName,
        dateStart: e.dateStart,
        dateEnd: e.dateEnd,
        venue: e.venue,
        city: e.city,
        timezone: e.timezone,
      }))
      .sort((a, b) => String(a.dateStart).localeCompare(String(b.dateStart)));
  });
}

/** Codes of the events a team is registered for this season. */
function fetchTeamEventCodes(season, teamNumber) {
  return cached(`team-events:${season}:${teamNumber}`, 60 * MINUTE, async () => {
    const data = await get(`/${season}/events?teamNumber=${teamNumber}`);
    return (data?.events || []).map((e) => e.code);
  });
}

module.exports = { fetchEventMatches, fetchScoreDetails, fetchRankings, fetchRegionEvents, fetchTeamEventCodes };
