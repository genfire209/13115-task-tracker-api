// Replays the real 2026-10-24 USNJSOM1 meet minute by minute through meet
// mode and checks which alerts went out, and when. `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { tables, fakeFtc } = require('./fakeBackend');

const sent = [];
const pushId = require.resolve(path.join(__dirname, '..', 'src', 'push.js'));
require.cache[pushId] = {
  id: pushId,
  filename: pushId,
  loaded: true,
  exports: {
    sendToTeam: async (m) => sent.push({ to: 'team', at: fakeFtc.venueTime, ...m }),
    sendToUser: async (to, m) => sent.push({ to, at: fakeFtc.venueTime, ...m }),
    sendToAllUsers: async () => ({ sent: 0 }),
    sendToCaptainsAndAdmins: async () => {},
  },
};

const { startMeet, runMeetTick, withEstimates, wallMinutes } = require('../src/meetAlerts');
const { getPool } = require('../src/db');
const fixture = require('./fixtures/USNJSOM1.json');

// 2026-10-24 is daylight time in New Jersey (UTC-4).
const instant = (venueTime) => new Date(`${venueTime}-04:00`);
const at = (hhmm) => `2026-10-24T${hhmm}:00`;
const minutesOf = (t) => wallMinutes(t);

function reset() {
  sent.length = 0;
  tables.ActiveMeets.length = 0;
  tables.MeetAlertsSent.length = 0;
}

async function replayDay(meetOptions) {
  reset();
  const pool = await getPool();
  fakeFtc.setVenueTime(at('12:00'));
  await startMeet(pool, { season: 2026, eventCode: 'USNJSOM1', startedBy: 'captain@x.com', ...meetOptions });
  for (let t = minutesOf(at('12:00')); t <= minutesOf(at('15:30')); t++) {
    const venueTime = new Date(t * 60000).toISOString().slice(0, 19);
    fakeFtc.setVenueTime(venueTime);
    await runMeetTick({ now: instant(venueTime) });
  }
}

const ourMatches = fixture.matches.filter((m) => m.teams.some((t) => t.teamNumber === 13115));
const label = (m) => `Q${m.matchNum}`;
// The fixture has no actualStartTime; a match started about 4 min before its result posted.
const realStart = (m) => minutesOf(m.postResultTime) - 4;

test('no estimates until the first match has been played', () => {
  fakeFtc.setVenueTime(at('12:00'));
  assert.ok(withEstimates(fakeFtc.event().matches).every((m) => m.estimatedStartTime === null));
  fakeFtc.setVenueTime(at('12:43'));
  const est = withEstimates(fakeFtc.event().matches);
  assert.equal(est[0].estimatedStartTime, null); // Q1 played
  assert.ok(est[1].estimatedStartTime);
});

test('a real meet: one 10-min, one 5-min and one result alert per match of ours, in time', async () => {
  await replayDay();

  const start = sent.filter((a) => a.data.type === 'meet_started');
  assert.equal(start.length, 1);
  assert.match(start[0].body, /Q3, Q5, Q9, Q11, Q16, Q20/);

  const report = [];
  for (const m of ourMatches) {
    const of = (kind) => sent.filter((a) => a.title.startsWith(`${label(m)} `) || a.title.startsWith(`${label(m)}:`))
      .filter((a) => (kind === 'result' ? a.data.type === 'meet_result' : a.title.includes(`~${kind} min`)));
    const [ten, five, result] = [of(10), of(5), of('result')];
    assert.ok(ten.length <= 1 && five.length === 1 && result.length === 1, `${label(m)} alert counts`);
    const lead = realStart(m) - minutesOf(five[0].at);
    report.push(`${label(m)}: 10-min ${ten[0]?.at.slice(11, 16) ?? '-'}, 5-min ${five[0].at.slice(11, 16)} (${lead.toFixed(1)} min before it started), result ${result[0].at.slice(11, 16)}`);
    assert.ok(lead >= 3, `${label(m)} 5-min alert came only ${lead.toFixed(1)} min before the match started`);
    if (ten[0]) assert.ok(minutesOf(ten[0].at) <= minutesOf(five[0].at));
    assert.ok(minutesOf(result[0].at) >= minutesOf(m.postResultTime.slice(0, 16)));
  }
  console.log(report.join('\n'));

  // Nothing about anyone else's matches.
  const ourLabels = ourMatches.map(label);
  for (const a of sent.filter((x) => x.data.type === 'meet_match' || x.data.type === 'meet_result')) {
    assert.ok(ourLabels.includes(a.title.split(/[ :]/)[0]), a.title);
  }
});

test('running the tick again sends nothing twice', async () => {
  const before = sent.length;
  await runMeetTick({ now: instant(fakeFtc.venueTime) });
  assert.equal(sent.length, before);
});

test('a test run only alerts the admin who started it', async () => {
  await replayDay({ testOnly: true, startedBy: 'admin@x.com' });
  assert.ok(sent.length > 0);
  assert.ok(sent.every((a) => a.to === 'admin@x.com' && a.title.startsWith('[Test]')));
});

test('meet mode switches itself off after the meet', async () => {
  reset();
  const pool = await getPool();
  fakeFtc.setVenueTime(at('12:00'));
  await startMeet(pool, { season: 2026, eventCode: 'USNJSOM1', startedBy: 'captain@x.com' });
  const result = await runMeetTick({ now: instant('2026-10-25T09:00:00') });
  assert.equal(result.ended, true);
  assert.ok(tables.ActiveMeets[0].endedAt);
});

test('result alerts say which ranking points we earned', () => {
  const { resultMessage } = require('../src/meetAlerts');
  const { normalizeMatchScores } = require('../src/scoreDetails');
  const q8 = fixture.matches.find((m) => m.matchNum === 8);
  const breakdown = normalizeMatchScores(require('./fixtures/USNJSOM1-scores-qual.json'))['0-8'];
  assert.equal(resultMessage(q8, 32294, breakdown).title, 'Q8: We lost 26-37');
  assert.match(resultMessage(q8, 32294, breakdown).body, /\+1 RP \(SWARM\)$/);
  assert.match(resultMessage(q8, 36975, breakdown).body, /\+3 RP \(win\)$/);
  assert.doesNotMatch(resultMessage(q8, 36975, null).body, /RP/);
});
