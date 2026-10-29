// Meet mode: while a captain/admin has a meet marked active, push the team a
// heads-up ~10 and ~5 minutes before each of OUR matches and the result
// after it. Run by runMeetTick() every minute (server.js) and by the
// GitHub Actions cron as a backup.
//
// FTC published schedule times are often placeholders (at USNJSOM1 on
// 2026-10-24 Q1 was "8:00" and actually ran around 12:40), so start times
// are estimated from how far the event has really got: the last match that
// started plus the recent cycle time. Until the first match has been
// played there is no estimate, and no timed alerts.
const crypto = require('crypto');
const { sql, getPool } = require('./db');
const { fetchEventMatches, fetchScoreDetails } = require('./ftcApi');
const { rankingPoints } = require('./scoreDetails');
const { sendToTeam, sendToUser } = require('./push');

const OUR_TEAM = Number(process.env.OUR_TEAM_NUMBER) || 13115;
const FALLBACK_CYCLE_MIN = 7;
const RESULT_POST_DELAY_MIN = 4; // a result usually posts this long after its match starts
const RECENT_CYCLES = 5;
// The scheduled spacing counts as this many observed cycles, so one slow
// early gap doesn't throw off the estimate.
const SCHEDULE_PRIOR_WEIGHT = 3;
// Alerts go out this much earlier than the estimate says, since the
// estimate trails reality: a match's result posts a few minutes after it
// starts. Tuned on the USNJSOM1 replay in test/meetAlerts.test.js.
const EARLY_MARGIN_MIN = 2;
const DUPLICATE_KEY = [2627, 2601];

