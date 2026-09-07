// A user can now be on more than one subteam. Stored in the DB as a single
// comma-separated string in the (widened) Users.subteam column, exposed over
// the API as a `subteams` array so the wire format matches what it actually
// means now.
const SUBTEAMS = ['mechanical', 'outreach', 'programming', 'strategy'];

function subteamsToDb(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.join(',');
}

function subteamsFromDb(value) {
  if (!value) return [];
  return value.split(',').filter(Boolean);
}

function isValidSubteamsArray(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((s) => SUBTEAMS.includes(s));
}

module.exports = { SUBTEAMS, subteamsToDb, subteamsFromDb, isValidSubteamsArray };
