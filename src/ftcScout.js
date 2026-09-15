// Thin client for FTCScout's free, public GraphQL API (no key required) -
// https://ftcscout.org/api. Used for the hidden "FTC Live" feature: showing
// an event's up-next match and recent results, and the cron job that
// notifies on every newly-completed match.
const ENDPOINT = 'https://api.ftcscout.org/graphql';

// FTCScout adds that season's score-breakdown type (MatchScoresYYYY) to
// their schema a few weeks after that season's kickoff. Referencing a type
// that doesn't exist yet is a GraphQL validation error, so this can only
// list types that already exist - it can't get ahead of them. If a brand
// new season's matches come back with no `redScore`/`blueScore`, that's why:
// everything else (teams, winner via score comparison, whether it's been
// played) still works, only the point totals lag until FTCScout adds it.
// To add a new season once it's live, introspect with:
//   { __type(name: "MatchScoresYYYY") { name } }
// and add a matching "... on MatchScoresYYYY { red { totalPoints } blue { totalPoints } }" line below.
const SCORE_FRAGMENT = `
  ... on MatchScores2025 { red { totalPoints } blue { totalPoints } }
  ... on MatchScores2024 { red { totalPoints } blue { totalPoints } }
  ... on MatchScores2023 { red { totalPoints } blue { totalPoints } }
`;

async function graphql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

/** Returns { name, matches: [...] } for an event, or null if not found. */
async function fetchEventMatches(season, eventCode) {
  const data = await graphql(
    `query($season: Int!, $code: String!) {
      eventByCode(season: $season, code: $code) {
        name
        started
        finished
        matches {
          id
          matchNum
          tournamentLevel
          description
          hasBeenPlayed
          scheduledStartTime
          postResultTime
          teams { alliance station teamNumber }
          scores { ${SCORE_FRAGMENT} }
        }
      }
    }`,
    { season, code: eventCode },
  );
  const event = data.eventByCode;
  if (!event) return null;
  return {
    name: event.name,
    started: event.started,
    finished: event.finished,
    matches: event.matches.map((m) => ({
      id: m.id,
      matchNum: m.matchNum,
      tournamentLevel: m.tournamentLevel,
      description: m.description,
      hasBeenPlayed: m.hasBeenPlayed,
      scheduledStartTime: m.scheduledStartTime,
      postResultTime: m.postResultTime,
      teams: m.teams,
      redScore: m.scores?.red?.totalPoints ?? null,
      blueScore: m.scores?.blue?.totalPoints ?? null,
    })),
  };
}

module.exports = { fetchEventMatches };
