import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { getDriveMediaResponse } from './driveOAuth.js';
import { probeMediaFile } from './probe.js';
import { convertPreparedJob } from './convert.js';
import { deleteStream, getStream } from './streams.js';
import {
  createJobId,
  ensureFreeDiskSpace,
  resolveTargetAndBlockPrivateHosts,
  validateUrl,
} from './security.js';

const jobs = new Map();
const queue = [];
const children = new Map();
let activeJobId = null;

function setFailure(job, error) {
  if (job.status === 'cancelled') return;
  job.status = 'failed';
  job.progress = 100;
  job.message = error.message || 'Conversion failed.';
  job.error = job.message;
  job.completedAt = Date.now();
}

function removeJobFiles(jobId) {
  let names;
  try {
    names = fs.readdirSync(config.downloadDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(`${jobId}.`)) {
      const filePath = path.join(config.downloadDir, name);
      try {
        fs.rmSync(filePath, { force: true });
      } catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error.code)) throw error;
        const retry = setTimeout(() => {
          try {
            fs.rmSync(filePath, { force: true });
          } catch (retryError) {
            if (retryError.code !== 'ENOENT') console.error('Unable to remove a cancelled conversion file.');
          }
        }, 2000);
        retry.unref?.();
      }
    }
  }
}

function killChild(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
  } else {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref?.();
  }
}

function runProcess(job, command, args, { timeoutMs, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.set(job.id, child);
    let stdoutRemainder = '';
    let stderrRemainder = '';
    let stderrTail = '';
    let lastActivity = Date.now();
    let finished = false;
    job.touchActivity = () => { lastActivity = Date.now(); };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(stallCheck);
      job.touchActivity = null;
      if (children.get(job.id) === child) children.delete(job.id);
      if (job.status === 'cancelled') {
        const cancelled = new Error('Conversion cancelled.');
        cancelled.cancelled = true;
        reject(cancelled);
      } else if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const parseChunk = (chunk, streamName) => {
      lastActivity = Date.now();
      let buffer = streamName === 'stderr' ? stderrRemainder : stdoutRemainder;
      buffer += chunk.toString();
      if (streamName === 'stderr') {
        stderrTail = (stderrTail + chunk.toString()).slice(-16 * 1024);
      }
      const lines = buffer.split(/\r?\n/);
      const remainder = lines.pop() || '';
      if (streamName === 'stderr') {
        stderrRemainder = remainder;
      } else {
        stdoutRemainder = remainder;
      }
      lines.forEach(onLine);
    };
    child.stdout.on('data', (chunk) => parseChunk(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => parseChunk(chunk, 'stderr'));
    child.once('error', (error) => finish(error.code === 'ENOENT'
      ? new Error(`${command} is not installed or is not available on PATH.`)
      : error));
    child.once('close', (code) => {
      if (stdoutRemainder) onLine(stdoutRemainder);
      if (stderrRemainder) onLine(stderrRemainder);
      if (code === 0) finish();
      else if (command === 'yt-dlp') {
        finish(new Error('The source could not be downloaded. Check the URL and try again.'));
      } else {
        const details = stderrTail
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && line !== 'Conversion failed!')
          .slice(-5)
          .join(' ')
          .slice(0, 900);
        const safeDetails = args
          .filter((argument) => path.isAbsolute(argument))
          .reduce((text, filePath) => text.split(filePath).join('[video file]'), details)
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const message = /no space left on device|disk full/i.test(stderrTail)
          ? 'Conversion ran out of disk space. Free space in DOWNLOAD_DIR and try again.'
          : /cannot allocate memory|out of memory/i.test(stderrTail)
            ? 'The server ran out of memory during conversion. Choose a lower resolution and try again.'
            : safeDetails
              ? `FFmpeg could not create a browser-compatible video. Details: ${safeDetails}`
              : `FFmpeg could not create a browser-compatible video (exit code ${code}).`;
        finish(new Error(message));
      }
    });
    const timeout = setTimeout(() => {
      killChild(child);
      finish(new Error(`${command} timed out.`));
    }, timeoutMs);
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 5 * 60_000) {
        killChild(child);
        finish(new Error(`${command} stopped making progress for five minutes.`));
      }
    }, 15_000);
    job.cancelCurrent = () => killChild(child);
  });
}

function currentSourceFiles(jobId) {
  return fs.readdirSync(config.downloadDir)
    .filter((name) => name.startsWith(`${jobId}.source.`) && !name.endsWith('.part'))
    .map((name) => path.join(config.downloadDir, name));
}

