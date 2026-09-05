const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

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

const appleJwks = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
});

function getAppleSigningKey(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/** Verifies a Sign in with Apple identity token, returns { email }. Throws if invalid. */
function verifyAppleToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getAppleSigningKey,
      {
        algorithms: ['RS256'],
        audience: process.env.APPLE_CLIENT_ID,
        issuer: 'https://appleid.apple.com',
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve({ email: decoded.email });
      },
    );
  });
}

module.exports = { verifyGoogleToken, verifyAppleToken };