/** FTC seasons are named for the year they start (Sept). */
function currentSeason(now = new Date()) {
  return now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

// Venue-local times are naive wall-clock strings; for arithmetic they're
// turned into "minutes" by reading the fields as if they were UTC. Only
// ever compared with other values made the same way.
function wallMinutes(raw) {
  const m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)(?::(\d+))?/.exec(raw || '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 60000;
}

function wallString(minutes) {
  return new Date(Math.round(minutes) * 60000).toISOString().slice(0, 19);
}

/** The current wall-clock time at the venue, in wallMinutes form. */
function venueNowMinutes(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/New_York',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 60000;
}

/** Typical scheduled gap between matches of one round (median), in minutes. */
function scheduledCycle(matches, level) {
  const times = matches
    .filter((m) => m.tournamentLevel === level)
    .map((m) => wallMinutes(m.scheduledStartTime))
    .filter((t) => t !== null);
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((g) => g > 0 && g < 30)
    .sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : FALLBACK_CYCLE_MIN;
}

function startedAt(match) {
  const actual = wallMinutes(match.actualStartTime);
  if (actual !== null) return actual;
  const posted = wallMinutes(match.postResultTime);
  return posted === null ? null : posted - RESULT_POST_DELAY_MIN;
}

/**
 * Returns the matches with `estimatedStartTime` (venue-local string, or
 * null) on every unplayed one. Estimates only run forward within the same
 * round (quals or playoffs) as the last match that started.
 */
function withEstimates(matches) {
  let lastIdx = -1;
  matches.forEach((m, i) => {
    if (m.hasBeenPlayed && startedAt(m) !== null) lastIdx = i;
  });
  if (lastIdx === -1) return matches.map((m) => ({ ...m, estimatedStartTime: null }));

  const last = matches[lastIdx];
  const recentStarts = matches
    .slice(0, lastIdx + 1)
    .filter((m) => m.tournamentLevel === last.tournamentLevel && m.hasBeenPlayed)
    .map(startedAt)
    .filter((t) => t !== null)
    .slice(-(RECENT_CYCLES + 1));
  const gaps = recentStarts.slice(1).map((t, i) => t - recentStarts[i]).filter((g) => g > 0 && g < 30);
  const cycle =
    (gaps.reduce((a, b) => a + b, 0) + SCHEDULE_PRIOR_WEIGHT * scheduledCycle(matches, last.tournamentLevel)) /
    (gaps.length + SCHEDULE_PRIOR_WEIGHT);

  const lastStart = startedAt(last);
  return matches.map((m, i) => {
    if (m.hasBeenPlayed || m.tournamentLevel !== last.tournamentLevel) {
      return { ...m, estimatedStartTime: null };
    }
    const ahead = Math.max(1, i - lastIdx);
    return { ...m, estimatedStartTime: wallString(lastStart + ahead * cycle) };
  });
}

/** The breakdown for one played match, or null if FIRST hasn't posted it. */
async function breakdownFor(season, code, match) {
  if (!match.hasBeenPlayed) return null;
  const level = match.tournamentLevel === 'QUALIFICATION' ? 'qual' : 'playoff';
  const [series, number] = match.matchKey.split('-').slice(-2);
  const scores = await fetchScoreDetails(season, code, level).catch(() => null);
  const breakdown = scores?.[`${series}-${number}`];
  if (!breakdown) return null;

  // FIRST says "Robot 1" / "Robot 2": the alliance's station 1 and 2 teams.
  for (const [alliance, side] of [['Red', breakdown.red], ['Blue', breakdown.blue]]) {
    const teams = match.teams
      .filter((t) => t.alliance === alliance)
      .sort((a, b) => (a.station ?? 0) - (b.station ?? 0));
    side.auto.robots.forEach((r, i) => (r.teamNumber = teams[i]?.teamNumber ?? null));
    side.teleop.robots.forEach((r, i) => (r.teamNumber = teams[i]?.teamNumber ?? null));
  }
  return breakdown;
}

function hasTeam(match, teamNumber) {
  return match.teams.some((t) => t.teamNumber === teamNumber);
}

function shortLabel(match) {
  return match.tournamentLevel === 'QUALIFICATION' ? `Q${match.matchNum}` : match.description;
}

function ourSide(match, teamNumber) {
  const alliance = match.teams.find((t) => t.teamNumber === teamNumber).alliance;
  const partner = match.teams.find((t) => t.alliance === alliance && t.teamNumber !== teamNumber);
  const opponents = match.teams.filter((t) => t.alliance !== alliance).map((t) => t.teamNumber);
  return { alliance, partner, opponents };
}

function lineup(match, teamNumber) {
  const { alliance, partner, opponents } = ourSide(match, teamNumber);
  const withPartner = partner
    ? ` with ${partner.teamNumber}${partner.teamName ? ` ${partner.teamName}` : ''}`
    : '';
  return `${alliance}${withPartner} vs ${opponents.join(', ')}`;
}

function warningMessage(match, teamNumber, minutes) {
  return {
    title: `${shortLabel(match)} in ~${minutes} min`,
    body: minutes <= 5 ? `Head to the field - ${lineup(match, teamNumber)}` : lineup(match, teamNumber),
  };
}

/** "+4 RP (win, SWARM)", or '' when FIRST hasn't posted the breakdown yet. */
function rankingPointsText(match, alliance, breakdown) {
  const rp = rankingPoints(match, alliance, breakdown);
  if (!rp.bonusKnown) return '';
  const parts = [
    rp.win === 3 && 'win',
    rp.win === 1 && 'tie',
    rp.swarm && 'SWARM',
    rp.pollinator1 && 'POLLINATOR 1',
    rp.pollinator2 && 'POLLINATOR 2',
  ].filter(Boolean);
  return `+${rp.total} RP${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function resultMessage(match, teamNumber, breakdown = null) {
  const { alliance } = ourSide(match, teamNumber);
  const ours = alliance === 'Red' ? match.redScore : match.blueScore;
  const theirs = alliance === 'Red' ? match.blueScore : match.redScore;
  const outcome = ours > theirs ? 'We won' : ours < theirs ? 'We lost' : 'Tie';
  const teams = (side) => match.teams.filter((t) => t.alliance === side).map((t) => t.teamNumber).join(', ');
  const rp = rankingPointsText(match, alliance, breakdown);
  return {
    title: `${shortLabel(match)}: ${outcome} ${ours}-${theirs}`,
    body: `Red: ${teams('Red')} | Blue: ${teams('Blue')}${rp ? ` · ${rp}` : ''}`,
  };
}

function scheduleMessage(eventName, ours) {
  return {
    title: `Our matches at ${eventName}`,
    body: ours.map(shortLabel).join(', '),
  };
}

/** Records that an alert was sent; false if it already had been. */
async function claim(pool, meet, matchKey, kind) {
  try {
    await pool
      .request()
      .input('season', sql.Int, meet.season)
      .input('eventCode', sql.NVarChar, meet.eventCode)
      .input('matchKey', sql.NVarChar, matchKey)
      .input('kind', sql.NVarChar, kind)
      .query(
        'INSERT INTO MeetAlertsSent (season, eventCode, matchKey, kind) VALUES (@season, @eventCode, @matchKey, @kind)',
      );
    return true;
  } catch (err) {
    if (DUPLICATE_KEY.includes(err.number)) return false;
    throw err;
  }
}

function notify(meet, { title, body }, type) {
  const message = {
    title: meet.testOnly ? `[Test] ${title}` : title,
    body,
    data: { type, season: meet.season, eventCode: meet.eventCode },
  };
  return meet.testOnly ? sendToUser(meet.startedBy, message) : sendToTeam(message);
}

// `message` may be a function, so any lookups it needs only happen for
// alerts that are actually going out.
async function alertOnce(pool, meet, matchKey, kind, message, type) {
  if (await claim(pool, meet, matchKey, kind)) {
    await notify(meet, typeof message === 'function' ? await message() : message, type);
    return 1;
  }
  return 0;
}

async function getActiveMeet(pool) {
  const result = await pool
    .request()
    .query('SELECT TOP 1 * FROM ActiveMeets WHERE endedAt IS NULL ORDER BY startedAt DESC');
  const row = result.recordset[0];
  return row ? { ...row, testOnly: !!row.testOnly } : null;
}

async function endMeet(pool, meetId) {
  await pool
    .request()
    .input('id', sql.NVarChar, meetId)
    .query('UPDATE ActiveMeets SET endedAt = SYSUTCDATETIME() WHERE id = @id');
}

/**
 * Starts meet mode (ending any other active meet). Results already posted
 * are marked as sent so nobody gets a burst of old news, then the team
 * gets one "meet mode on" push with our match list.
 */
async function startMeet(pool, { season, eventCode, teamNumber = OUR_TEAM, testOnly = false, startedBy }) {
  const event = await fetchEventMatches(season, eventCode);
  if (!event) return null;

  await pool.request().query('UPDATE ActiveMeets SET endedAt = SYSUTCDATETIME() WHERE endedAt IS NULL');
  const meet = { id: `meet-${crypto.randomUUID()}`, season, eventCode, teamNumber, testOnly, startedBy };
  await pool
    .request()
    .input('id', sql.NVarChar, meet.id)
    .input('season', sql.Int, season)
    .input('eventCode', sql.NVarChar, eventCode)
    .input('teamNumber', sql.Int, teamNumber)
    .input('testOnly', sql.Bit, testOnly)
    .input('startedBy', sql.NVarChar, startedBy)
    .query(
      `INSERT INTO ActiveMeets (id, season, eventCode, teamNumber, testOnly, startedBy)
       VALUES (@id, @season, @eventCode, @teamNumber, @testOnly, @startedBy)`,
    );

  const ours = event.matches.filter((m) => hasTeam(m, teamNumber));
  for (const m of ours.filter((x) => x.hasBeenPlayed)) await claim(pool, meet, m.matchKey, 'result');
  if (ours.length) await claim(pool, meet, 'SCHEDULE', 'schedule');

  await notify(
    meet,
    {
      title: `Meet mode on: ${event.name}`,
      body: ours.length
        ? `Our matches: ${ours.map(shortLabel).join(', ')}. Alerts ~10 and ~5 min before each.`
        : "Alerts ~10 and ~5 min before each of our matches once they're scheduled.",
    },
    'meet_started',
  );
  return { ...meet, eventName: event.name };
}

/** One pass of meet mode. Safe to run as often as you like. */
async function runMeetTick({ now = new Date() } = {}) {
  const pool = await getPool();
  const meet = await getActiveMeet(pool);
  if (!meet) return { active: false };

  const event = await fetchEventMatches(meet.season, meet.eventCode);
  if (!event) return { active: true, eventFound: false };

  const nowMin = venueNowMinutes(event.timezone, now);
  if (event.dateEnd && wallString(nowMin).slice(0, 10) > String(event.dateEnd).slice(0, 10)) {
    await endMeet(pool, meet.id);
    return { active: false, ended: true };
  }

  const ours = withEstimates(event.matches).filter((m) => hasTeam(m, meet.teamNumber));
  let sent = 0;
  if (ours.length) {
    sent += await alertOnce(pool, meet, 'SCHEDULE', 'schedule', scheduleMessage(event.name, ours), 'meet_schedule');
  }

  for (const m of ours) {
    if (m.hasBeenPlayed) {
      if (m.redScore !== null && m.blueScore !== null) {
        const message = async () =>
          resultMessage(m, meet.teamNumber, await breakdownFor(meet.season, meet.eventCode, m));
        sent += await alertOnce(pool, meet, m.matchKey, 'result', message, 'meet_result');
      }
      continue;
    }
    if (!m.estimatedStartTime) continue;
    const minutesLeft = wallMinutes(m.estimatedStartTime) - nowMin - EARLY_MARGIN_MIN;
    if (minutesLeft <= 5 && minutesLeft > -5) {
      await claim(pool, meet, m.matchKey, '10min'); // too late for the 10-minute one
      sent += await alertOnce(pool, meet, m.matchKey, '5min', warningMessage(m, meet.teamNumber, 5), 'meet_match');
    } else if (minutesLeft <= 10 && minutesLeft > 5) {
      sent += await alertOnce(pool, meet, m.matchKey, '10min', warningMessage(m, meet.teamNumber, 10), 'meet_match');
    }
  }
  return { active: true, alertsSent: sent };
}

module.exports = {
  OUR_TEAM,
  currentSeason,
  withEstimates,
  hasTeam,
  venueNowMinutes,
  wallMinutes,
  getActiveMeet,
  startMeet,
  endMeet,
  runMeetTick,
  breakdownFor,
  resultMessage,
};