function sourceDownloadBytes(jobId) {
  return fs.readdirSync(config.downloadDir)
    .filter((name) => name.startsWith(`${jobId}.source.`))
    .reduce((sum, name) => {
      try {
        return sum + fs.statSync(path.join(config.downloadDir, name)).size;
      } catch {
        return sum;
      }
    }, 0);
}

async function downloadUrlSource(job) {
  const { url } = job.source;
  validateUrl(url);
  await resolveTargetAndBlockPrivateHosts(url);
  ensureFreeDiskSpace(config.maxSourceBytes * 2, config.downloadDir);
  fs.mkdirSync(config.downloadDir, { recursive: true });
  const proxy = await (await import('./security.js')).startSafeProxy();
  const outputTemplate = path.join(config.downloadDir, `${job.id}.source.%(ext)s`);
  const args = [
    '--proxy', proxy.url,
    '--no-playlist',
    '--restrict-filenames',
    '--no-write-subs',
    '--no-write-auto-subs',
    '--no-write-thumbnail',
    '--no-write-info-json',
    '--quiet',
    '--no-progress',
    '--max-filesize', String(config.maxSourceBytes),
    '--retries', '2',
    '--fragment-retries', '2',
    '--newline',
    '--no-colors',
    '--output', outputTemplate,
    '--',
    url,
  ];
  job.status = 'downloading';
  job.message = 'Downloading source';
  job.progress = 5;
  const byteCheck = setInterval(() => {
    const total = sourceDownloadBytes(job.id);
    job.touchActivity?.();
    if (total > config.maxSourceBytes) {
      job.cancelCurrent?.();
      job.downloadLimitExceeded = true;
    } else {
      job.downloadedBytes = total;
      job.message = `Downloading — ${(total / 1024 ** 2).toFixed(0)} MB`;
      job.progress = Math.min(30, 5 + Math.floor((total / config.maxSourceBytes) * 25));
    }
  }, 500);
  try {
    await runProcess(job, 'yt-dlp', args, {
      timeoutMs: 60 * 60_000,
      onLine: (line) => {
        const percent = /(\d+(?:\.\d+)?)%/.exec(line)?.[1];
        if (percent) {
          job.message = `Downloading — ${Number(percent).toFixed(1)}%`;
          job.progress = Math.min(30, 5 + Math.floor(Number(percent) * 0.25));
        }
      },
    });
  } catch (error) {
    if (job.downloadLimitExceeded && job.status !== 'cancelled') {
      throw new Error(`The source exceeds the ${process.env.MAX_SOURCE_GB || 5} GB download limit.`);
    }
    throw error;
  } finally {
    clearInterval(byteCheck);
    job.cancelCurrent = null;
    await proxy.close();
  }
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  const files = currentSourceFiles(job.id);
  if (files.length !== 1) {
    throw new Error('The downloader did not produce exactly one media file.');
  }
  return files[0];
}

async function downloadDriveSource(job, record) {
  const size = Number(record.size || 0);
  if (size > config.maxSourceBytes) {
    throw new Error(`The source exceeds the ${process.env.MAX_SOURCE_GB || 5} GB download limit.`);
  }
  ensureFreeDiskSpace(size ? size * 2 : config.maxSourceBytes * 2, config.downloadDir);
  const filePath = path.join(config.downloadDir, `${job.id}.source.drive`);
  const controller = new AbortController();
  const response = await getDriveMediaResponse(record.ownerUserId, record.fileId, null, true, 'GET', controller.signal);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(response.status === 403
      ? 'Google Drive denied access to the source file.'
      : response.status === 404
        ? 'The source file no longer exists in Google Drive.'
        : 'Unable to download the Google Drive source.');
  }
  const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
  let lastProgressAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), 60 * 60_000);
  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt > 5 * 60_000) controller.abort();
  }, 15_000);
  job.cancelCurrent = () => {
    controller.abort();
    response.body?.cancel().catch(() => {});
    output.destroy(new Error('Conversion cancelled.'));
  };
  job.status = 'downloading';
  job.message = 'Downloading from Google Drive';
  job.progress = 5;
  try {
    const input = Readable.fromWeb(response.body);
    let bytes = 0;
    input.on('data', (chunk) => {
      job.touchActivity?.();
      bytes += chunk.length;
      lastProgressAt = Date.now();
      if (bytes > config.maxSourceBytes) {
        input.destroy(new Error('The source exceeds the configured download limit.'));
      }
      job.downloadedBytes = bytes;
      if (size > 0) {
        const percent = Math.min(100, Math.floor((bytes / size) * 100));
        job.progress = Math.min(30, 5 + Math.floor(percent * 0.25));
        job.message = `Downloading from Google Drive — ${percent}%`;
      }
    });
    await pipeline(input, output);
  } finally {
    clearTimeout(timeout);
    clearInterval(watchdog);
    job.cancelCurrent = null;
  }
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  if (fs.statSync(filePath).size > config.maxSourceBytes) {
    throw new Error(`The source exceeds the ${process.env.MAX_SOURCE_GB || 5} GB download limit.`);
  }
  return filePath;
}

