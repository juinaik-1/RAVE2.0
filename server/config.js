import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, '..');

for (const envPath of [path.join(serverDir, '.env'), path.join(projectDir, '.env')]) {
  dotenv.config({ path: envPath });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function strongSecret(name) {
  const value = required(name);
  if (value.length < 32 || new Set(value).size < 12 || /^(change-me|replace-with)/i.test(value)) {
    throw new Error(`${name} must be a randomly generated secret with at least 32 characters.`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseFfmpegThreads(value) {
  const threads = Number(value || 2);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) {
    throw new Error('FFMPEG_THREADS must be an integer between 1 and 8.');
  }
  return threads;
}

// The free space the disk must have left before a new conversion is accepted.
// This is a tripwire, not a reservation: the per job check still insists on
// room for the source and the output together. One gigabyte keeps a small
// hosted disk usable while still stopping a runaway download.
function parseFreeDiskGb(value) {
  const gigabytes = Number(value ?? 1);
  if (!Number.isFinite(gigabytes) || gigabytes <= 0) {
    throw new Error('MIN_FREE_DISK_GB must be a positive number.');
  }
  return gigabytes * 1024 ** 3;
}

// How many requests one client address may make per minute.
function parseRateLimit(value, fallback) {
  const limit = Number(value ?? fallback);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('The rate limits must be positive whole numbers.');
  }
  return limit;
}

// How long a leftover file is kept before the cleanup removes it. A file that
// is still referenced by a live stream is never removed. It follows the file
// lifetime so the two can never disagree.
function parseOrphanFileTtlHours(value, fallbackHours) {
  const hours = Number(value ?? fallbackHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('ORPHAN_FILE_TTL_HOURS must be a positive number.');
  }
  return hours * 60 * 60 * 1000;
}

function resolveDirectory(value, fallback) {
  const directory = value || fallback;
  return path.isAbsolute(directory) ? directory : path.resolve(projectDir, directory);
}

const frontendOrigins = required('FRONTEND_ORIGINS')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!frontendOrigins.length || frontendOrigins.some((origin) => {
  try {
    return new URL(origin).origin !== origin;
  } catch {
    return true;
  }
})) {
  throw new Error('FRONTEND_ORIGINS must be a comma-separated list of exact origins.');
}

const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '') || '';
if (process.env.NODE_ENV === 'production' && !publicBaseUrl) {
  throw new Error('PUBLIC_BASE_URL is required in production.');
}
if (publicBaseUrl) {
  const parsed = new URL(publicBaseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('PUBLIC_BASE_URL must use HTTP or HTTPS.');
  }
  const publicHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (process.env.NODE_ENV === 'production' && (
    parsed.protocol !== 'https:'
    || publicHost === 'localhost'
    || publicHost === '::1'
    || publicHost === '0.0.0.0'
    || /^127\./.test(publicHost)
  )) {
    throw new Error('PUBLIC_BASE_URL must not point to localhost in production.');
  }
}

const allowedEmails = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
if (allowedEmails.some((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
  throw new Error('ALLOWED_EMAILS contains an invalid email address.');
}

const googleRedirectUri = required('GOOGLE_REDIRECT_URI');
const redirectUrl = new URL(googleRedirectUri);
if (!['http:', 'https:'].includes(redirectUrl.protocol)
    || redirectUrl.pathname !== '/api/auth/google/callback') {
  throw new Error('GOOGLE_REDIRECT_URI must be the full /api/auth/google/callback URL.');
}

const encryptionKeyText = strongSecret('TOKEN_ENCRYPTION_KEY');
let tokenEncryptionKey;
if (/^[a-f0-9]{64}$/i.test(encryptionKeyText)) {
  tokenEncryptionKey = Buffer.from(encryptionKeyText, 'hex');
} else {
  tokenEncryptionKey = Buffer.from(encryptionKeyText, 'base64');
}
if (tokenEncryptionKey.length !== 32) {
  throw new Error('TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes (base64 or 64 hex characters).');
}

// How long a converted video is kept and served, and how long a leftover file
// is kept before the cleanup removes it. One number decides both, so they can
// never disagree.
const fileTtlHours = Number(process.env.FILE_TTL_HOURS || 36);
if (!Number.isFinite(fileTtlHours) || fileTtlHours <= 0) {
  throw new Error('FILE_TTL_HOURS must be a positive number.');
}

export const config = Object.freeze({
  port: parsePort(process.env.PORT),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: publicBaseUrl || `http://localhost:${process.env.PORT || 3001}`,
  frontendOrigins,
  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri,
  sessionSecret: strongSecret('SESSION_SECRET'),
  streamSecret: strongSecret('STREAM_SECRET'),
  tokenEncryptionKey,
  allowedEmails: new Set(allowedEmails),
  dataDir: resolveDirectory(process.env.DATA_DIR, path.join(serverDir, 'data')),
  downloadDir: resolveDirectory(process.env.DOWNLOAD_DIR, path.join(serverDir, 'downloads')),
  maxSourceBytes: Number(process.env.MAX_SOURCE_GB || 5) * 1024 ** 3,
  maxQueueSize: Number(process.env.MAX_QUEUE_SIZE || 3),
  fileTtlMs: fileTtlHours * 60 * 60 * 1000,
  ffmpegThreads: parseFfmpegThreads(process.env.FFMPEG_THREADS),
  // Free space the disk must have left before a conversion is accepted.
  minFreeDiskBytes: parseFreeDiskGb(process.env.MIN_FREE_DISK_GB),
  // How long a leftover file is kept before the cleanup removes it. It follows
  // the file lifetime, so one number decides when a converted video goes.
  orphanFileTtlMs: parseOrphanFileTtlHours(process.env.ORPHAN_FILE_TTL_HOURS, fileTtlHours),
  // Requests one client address may make per minute.
  rateLimits: {
    api: parseRateLimit(process.env.API_RATE_LIMIT_PER_MIN, 120),
    auth: parseRateLimit(process.env.AUTH_RATE_LIMIT_PER_MIN, 20),
    drive: parseRateLimit(process.env.DRIVE_RATE_LIMIT_PER_MIN, 30),
    jobs: parseRateLimit(process.env.JOBS_RATE_LIMIT_PER_MIN, 20),
    // The media route streams bytes, not API calls, so it gets its own and
    // much larger budget.
    media: parseRateLimit(process.env.MEDIA_RATE_LIMIT_PER_MIN, 600),
  },
});

if (!Number.isFinite(config.maxSourceBytes) || config.maxSourceBytes <= 0
    || !Number.isInteger(config.maxQueueSize) || config.maxQueueSize < 1
    || !Number.isFinite(config.fileTtlMs) || config.fileTtlMs < 60_000) {
  throw new Error('MAX_SOURCE_GB, MAX_QUEUE_SIZE, or FILE_TTL_HOURS has an invalid value.');
}

export function ensureDataDirectories() {
  for (const directory of [config.dataDir, config.downloadDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}
