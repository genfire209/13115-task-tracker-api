const { OAuth2Client } = require('google-auth-library');

// Accepts tokens audienced to either client: GOOGLE_CLIENT_ID is the iOS
// app's own OAuth client (used when no serverClientId is requested, which
// is how already-shipped iOS builds behave), and GOOGLE_CLIENT_ID_WEB is
// the shared web client that both platforms request via serverClientId
// going forward. Keeping both valid means older iOS builds already out
// for TestFlight review don't break when this changes.
const AUDIENCES = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_ID_WEB].filter(Boolean);
const googleClient = new OAuth2Client();

/** Verifies a Google Sign-In id token, returns { email, name }. Throws if invalid. */
async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: AUDIENCES,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, name: payload.name || payload.email };
}

module.exports = { verifyGoogleToken };