async function prepareSource(job) {
  fs.mkdirSync(config.downloadDir, { recursive: true });
  const stream = job.source.streamId ? getStream(job.source.streamId) : null;
  const filePath = stream?.kind === 'drive'
    ? await downloadDriveSource(job, stream)
    : job.source.url
      ? await downloadUrlSource(job)
      : (() => { throw new Error('The selected source is unavailable.'); })();
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  job.sourcePath = filePath;
  job.status = 'analyzing';
  job.message = 'Analyzing audio and video tracks';
  job.progress = 35;
  const analysis = await probeMediaFile(filePath, {
    onSpawn: (child) => { job.cancelCurrent = () => child.kill('SIGKILL'); },
  });
  job.cancelCurrent = null;
  if (job.status === 'cancelled') throw Object.assign(new Error('Conversion cancelled.'), { cancelled: true });
  if (!analysis.video) throw new Error('The source does not contain a video track.');
  job.audioTracks = analysis.audioTracks;
  job.duration = analysis.duration;
  job.video = analysis.video;
  job.sourceName = stream?.name || (job.source.url ? new URL(job.source.url).hostname : 'Drive video');
  if (job.requestedOptions) {
    // The options were supplied up front, so the job converts without waiting
    // for the interactive options step.
    const requestedTrack = job.requestedOptions.audioTrack;
    const audioTrack = requestedTrack === undefined || requestedTrack === null
      ? job.audioTracks[0]?.index ?? null
      : job.audioTracks.some((track) => track.index === Number(requestedTrack))
        ? Number(requestedTrack)
        : job.audioTracks[0]?.index ?? null;
    job.conversionOptions = { audioTrack, resolution: job.requestedOptions.resolution || 'original' };
    job.status = 'queued';
    job.message = 'Queued for conversion';
    job.progress = 40;
    return;
  }
  job.status = 'awaiting_options';
  job.message = 'Choose an audio track and resolution to continue';
  job.progress = 40;
}

function enqueue(job) {
  queue.push(job.id);
  processQueue();
}

function processQueue() {
  if (activeJobId || !queue.length) return;
  const id = queue.shift();
  const job = jobs.get(id);
  if (!job || job.status === 'cancelled') {
    processQueue();
    return;
  }
  activeJobId = id;
  (async () => {
    if (!job.sourcePath) await prepareSource(job);
    // A job that already knows its options (either chosen by the user or
    // supplied up front) converts straight away instead of waiting for the
    // interactive options step.
    if (job.conversionOptions) await convertPreparedJob(job, runProcess);
  })().catch((error) => {
    if (error.cancelled || job.status === 'cancelled') {
      job.status = 'cancelled';
      job.message = 'Conversion cancelled';
      job.error = '';
      job.completedAt ||= Date.now();
      return;
    }
    setFailure(job, error);
    if (job.sourcePath) fs.rmSync(job.sourcePath, { force: true });
    if (job.outputFilePath && !job.outputStreamId) fs.rmSync(job.outputFilePath, { force: true });
    removeJobFiles(job.id);
    job.sourcePath = null;
  }).finally(() => {
    activeJobId = null;
    processQueue();
  });
}

function checkQueueCapacity() {
  if (queue.length + (activeJobId ? 1 : 0) >= config.maxQueueSize) {
    const error = new Error('The conversion queue is full. Try again shortly.');
    error.status = 429;
    throw error;
  }
}

