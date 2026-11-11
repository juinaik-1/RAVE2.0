import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const identityClient = new OAuth2Client(config.googleClientId);

export async function authenticateGoogleIdToken(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 10_000) {
    const error = new Error('A valid Google ID token is required.');
    error.status = 400;
    throw error;
  }

  const ticket = await identityClient.verifyIdToken({
    idToken,
    audience: config.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || payload.email_verified !== true || !payload.email) {
    const error = new Error('Google account email is not verified.');
    error.status = 403;
    throw error;
  }

  const email = payload.email.toLowerCase();
  if (!config.allowedEmails.has(email)) {
    const error = new Error('This Google account is not allowed to use Nook.');
    error.status = 403;
    throw error;
  }

  return {
    id: payload.sub,
    email,
    name: payload.name || email,
    picture: payload.picture || '',
  };
}

export function issueSessionToken(user) {
  return jwt.sign({ email: user.email }, config.sessionSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: '12h',
    issuer: 'Nook',
    audience: 'Nook-app',
  });
}

export function requireSession(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) {
    return res.status(401).json({ error: 'A valid session is required.' });
  }
  try {
    const claims = jwt.verify(match[1], config.sessionSecret, {
      algorithms: ['HS256'],
      issuer: 'Nook',
      audience: 'Nook-app',
    });
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
      return res.status(401).json({ error: 'The session token is invalid.' });
    }
    req.user = { id: claims.sub, email: claims.email };
    return next();
  } catch {
    return res.status(401).json({ error: 'The session is invalid or expired. Sign in again.' });
  }
}

export function issueStreamToken(streamId, ownerUserId) {
  return jwt.sign({ streamId }, config.streamSecret, {
    algorithm: 'HS256',
    subject: ownerUserId,
    expiresIn: '12h',
    issuer: 'Nook',
    audience: 'Nook-stream',
  });
}

export function verifyStreamToken(token) {
  return jwt.verify(token, config.streamSecret, {
    algorithms: ['HS256'],
    issuer: 'Nook',
    audience: 'Nook-stream',
  });
}
