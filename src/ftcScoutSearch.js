// FIRST's official FTC Events API (ftcApi.js) has no name-search parameter
// on its /teams endpoint at all (checked against its own swagger spec), so
// a team-name query has nowhere else to go. FTCScout's public GraphQL API
// does support it, and is used for this ONE purpose only - once a team
// number is known, everything else about that team still comes from
// ftcApi.js, same as the rest of the app.
const ENDPOINT = 'https://api.ftcscout.org/graphql';

const SEARCH_QUERY = `
  query ($searchText: String!, $limit: Int!) {
    teamsSearch(searchText: $searchText, limit: $limit) {
      number
      name
    }
  }
`;

/** Teams whose name matches searchText, best match first. */
async function searchTeamsByName(searchText, limit = 20) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SEARCH_QUERY, variables: { searchText, limit } }),
  });
  if (!res.ok) {
    throw new Error(`FTCScout search -> HTTP ${res.status}: ${await res.text()}`);
  }
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`FTCScout search: ${errors[0].message}`);
  // limit isn't always honored server-side, so trim it here too.
  return (data?.teamsSearch || []).slice(0, limit).map((t) => ({ number: t.number, name: t.name }));
}

module.exports = { searchTeamsByName };