export async function createJob(ownerUserId, source, options = {}) {
  if (!source || (typeof source.streamId !== 'string' && typeof source.url !== 'string')) {
    const error = new Error('Choose a registered Drive video or provide a source URL.');
    error.status = 400;
    throw error;
  }
  const resolution = options?.resolution || 'original';
  if (!['original', '720', '1080'].includes(String(resolution))) {
    const error = new Error('Resolution must be original, 720, or 1080.');
    error.status = 400;
    throw error;
  }
  // Only skip the interactive options step when the caller asks for it. The
  // interactive flow still stops at "awaiting_options" so the user can pick an
  // audio track and a resolution.
  const requestedOptions = options?.autoStart
    ? {
      audioTrack: options?.audioTrack === undefined || options?.audioTrack === null
        ? null
        : Number(options.audioTrack),
      resolution: String(resolution),
    }
    : null;
  let normalizedSource;
  if (source.streamId) {
    const record = getStream(source.streamId);
    if (!record || record.ownerUserId !== ownerUserId) {
      const error = new Error('The selected Drive stream is unavailable or not owned by this account.');
      error.status = 404;
      throw error;
    }
    if (record.kind !== 'drive') {
      const error = new Error('Only a registered Drive source can be converted this way.');
      error.status = 400;
      throw error;
    }
    normalizedSource = { streamId: record.streamId };
  } else {
    validateUrl(source.url);
    await resolveTargetAndBlockPrivateHosts(source.url);
    normalizedSource = { url: source.url };
  }

  checkQueueCapacity();
  const id = createJobId();
  const job = {
    id,
    ownerUserId,
    source: normalizedSource,
    sourcePath: null,
    sourceName: '',
    status: 'queued',
    message: 'Queued for conversion',
    progress: 0,
    createdAt: Date.now(),
    completedAt: null,
    error: '',
    audioTracks: [],
    duration: 0,
    video: null,
    conversionOptions: null,
    requestedOptions,
    outputStreamId: null,
    cancelCurrent: null,
  };
  jobs.set(id, job);
  enqueue(job);
  return serializeJob(job);
}

export function requestJobConversion(id, ownerUserId, options) {
  const job = jobs.get(id);
  if (!job || job.ownerUserId !== ownerUserId) {
    const error = new Error('Conversion job not found.');
    error.status = 404;
    throw error;
  }
  if (job.status !== 'awaiting_options') {
    const error = new Error('The job is not ready for conversion options.');
    error.status = 409;
    throw error;
  }
  const audioTrack = options?.audioTrack === undefined || options.audioTrack === null
    ? job.audioTracks[0]?.index ?? null
    : Number(options.audioTrack);
  if (audioTrack !== null && !job.audioTracks.some((track) => track.index === audioTrack)) {
    const error = new Error('Choose an audio track from the analyzed source.');
    error.status = 400;
    throw error;
  }
  const resolution = options?.resolution || 'original';
  if (!['original', '720', '1080'].includes(String(resolution))) {
    const error = new Error('Resolution must be original, 720, or 1080.');
    error.status = 400;
    throw error;
  }
  checkQueueCapacity();
  job.conversionOptions = { audioTrack, resolution: String(resolution) };
  job.status = 'queued';
  job.message = 'Queued for conversion';
  enqueue(job);
  return serializeJob(job);
}

export function getJob(id, ownerUserId) {
  const job = jobs.get(id);
  if (!job || job.ownerUserId !== ownerUserId) return null;
  return serializeJob(job);
}

export function cancelJob(id, ownerUserId) {
  const job = jobs.get(id);
  if (!job || job.ownerUserId !== ownerUserId) return null;
  if (['done', 'failed', 'cancelled'].includes(job.status)) return serializeJob(job);
  job.status = 'cancelled';
  job.message = 'Conversion cancelled';
  job.error = '';
  job.completedAt = Date.now();
  const index = queue.indexOf(id);
  if (index >= 0) queue.splice(index, 1);
  job.cancelCurrent?.();
  const child = children.get(id);
  if (child) killChild(child);
  if (job.sourcePath) fs.rmSync(job.sourcePath, { force: true });
  if (job.outputFilePath && !job.outputStreamId) fs.rmSync(job.outputFilePath, { force: true });
  removeJobFiles(id);
  job.sourcePath = null;
  if (activeJobId !== id) processQueue();
  return serializeJob(job);
}

export function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    progress: Number(job.progress || 0),
    error: job.error,
    audioTracks: job.audioTracks,
    duration: job.duration,
    sourceName: job.sourceName,
    outputStreamId: job.outputStreamId,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

export function cleanupExpiredJobs(now = Date.now()) {
  for (const [id, job] of jobs) {
    const expiredAt = job.completedAt || job.createdAt;
    if (now - expiredAt <= config.fileTtlMs || activeJobId === id || queue.includes(id)) continue;
    if (job.sourcePath) fs.rmSync(job.sourcePath, { force: true });
    if (job.outputStreamId) deleteStream(job.outputStreamId);
    removeJobFiles(id);
    jobs.delete(id);
  }
}
