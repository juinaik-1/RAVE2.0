import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { issueStreamToken, verifyStreamToken } from './auth.js';
import { getDriveFileMetadata, getDriveMediaResponse } from './driveOAuth.js';
import { probeMediaFile } from './probe.js';
import { isValidStreamId } from './security.js';

const streamPath = path.join(config.dataDir, 'streams.json');
const records = new Map();

function persistRecords() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const temporary = `${streamPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...records.values()]), { mode: 0o600 });
  fs.renameSync(temporary, streamPath);
}

function loadRecords() {
  try {
    const saved = JSON.parse(fs.readFileSync(streamPath, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('Invalid stream store');
    for (const record of saved) {
      if (record && isValidStreamId(record.streamId) && ['drive', 'file'].includes(record.kind)) {
        records.set(record.streamId, record);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to read the stream registry.');
  }
}

loadRecords();

function makeRecord(ownerUserId, kind, properties) {
  const record = {
    streamId: crypto.randomBytes(16).toString('hex'),
    ownerUserId,
    kind,
    ...properties,
    createdAt: Date.now(),
    expiresAt: Date.now() + (kind === 'file' ? config.fileTtlMs : 12 * 60 * 60_000),
  };
  records.set(record.streamId, record);
  persistRecords();
  return record;
}

// Media types that are definitely not a video. Anything else (including
// application/octet-stream, which is what many .mkv/.avi/.hevc uploads report)
// is passed to the media probe, which reports whether a video track exists.
const NON_VIDEO_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-msdownload',
  'application/x-msi',
  'application/vnd.debian.binary-package',
  'application/x-executable',
  'application/x-sharedlib',
  'application/vnd.android.package-archive',
  'application/x-apple-diskimage',
  'application/x-iso9660-image',
  'application/epub+zip',
  'application/vnd.amazon.ebook',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.database',
  'application/x-sqlite3',
  'application/vnd.mozilla.xul+xml',
  'application/x-font-ttf',
  'application/vnd.ms-fontobject',
  'application/x-sh',
  'application/x-csh',
  'text/plain',
  'text/html',
  'text/csv',
  'application/json',
  'application/xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/vnd.djvu',
  'image/heic',
  'image/avif',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/flac',
  'audio/x-m4a',
]);

function isVideoMimeType(mimeType) {
  if (!mimeType) return true;
  if (mimeType.startsWith('video/')) return true;
  return !NON_VIDEO_MIME_TYPES.has(mimeType);
}

export async function registerDriveStream(ownerUserId, fileId) {
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,256}$/.test(fileId)) {
    const error = new Error('A valid Google Drive file ID is required.');
    error.status = 400;
    throw error;
  }
  const metadata = await getDriveFileMetadata(ownerUserId, fileId);
  const mimeType = String(metadata.mimeType || '').toLowerCase();
  if (metadata.trashed || mimeType === 'application/vnd.google-apps.folder'
      || mimeType.startsWith('application/vnd.google-apps.')) {
    const error = new Error('Select a downloadable video file, not a folder or Google Docs item.');
    error.status = 400;
    throw error;
  }
  // The Drive picker also lists non-video files (archives, documents, apps).
  // Reject them here with a clear message instead of letting the media probe
  // fail and surface as a server error.
  if (!isVideoMimeType(mimeType)) {
    const error = new Error(`"${metadata.name || 'This file'}" is not a video file. Choose an MP4, MKV, AVI, MOV, or WebM file.`);
    error.status = 400;
    throw error;
  }
  const reportedSize = Number(metadata.size || 0);
  let probe;
  try {
    probe = await probeMediaFile('', {
      driveSource: { ownerUserId, fileId, size: reportedSize },
    });
  } catch (probeError) {
    // Drive reports the size as 0 for a file it cannot measure, and refuses
    // every range request for it. A file the account may only view but not
    // download cannot be probed or converted either. Say which one it is.
    if (probeError.driveStatus === 403) {
      const error = new Error(`"${metadata.name || 'This file'}" cannot be downloaded from Google Drive. Allow downloading for this account, then try again.`);
      error.status = 403;
      error.exposeToUser = true;
      throw error;
    }
    if (reportedSize === 0) {
      const error = new Error(`"${metadata.name || 'This file'}" is empty or cannot be read from Google Drive.`);
      error.status = 400;
      error.exposeToUser = true;
      throw error;
    }
    if (probeError.status === 502 || /could not provide media|refused to download/i.test(probeError.message || '')) {
      const error = new Error(`"${metadata.name || 'This file'}" cannot be downloaded from Google Drive. Allow downloading for this account, then try again.`);
      error.status = 403;
      error.exposeToUser = true;
      throw error;
    }
    throw probeError;
  }
  if (!probe.video) {
    const error = new Error('This Drive file does not contain a video track. Choose a supported video file.');
    error.status = 400;
    error.exposeToUser = true;
    throw error;
  }
  const record = makeRecord(ownerUserId, 'drive', {
    fileId,
    name: metadata.name || 'Drive video',
    mimeType: metadata.mimeType || 'application/octet-stream',
    size: reportedSize,
  });
  return { ...record, playable: probe.playable, reason: probe.reason, audioTracks: probe.audioTracks };
}

export function createConvertedStream(ownerUserId, filePath, name, size) {
  const expectedDirectory = path.resolve(config.downloadDir);
  if (path.dirname(path.resolve(filePath)) !== expectedDirectory) {
    throw new Error('Converted output path is outside the configured download directory.');
  }
  return makeRecord(ownerUserId, 'file', {
    filePath,
    name,
    mimeType: 'video/mp4',
    size,
  });
}

export function getStream(streamId) {
  if (!isValidStreamId(streamId)) return null;
  return records.get(streamId) || null;
}

// The files that live streams still serve. The cleanup must never remove
// these, or a room that is watching would lose its video.
export function listReferencedFilePaths() {
  return [...records.values()]
    .filter((record) => record.kind === 'file')
    .map((record) => path.resolve(record.filePath));
}

// Drop the records whose file is already gone. A conversion that was
// interrupted, or a stream that was deleted, leaves a record behind that
// points at nothing.
export function pruneMissingStreamRecords() {
  let changed = false;
  for (const [streamId, record] of records) {
    if (record.kind !== 'file' || !record.filePath) continue;
    if (fs.existsSync(record.filePath)) continue;
    records.delete(streamId);
    changed = true;
  }
  if (changed) persistRecords();
  return changed;
}

// The converted videos this account still has on disk.
//
// The backend owns this list. The converted files live on this machine and
// the cleanup job deletes them when they expire, so the filesystem is the
// only source of truth: a record whose file is gone is not offered, and a
// file the cleanup has not reached yet is.
export function getUserActiveStreams(userId) {
  const now = Date.now();
  const active = [];
  for (const record of records.values()) {
    if (record.ownerUserId !== userId) continue;
    if (record.kind !== 'file') continue;
    if (!record.expiresAt || record.expiresAt <= now) continue;
    if (!record.filePath || !fs.existsSync(record.filePath)) continue;
    active.push({
      streamId: record.streamId,
      name: record.name,
      expiresAt: record.expiresAt,
    });
  }
  // The newest conversion expires last, so it is offered first.
  return active.sort((a, b) => b.expiresAt - a.expiresAt);
}

export function getStreamAccess(streamId) {
  const record = getStream(streamId);
  if (!record || record.expiresAt <= Date.now()) return null;
  const token = issueStreamToken(record.streamId, record.ownerUserId);
  return {
    url: `${config.publicBaseUrl}/api/stream/${record.streamId}?t=${encodeURIComponent(token)}`,
    name: record.name,
    expiresAt: Math.min(Date.now() + 12 * 60 * 60_000, record.expiresAt),
  };
}

export function deleteStream(streamId) {
  const record = getStream(streamId);
  if (!record) return null;
  records.delete(streamId);
  if (record.kind === 'file' && path.dirname(path.resolve(record.filePath)) === path.resolve(config.downloadDir)) {
    fs.rmSync(record.filePath, { force: true });
  }
  persistRecords();
  return record;
}

export function deleteExpiredStreams(now = Date.now()) {
  let changed = false;
  for (const [streamId, record] of records) {
    if (record.expiresAt <= now) {
      if (record.kind === 'file' && path.dirname(path.resolve(record.filePath)) === path.resolve(config.downloadDir)) {
        fs.rmSync(record.filePath, { force: true });
      }
      records.delete(streamId);
      changed = true;
    }
  }
  const referenced = new Set([...records.values()]
    .filter((record) => record.kind === 'file')
    .map((record) => path.resolve(record.filePath)));
  let names = [];
  try {
    names = fs.readdirSync(config.downloadDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.(?:mp4|source\..+|converted\.mp4)$/.test(name)) continue;
    const filePath = path.resolve(config.downloadDir, name);
    if (referenced.has(filePath)) continue;
    try {
      if (now - fs.statSync(filePath).mtimeMs > config.fileTtlMs) fs.rmSync(filePath, { force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (changed) persistRecords();
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return { invalid: true };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

function sendRangeError(res, size) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes */${size}`);
  res.setHeader('Content-Length', '0');
  res.status(416).end();
}

