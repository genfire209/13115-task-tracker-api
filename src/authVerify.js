const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/** Verifies a Google Sign-In id token, returns { email, name }. Throws if invalid. */
async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, name: payload.name || payload.email };
}

module.exports = { verifyGoogleToken };
