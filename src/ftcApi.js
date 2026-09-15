// Client for FIRST's official FTC Events API (ftc-api.firstinspires.org).
// Requires FTC_API_USERNAME / FTC_API_TOKEN env vars (Basic Auth) - request
// a key at https://ftc-events.firstinspires.org/services/API.
//
// Docs note the important bit that shapes this file: "All times are listed
// in the local time to the event venue" with no offset in the string at
// all - so these must never be run through `new Date(...)` (Node would
// silently interpret them as the SERVER's own timezone, not the venue's).
// Every time value here stays a raw string; only the HH:mm portion is ever
// extracted, never reinterpreted as an instant.
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
      matchNum: s.matchNumber,
      tournamentLevel: s.tournamentLevel,
      description: s.description,
      hasBeenPlayed: !!result,
      scheduledStartTime: s.startTime, // raw "yyyy-MM-ddTHH:mm:ss", venue-local
      postResultTime: result?.postResultTime ?? null,
      teams: s.teams.map((t) => ({
        alliance: allianceFromStation(t.station),
        teamNumber: t.teamNumber,
      })),
      redScore: result?.scoreRedFinal ?? null,
      blueScore: result?.scoreBlueFinal ?? null,
    };
  });
}

/** Returns { name, timezone, matches: [...] } for an event, or null if not found. */
async function fetchEventMatches(season, eventCode) {
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
    name: eventInfo.name,
    timezone: eventInfo.timezone,
    matches: [...qual, ...playoff],
  };
}

module.exports = { fetchEventMatches };