async function serveDriveStream(req, res, record, rangeHeader) {
  const parsedRange = parseRange(rangeHeader, Number(record.size || 0));
  if (parsedRange?.invalid) return sendRangeError(res, Number(record.size || 0));
  const validatedRange = parsedRange ? `bytes=${parsedRange.start}-${parsedRange.end}` : null;
  const response = await getDriveMediaResponse(
    record.ownerUserId,
    record.fileId,
    validatedRange,
    true,
    'GET',
  );
  if ([403, 404].includes(response.status)) {
    await response.body?.cancel();
    return res.status(response.status).json({
      error: response.status === 403
        ? 'Google Drive no longer allows access to this video.'
        : 'The Google Drive video no longer exists.',
    });
  }
  if (response.status === 401) {
    await response.body?.cancel();
    return res.status(401).json({ error: 'Google Drive access expired. Reconnect the owner account.' });
  }
  if (![200, 206, 416].includes(response.status)) {
    await response.body?.cancel();
    return res.status(502).json({ error: 'Google Drive could not stream this video.' });
  }
  if (response.status === 416) {
    res.setHeader('Accept-Ranges', 'bytes');
    const contentRange = response.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    return res.status(416).end();
  }

  res.status(response.status);
  res.setHeader('Content-Type', record.mimeType || response.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  const contentLength = response.headers.get('content-length')
    || (parsedRange && response.status === 206
      ? String(parsedRange.end - parsedRange.start + 1)
      : String(record.size || ''));
  if (contentLength) res.setHeader('Content-Length', contentLength);
  const contentRange = response.headers.get('content-range')
    || (parsedRange && response.status === 206
      ? `bytes ${parsedRange.start}-${parsedRange.end}/${record.size}`
      : '');
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (req.method === 'HEAD') {
    await response.body?.cancel();
    return res.end();
  }
  if (!response.body) return res.end();
  const upstream = Readable.fromWeb(response.body);
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).end();
    else if (!res.destroyed) res.destroy();
  });
  upstream.pipe(res);
}

