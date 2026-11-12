import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { getDriveMediaResponse } from './driveOAuth.js';

// ffprobe only needs the container metadata, which lives near the start of the
// file. Capping the range keeps a probe from downloading the whole source.
const PROBE_WINDOW_BYTES = 8 * 1024 * 1024;
// When the real size is unknown, serve at least this much so a probe can still
// read a file header instead of crawling one byte at a time.
const PROBE_MIN_WINDOW_BYTES = 1024 * 1024;

// Turn a "bytes=start-end" header into an absolute byte range.
// Only the first range of a multi-range request is used; ffprobe falls back to
// separate requests for anything else.
function parseRange(range, size) {
  if (!range) return null;
  const first = String(range).split(',')[0].trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(first);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  const known = Number.isFinite(size) && size > 0;
  if (rawStart === '') {
    // A suffix range: the last N bytes.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    if (!known) return null;
    const start = Math.max(0, size - length);
    return { start, end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return null;
  // Without a known size the end is unknown, so leave it open and let the
  // caller cap it.
  const end = rawEnd === ''
    ? (known ? size - 1 : Number.MAX_SAFE_INTEGER)
    : Math.min(Number(rawEnd), known ? size - 1 : Number(rawEnd));
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

function runFfprobe(input, onSpawn, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt,channels:stream_tags=language,title',
      '-of', 'json',
      input,
    ];
    const child = spawn('ffprobe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 256 * 1024) stderr = stderr.slice(-256 * 1024);
    });
    child.once('error', (error) => {
      finish(error);
    });
    child.once('close', (code) => {
      if (code !== 0) {
        // A file that ffprobe cannot read at all (an archive, a document, an
        // image) is a bad selection, not a server failure. Give it a 400 so
        // the caller can tell the user what went wrong instead of showing a
        // generic error.
        const error = new Error(timedOut
          ? 'Reading the video metadata took too long. Try a smaller file, or convert it from a local copy.'
          : 'This file could not be read as a video. Choose an MP4, MKV, AVI, MOV, or WebM file.');
        error.status = 400;
        // This message is written for the person picking the file, so it is
        // safe to show even though the request failed.
        error.exposeToUser = true;
        // Kept for the server log only; it contains internal URLs.
        error.ffprobeStderr = stderr;
        finish(error);
        return;
      }
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        const error = new Error('ffprobe returned invalid media information.');
        error.status = 400;
        error.exposeToUser = true;
        finish(error);
      }
    });
  });
}

