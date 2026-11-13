import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { decryptToken, encryptToken } from './crypto.js';
import { deleteStoredDriveToken, getStoredDriveToken, saveStoredDriveToken } from './tokenStore.js';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const pendingStates = new Map();
const accessTokens = new Map();
const refreshLocks = new Map();

function newOAuthClient() {
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

function pruneStates() {
  const now = Date.now();
  for (const [state, entry] of pendingStates) {
    if (entry.expiresAt <= now) pendingStates.delete(state);
  }
}

export function createDriveAuthorization(user, returnTo = '/', origin = '') {
  pruneStates();
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    const error = new Error('Invalid return path.');
    error.status = 400;
    throw error;
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  pendingStates.set(state, { user, codeVerifier, returnTo, origin, expiresAt: Date.now() + 10 * 60_000 });

  const authUrl = newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    login_hint: user.email,
    include_granted_scopes: true,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return authUrl;
}

export async function completeDriveAuthorization(state, code) {
  pruneStates();
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.expiresAt <= Date.now() || typeof code !== 'string' || !code) {
    const error = new Error('Google Drive authorization expired or the state is invalid. Try connecting again.');
    error.status = 400;
    throw error;
  }

  const client = newOAuthClient();
  const { tokens } = await client.getToken({ code, codeVerifier: pending.codeVerifier });
  if (!tokens.access_token) {
    const error = new Error('Google did not return an access token. Reconnect Drive and try again.');
    error.status = 403;
    throw error;
  }
  const tokenInfo = await client.getTokenInfo(tokens.access_token);
  const grantedScopes = tokenInfo.scopes || [];
  if (!grantedScopes.includes(SCOPES[0])) {
    const error = new Error('Google did not grant read-only Drive access. Check that drive.readonly is enabled on the OAuth consent screen, then remove Nook from Google Account connections and reconnect.');
    error.status = 403;
    throw error;
  }
  if (String(tokenInfo.email || '').toLowerCase() !== pending.user.email.toLowerCase()) {
    const error = new Error(`Drive was connected as ${tokenInfo.email || 'a different Google account'}, but you signed into Nook as ${pending.user.email}. Reconnect Drive and choose the same account.`);
    error.status = 403;
    throw error;
  }
  if (!tokens.refresh_token) {
    const error = new Error('Google did not provide a refresh token. Remove Nook from Google Account connections, then reconnect and approve Drive access.');
    error.status = 400;
    throw error;
  }
  saveStoredDriveToken(
    pending.user.id,
    pending.user.email,
    encryptToken(tokens.refresh_token),
    grantedScopes,
  );
  accessTokens.delete(pending.user.id);
  return { ...pending.user, returnTo: pending.returnTo, origin: pending.origin };
}

function isInvalidGrant(error) {
  return error?.response?.data?.error === 'invalid_grant'
    || error?.message?.includes('invalid_grant')
    || error?.code === 'invalid_grant';
}

export async function getDriveAccessToken(userId, forceRefresh = false) {
  const cached = accessTokens.get(userId);
  if (!forceRefresh && cached?.expiresAt > Date.now() + 60_000) return cached.value;
  if (refreshLocks.has(userId)) return refreshLocks.get(userId);

  const refreshPromise = (async () => {
    const stored = getStoredDriveToken(userId);
    if (!stored?.encryptedRefreshToken) {
      const error = new Error('Connect your Google Drive account before using Drive files.');
      error.status = 409;
      throw error;
    }
    if (!Array.isArray(stored.scopes) || !stored.scopes.includes(SCOPES[0])) {
      const error = new Error('Your saved Drive connection predates read-only Drive access. Reconnect Drive and approve the updated permission.');
      error.status = 409;
      throw error;
    }

    try {
      const client = newOAuthClient();
      client.setCredentials({ refresh_token: decryptToken(stored.encryptedRefreshToken) });
      const result = await client.getAccessToken();
      const token = result?.token;
      if (!token) throw new Error('Google did not return an access token.');
      const tokenInfo = await client.getTokenInfo(token);
      if (!tokenInfo.scopes?.includes(SCOPES[0])) {
        accessTokens.delete(userId);
        const error = new Error('The saved Google Drive grant does not include read-only Drive access. Remove Nook from Google Account connections and reconnect.');
        error.status = 409;
        throw error;
      }
      if (String(tokenInfo.email || '').toLowerCase() !== stored.email.toLowerCase()) {
        accessTokens.delete(userId);
        const error = new Error(`Drive is connected as ${tokenInfo.email || 'a different Google account'}, not ${stored.email}. Reconnect Drive and choose the same account used to sign into Nook.`);
        error.status = 409;
        throw error;
      }
      const credentials = client.credentials;
      const expiresAt = Number(credentials.expiry_date || Date.now() + 55 * 60_000);
      accessTokens.set(userId, { value: token, expiresAt });
      return token;
    } catch (error) {
      if (isInvalidGrant(error)) {
        deleteStoredDriveToken(userId);
        accessTokens.delete(userId);
        const reconnectError = new Error('Google Drive access expired. Reconnect your account.');
        reconnectError.status = 401;
        throw reconnectError;
      }
      throw new Error('Unable to refresh Google Drive access.');
    }
  })();

  refreshLocks.set(userId, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    refreshLocks.delete(userId);
  }
}

