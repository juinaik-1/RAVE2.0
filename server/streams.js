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
  const reportedSize = Number(metadata.size || 0);
  const probe = await probeMediaFile('', {
    driveSource: { ownerUserId, fileId, size: reportedSize },
  });
  if (!probe.video) {
    const error = new Error('This Drive file does not contain a video track. Choose a supported video file.');
    error.status = 400;
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
  res.setHeader('Cache-Control', 'private, no-store');
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
  if (claims.streamId !== record.streamId || claims.sub !== record.ownerUserId) {
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
  res.setHeader('Cache-Control', 'private, no-store');
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