async function probeOverLoopback(filePath, onSpawn) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const size = fs.statSync(filePath).size;
  const server = http.createServer((req, res) => {
    if (req.url !== `/${nonce}`) {
      res.writeHead(404).end();
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1] || 0);
      const end = Math.min(Number(range[2] || size - 1), size - 1);
      if (start >= size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method !== 'HEAD') fs.createReadStream(filePath, { start, end }).pipe(res);
      else res.end();
      return;
    }
    res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': size });
    if (req.method !== 'HEAD') fs.createReadStream(filePath).pipe(res);
    else res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await runFfprobe(`http://127.0.0.1:${server.address().port}/${nonce}`, onSpawn);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function probeDriveOverLoopback(ownerUserId, fileId, size, onSpawn) {
  const nonce = crypto.randomBytes(24).toString('hex');
  // Set when Drive refuses the file (view-only, quota, permission). It is read
  // after the probe finishes so the caller can explain the failure.
  let driveErrorStatus = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url !== `/${nonce}` || !['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(404).end();
      return;
    }

    const range = req.headers.range;
    // ffprobe may ask for several ranges at once. Serving only the first one
    // is valid and it will request the rest separately, so do not reject the
    // request with 416.
    if (range && !/^bytes=/.test(range)) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Accept-Ranges': 'bytes',
        ...(size > 0 ? { 'Content-Length': size } : {}),
      }).end();
      return;
    }

    // ffprobe asks for an open-ended range ("bytes=0-"), which Google Drive
    // satisfies by streaming the whole file. For a multi-gigabyte source that
    // is hundreds of megabytes per probe and it blows past the ffprobe
    // timeout. The container metadata ffprobe needs lives in the first few
    // megabytes, so cap the window and let ffprobe request more if it needs to.
    const requestedRange = parseRange(range, size);
    const windowBytes = size > 0 ? PROBE_WINDOW_BYTES : PROBE_MIN_WINDOW_BYTES;
    const driveRange = requestedRange
      ? `bytes=${requestedRange.start}-${Math.min(requestedRange.end, requestedRange.start + windowBytes - 1)}`
      : null;

    const controller = new AbortController();
    let response;
    try {
      response = await getDriveMediaResponse(
        ownerUserId,
        fileId,
        driveRange,
        true,
        'GET',
        controller.signal,
      );
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end('Google Drive probe request failed.');
      return;
    }
    if (![200, 206, 416].includes(response.status)) {
      await response.body?.cancel();
      driveErrorStatus = response.status;
      if (!res.headersSent) res.writeHead(response.status === 401 ? 401 : 502);
      res.end('Google Drive could not provide media for probing.');
      return;
    }
    // Drive refuses a range request for a file it reports as empty. Fall back
    // to an unranged request, which Drive serves even when the size is unknown.
    if (response.status === 416 && size <= 0) {
      await response.body?.cancel();
      try {
        response = await getDriveMediaResponse(
          ownerUserId,
          fileId,
          null,
          true,
          'GET',
          controller.signal,
        );
      } catch {
        if (!res.headersSent) res.writeHead(502);
        res.end('Google Drive probe request failed.');
        return;
      }
      if (![200, 206].includes(response.status)) {
        await response.body?.cancel();
        // Remember the real status (403 means the file is view-only) so the
        // caller can explain it instead of reporting a generic media failure.
        driveErrorStatus = response.status;
        if (!res.headersSent) res.writeHead(response.status === 401 ? 401 : 502);
        res.end('Google Drive could not provide media for probing.');
        return;
      }
    }

    const headers = {};
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type']) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    if (!headers['accept-ranges']) headers['accept-ranges'] = 'bytes';
    if (!headers['content-length'] && response.status === 200 && size > 0) {
      headers['content-length'] = String(size);
    }
    // When the response is a capped partial, report the true total size so
    // ffprobe knows there is more to read and asks for the next window
    // instead of treating the capped body as the whole file.
    if (response.status === 206 && requestedRange && size > 0) {
      headers['content-range'] = `bytes ${requestedRange.start}-${requestedRange.start + windowBytes - 1 >= size ? size - 1 : requestedRange.start + windowBytes - 1}/${size}`;
    }
    res.writeHead(response.status, headers);
    if (!response.body) {
      res.end();
      return;
    }
    const upstream = Readable.fromWeb(response.body);
    const abortUpstream = () => {
      controller.abort();
      upstream.destroy();
    };
    req.once('aborted', abortUpstream);
    res.once('close', () => {
      if (!res.writableFinished) abortUpstream();
    });
    upstream.once('error', () => {
      if (!res.destroyed) res.destroy();
    });
    upstream.pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const result = await runFfprobe(`http://127.0.0.1:${server.address().port}/${nonce}`, onSpawn);
    return result;
  } catch (probeError) {
    // Drive refused the download. Report that rather than a media failure.
    if (driveErrorStatus === 403) {
      const error = new Error('Google Drive refused to download this file.');
      error.status = 403;
      error.driveStatus = 403;
      throw error;
    }
    if (driveErrorStatus >= 400) {
      const error = new Error(`Google Drive returned ${driveErrorStatus} for this file.`);
      error.status = driveErrorStatus === 401 ? 401 : 502;
      error.driveStatus = driveErrorStatus;
      throw error;
    }
    throw probeError;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export async function probeMediaFile(filePath, options = {}) {
  const result = options.driveSource
    ? await probeDriveOverLoopback(
      options.driveSource.ownerUserId,
      options.driveSource.fileId,
      Number(options.driveSource.size || 0),
      options.onSpawn,
    )
    : await probeOverLoopback(filePath, options.onSpawn);
  const streams = Array.isArray(result.streams) ? result.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video') || null;
  const audioTracks = streams
    .filter((stream) => stream.codec_type === 'audio')
    .map((stream, position) => ({
      index: Number(stream.index),
      position,
      language: stream.tags?.language || 'und',
      title: stream.tags?.title || '',
      codec: stream.codec_name || 'unknown',
      channels: Number(stream.channels || 0),
    }));
  const formats = String(result.format?.format_name || '').toLowerCase().split(',');
  const isBrowserContainer = formats.some((format) => ['mp4', 'mov', 'webm'].includes(format));
  const supportedVideo = video?.codec_name === 'h264'
    ? video.pix_fmt === 'yuv420p'
    : ['vp9', 'av1'].includes(video?.codec_name);
  const supportedAudio = streams
    .filter((stream) => stream.codec_type === 'audio')
    .every((stream) => ['aac', 'mp3', 'opus', 'vorbis'].includes(stream.codec_name));
  let reason = '';
  if (!video) reason = 'No video track was found.';
  else if (video.codec_name === 'hevc' || video.codec_name === 'h265') reason = 'HEVC is not supported by browsers.';
  else if (video.codec_name === 'h264' && video.pix_fmt !== 'yuv420p') reason = 'This H.264 pixel format is not supported by browsers.';
  else if (!supportedVideo) reason = `The ${video.codec_name || 'video'} codec is not supported by browsers.`;
  else if (!isBrowserContainer) reason = 'This container is not supported by browsers.';
  else if (!supportedAudio) reason = 'The audio codec is not supported by browsers.';

  return {
    formatNames: formats,
    duration: Number(result.format?.duration || 0),
    video: video ? {
      index: Number(video.index),
      codec: video.codec_name || 'unknown',
      pixelFormat: video.pix_fmt || '',
    } : null,
    audioTracks,
    playable: Boolean(video && isBrowserContainer && supportedVideo && supportedAudio),
    reason,
  };
}