export function isDriveConnected(userId) {
  const stored = getStoredDriveToken(userId);
  return Boolean(
    stored?.encryptedRefreshToken
    && Array.isArray(stored.scopes)
    && stored.scopes.includes(SCOPES[0]),
  );
}

export async function getDriveApiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Google may return an empty response for some access errors.
  }
  const googleError = payload?.error;
  const reasons = Array.isArray(googleError?.errors)
    ? googleError.errors.map((item) => item.reason).filter(Boolean)
    : [];
  const diagnostics = [
    googleError?.status,
    ...reasons,
    googleError?.message,
  ].filter(Boolean).join(' ').toLowerCase();
  const reasonLabel = reasons.length ? reasons.join(', ') : String(googleError?.status || 'unknown');
  const googleMessage = String(googleError?.message || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (diagnostics.includes('accessnotconfigured') || diagnostics.includes('service_disabled')) {
    return `Google Drive API is not enabled for this Google Cloud project (${reasonLabel}). Enable it in APIs & Services, wait a few minutes, and try again.`;
  }
  if (diagnostics.includes('insufficientfilepermissions') || diagnostics.includes('file permissions')) {
    return `Google recognizes the Drive connection, but this account cannot read the selected file (${reasonLabel}). Confirm the selected item is owned by the connected account in My Drive and is downloadable.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
  }
  if (diagnostics.includes('appnotauthorizedtofile')) {
    return `Google has not authorized Nook to access this file (${reasonLabel}). Remove Nook from Google Account connections, then reconnect Drive and approve read-only access.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
  }
  if (diagnostics.includes('insufficientpermissions') || diagnostics.includes('permission_denied')) {
    return `Google rejected the Drive API request (${reasonLabel}). The server verified that this account's token includes drive.readonly. Confirm this exact file is readable through Google Drive API and not restricted from downloading.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
  }
  if (response.status === 403) {
    return `Google Drive denied access (${reasonLabel}). Confirm this exact file is owned by the connected account in My Drive and can be downloaded.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
  }
  if (response.status === 404) {
    return `Google Drive could not find this file (${reasonLabel}). It may have been removed or the selected Google account may not own it.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
  }
  return `Google Drive could not read this file (${reasonLabel}). Check Drive API configuration.${googleMessage ? ` Google: ${googleMessage}` : ''}`;
}

async function driveFetch(userId, url, options = {}, retry = true) {
  const accessToken = await getDriveAccessToken(userId);
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  });
  if (response.status === 401 && retry) {
    await response.body?.cancel();
    await getDriveAccessToken(userId, true);
    return driveFetch(userId, url, options, false);
  }
  return response;
}

export async function getDriveFileMetadata(userId, fileId) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,mimeType,size,trashed');
  const response = await driveFetch(userId, url);
  if (!response.ok) {
    const message = await getDriveApiError(response);
    const error = new Error(message);
    error.status = response.status === 403 || response.status === 404 ? response.status : 502;
    throw error;
  }
  return response.json();
}

export async function getDriveMediaResponse(userId, fileId, range, retry = true, method = 'GET', signal) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await driveFetch(userId, url, {
    method,
    signal,
    headers: range ? { Range: range } : {},
  }, retry);
  return response;
}

export async function disconnectDrive(userId) {
  const stored = getStoredDriveToken(userId);
  accessTokens.delete(userId);
  if (!stored) return;
  try {
    const client = newOAuthClient();
    const refreshToken = decryptToken(stored.encryptedRefreshToken);
    await client.revokeToken(refreshToken);
  } finally {
    deleteStoredDriveToken(userId);
  }
}
