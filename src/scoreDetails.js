// FIRST's BIOBUZZ score detail (ScoreDetailAllianceModel_2026 in the FTC
// Events API) turned into the breakdown the app shows - the same numbers as
// a match page on ftc-events.firstinspires.org: the auto / teleop / penalty
// split, what each robot did, HIVE / GARDEN / FLOWER contents, and the
// ranking points each alliance earned.

function allianceBreakdown(a, opponent) {
  return {
    auto: {
      tips: a.autoHiveTips,
      robots: [
        { leave: !!a.autoRobot1Leave, park: !!a.autoRobot1Park },
        { leave: !!a.autoRobot2Leave, park: !!a.autoRobot2Park },
      ],
      leavePoints: a.autoLeavePoints,
      parkPoints: a.autoParkPoints,
      hivePoints: a.autoHivePoints,
      points: a.autoPoints,
    },
    teleop: {
      tips: a.teleopHiveTips,
      hiveBalls: a.teleopHivePollenNectar,
      gardenBalls: a.teleopGardenPollenNectar,
      robots: [{ park: !!a.teleopRobot1Park }, { park: !!a.teleopRobot2Park }],
      hivePoints: a.teleopHivePoints,
      flowerPoints: a.teleopFlowerPoints,
      gardenPoints: a.teleopGardenPoints,
      parkPoints: a.teleopParkPoints,
      points: a.teleopPoints,
    },
    // Penalty points this alliance was awarded = the fouls the other one committed.
    penaltyPoints: opponent?.foulPointsCommitted ?? 0,
    minorFouls: a.minorFouls, // committed by this alliance
    majorFouls: a.majorFouls,
    total: a.totalPoints,
    bonusRp: { swarm: !!a.swarmRP, pollinator1: !!a.pollinator1RP, pollinator2: !!a.pollinator2RP },
  };
}

/**
 * Response of GET /{season}/scores/{event}/{qual|playoff} -> an object keyed
 * "series-matchNumber" of { red, blue, flowers }. FLOWER contents are lists of
 * 'RED_NECTAR' | 'BLUE_NECTAR' | 'POLLEN', the same for both alliances.
 */
function normalizeMatchScores(data) {
  const out = {};
  for (const m of data?.matchScores || []) {
    const red = m.alliances?.find((a) => a.alliance === 'Red');
    const blue = m.alliances?.find((a) => a.alliance === 'Blue');
    if (!red || !blue) continue;
    out[`${m.matchSeries}-${m.matchNumber}`] = {
      red: allianceBreakdown(red, blue),
      blue: allianceBreakdown(blue, red),
      flowers: {
        redWall: red.redAllianceFlower || [],
        scoring: red.scoringFlower || [],
        blueWall: red.blueAllianceFlower || [],
        audience: red.audienceFlower || [],
      },
    };
  }
  return out;
}

/** Ranking points an alliance took from a played match: 3 win / 1 tie, plus the bonuses. */
function rankingPoints(match, alliance, breakdown) {
  const ours = alliance === 'Red' ? match.redScore : match.blueScore;
  const theirs = alliance === 'Red' ? match.blueScore : match.redScore;
  const win = ours > theirs ? 3 : ours === theirs ? 1 : 0;
  const bonus = breakdown?.[alliance === 'Red' ? 'red' : 'blue'].bonusRp ?? null;
  const total = win + (bonus ? [bonus.swarm, bonus.pollinator1, bonus.pollinator2].filter(Boolean).length : 0);
  return { win, ...(bonus || {}), total, bonusKnown: !!bonus };
}

module.exports = { normalizeMatchScores, rankingPoints };
