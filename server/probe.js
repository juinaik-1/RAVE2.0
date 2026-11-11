import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { getDriveMediaResponse } from './driveOAuth.js';

function runFfprobe(input, onSpawn) {
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
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
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
        finish(new Error('ffprobe could not analyze this media file.'));
        return;
      }
      try {
        finish(null, JSON.parse(stdout));
      } catch {
        finish(new Error('ffprobe returned invalid media information.'));
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
  const server = http.createServer(async (req, res) => {
    if (req.url !== `/${nonce}` || !['GET', 'HEAD'].includes(req.method || '')) {
      res.writeHead(404).end();
      return;
    }

    const range = req.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
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

    const controller = new AbortController();
    let response;
    try {
      response = await getDriveMediaResponse(
        ownerUserId,
        fileId,
        range || null,
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
      if (!res.headersSent) res.writeHead(response.status === 401 ? 401 : 502);
      res.end('Google Drive could not provide media for probing.');
      return;
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
    return await runFfprobe(`http://127.0.0.1:${server.address().port}/${nonce}`, onSpawn);
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