export async function serveStream(req, res) {
  const record = getStream(req.params.streamId);
  const tokenText = req.query.t;
  let claims;
  try {
    if (typeof tokenText !== 'string') throw new Error('Missing stream token');
    claims = verifyStreamToken(tokenText);
  } catch {
    return res.status(401).json({ error: 'Stream URL is invalid or expired.' });
  }
  if (!record || record.expiresAt <= Date.now()) {
    return res.status(404).json({ error: 'This stream has expired.' });
  }
  if (claims.streamId !== record.streamId) {
    return res.status(401).json({ error: 'Stream URL is invalid or expired.' });
  }
  if (record.kind === 'drive') {
    try {
      return await serveDriveStream(req, res, record, req.headers.range);
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.message || 'Unable to stream the Drive video.' });
    }
  }

  let stats;
  try {
    stats = fs.statSync(record.filePath);
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    return res.status(404).json({ error: 'Converted video file not found.' });
  }
  const range = parseRange(req.headers.range, stats.size);
  if (range?.invalid) return sendRangeError(res, stats.size);
  const start = range?.start ?? 0;
  const end = range?.end ?? stats.size - 1;
  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', record.mimeType || 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
  res.setHeader('Cache-Control','public, max-age=3600');
  if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
  if (req.method === 'HEAD') return res.end();
  const file = fs.createReadStream(record.filePath, { start, end });
  req.on('aborted', () => file.destroy());
  res.on('close', () => {
    if (!res.writableFinished) file.destroy();
  });
  file.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else if (!res.destroyed) res.destroy();
  });
  file.pipe(res);
}

export function validateStreamTokenForTests(token) {
  return verifyStreamToken(token);
}
