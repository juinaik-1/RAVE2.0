import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { ensureFreeDiskSpace, isValidJobId, isValidMp4Name, resolveTargetAndBlockPrivateHosts, validateApiKey } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

for (const envPath of [path.resolve(__dirname, '.env'), path.resolve(process.cwd(), '.env')]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const app = express();
const port = Number(process.env.PORT || 3001);
const apiKey = process.env.API_KEY || 'dev-api-key';
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5173,http://localhost:5175,http://localhost:4173').split(',').map((origin) => origin.trim()).filter(Boolean);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const downloadDir = path.resolve(__dirname, process.env.DOWNLOAD_DIR || './downloads');
const maxQueueSize = Number(process.env.MAX_QUEUE_SIZE || 3);
const maxSourceGb = Number(process.env.MAX_SOURCE_GB || 5);
const fileTtlHours = Number(process.env.FILE_TTL_HOURS || 24);

const jobs = new Map();

app.use(express.json({ limit: '10mb' }));

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin) {
        return callback(null, true);
      }

      const isAllowed =
        allowedOrigins.includes(requestOrigin) ||
        requestOrigin.endsWith('.vercel.app') ||
        requestOrigin.startsWith('http://localhost') ||
        requestOrigin.startsWith('https://localhost') ||
        requestOrigin.startsWith('http://127.0.0.1') ||
        requestOrigin.startsWith('https://127.0.0.1');

      if (isAllowed) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many conversion requests. Please wait a moment and try again.',
  },
  skip: (req) => {
    const path = (req.path || '').toLowerCase();
    return path.startsWith('/download') || path.startsWith('/health');
  },
});

app.use('/api/', apiLimiter);

function ensureDownloadDir() {
  fs.mkdirSync(downloadDir, { recursive: true });
}

function normalizeSourceUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('drive.google.com')) {
      const fileId = parsed.searchParams.get('id') || trimmed.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]+)/i)?.[1];
      if (fileId) {
        const directUrl = new URL('https://drive.google.com/uc');
        directUrl.searchParams.set('export', 'download');
        directUrl.searchParams.set('id', fileId);

        const resourceKey = parsed.searchParams.get('resourcekey');
        if (resourceKey) {
          directUrl.searchParams.set('resourcekey', resourceKey);
        }

        return directUrl.toString();
      }
    }
  } catch (_error) {
    // fall back to original string if URL parsing fails
  }

  return trimmed;
}

function sanitizeSourceUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('A source URL is required.');
  }

  const normalized = normalizeSourceUrl(url);
  if (normalized.length > 2048) {
    throw new Error('Source URL is too long.');
  }

  return normalized;
}

async function detectDirectMediaUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const safeUrl = sanitizeSourceUrl(url);
  const lowered = safeUrl.toLowerCase();
  const filenameMatches = /\.(mp4|webm|ogg|m4v|mov|m3u8|m4a)([?#].*)?$/i.test(safeUrl);

  if (filenameMatches || /(?:video\/|mime=video|\.mp4(?:\?|$)|\.webm(?:\?|$)|\.ogg(?:\?|$)|\.mov(?:\?|$)|\.m4v(?:\?|$))/i.test(lowered)) {
    return true;
  }

  const headersToCheck = [];

  try {
    const headResponse = await fetch(safeUrl, {
      method: 'HEAD',
      redirect: 'follow',
    });
    const headType = (headResponse.headers.get('content-type') || '').toLowerCase();
    const contentDisposition = (headResponse.headers.get('content-disposition') || '').toLowerCase();
    headersToCheck.push(headType, contentDisposition);
    if (headType.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|m3u8)/i.test(contentDisposition)) {
      return true;
    }
  } catch (_error) {
    // fall through to a GET probe if HEAD is rejected
  }

  try {
    const getResponse = await fetch(safeUrl, {
      method: 'GET',
      redirect: 'follow',
    });
    const contentType = (getResponse.headers.get('content-type') || '').toLowerCase();
    const contentDisposition = (getResponse.headers.get('content-disposition') || '').toLowerCase();
    headersToCheck.push(contentType, contentDisposition);
    if (contentType.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v|m3u8)/i.test(contentDisposition)) {
      return true;
    }
  } catch (_error) {
    // ignore probe errors and fall back to false
  }

  return false;
}

function createJobId() {
  return crypto.randomBytes(8).toString('hex');
}

function getFileSizeInBytes(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (_error) {
    return 0;
  }
}

function cleanupExpiredJobs() {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    const ttlMs = job.ttlMs || fileTtlHours * 60 * 60 * 1000;
    if (job.completedAt && now - job.completedAt > ttlMs) {
      try {
        if (job.outputPath && fs.existsSync(job.outputPath)) {
          fs.unlinkSync(job.outputPath);
        }
      } catch (_error) {
        // ignore cleanup errors
      }
      jobs.delete(jobId);
    }
  }
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    sourceUrl: job.sourceUrl,
    message: job.message,
    progress: Number(job.progress || 0),
    outputUrl: job.outputUrl || job.url || '',
    url: job.outputUrl || job.url || '',
    fileSize: Number(job.fileSize || 0),
    error: job.error || '',
    audioTracks: job.audioTracks || [],
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

function ensureQueueCapacity() {
  if (jobs.size >= maxQueueSize) {
    const error = new Error('Queue is full. Try again soon.');
    error.statusCode = 429;
    throw error;
  }
}

async function triggerConversion(jobId, sourceUrl, options = {}) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  const maxHeight = options.maxHeight || 'original';
  const audioTrack = Number.isFinite(Number(options.audioTrack)) ? Number(options.audioTrack) : undefined;

  try {
    const safeUrl = sanitizeSourceUrl(sourceUrl);
    const isDirectMedia = await detectDirectMediaUrl(safeUrl);

    if (isDirectMedia) {
      job.status = 'done';
      job.progress = 100;
      job.message = 'Direct media URL accepted';
      job.outputUrl = safeUrl;
      job.url = safeUrl;
      job.fileSize = 0;
      job.completedAt = Date.now();
      return;
    }

    job.status = 'downloading';
    job.message = 'Resolving source and validating access';
    job.progress = 10;

    await resolveTargetAndBlockPrivateHosts(safeUrl);
    ensureFreeDiskSpace(maxSourceGb * 1024 * 1024 * 1024);

    const outputFile = path.join(downloadDir, `${jobId}.mp4`);
    const args = [
      '--no-warnings',
      '--restrict-filenames',
      '--output', outputFile,
      '--merge-output-format', 'mp4',
      '--retries', '2',
      '--fragment-retries', '2',
      '--no-check-certificates',
    ];

    if (maxHeight && maxHeight !== 'original') {
      args.push('--format', `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`);
    }

    if (audioTrack !== undefined && Number.isFinite(audioTrack)) {
      args.push('--extract-audio', '--audio-format', 'mp3');
    }

    args.push(safeUrl);

    job.status = 'converting';
    job.message = 'Downloading and converting video';
    job.progress = 35;

    await new Promise((resolve, reject) => {
      execFile('yt-dlp', args, { timeout: 1000 * 60 * 15 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
          return;
        }
        resolve({ stdout, stderr });
      });
    });

    if (!fs.existsSync(outputFile)) {
      throw new Error('The conversion did not produce a media file.');
    }

    const finalSize = getFileSizeInBytes(outputFile);
    if (finalSize <= 0) {
      throw new Error('The converted file was empty.');
    }

    job.status = 'done';
    job.progress = 100;
    job.message = 'Conversion complete';
    job.outputPath = outputFile;
    job.outputUrl = `${publicBaseUrl}/api/download/${jobId}.mp4`;
    job.url = job.outputUrl;
    job.fileSize = finalSize;
    job.completedAt = Date.now();
  } catch (error) {
    job.status = 'failed';
    job.progress = 100;
    job.message = error.message || 'Conversion failed';
    job.error = error.message || 'Unknown conversion error';
    job.completedAt = Date.now();
  }
}

function createJobFromRequest(req, res) {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!validateApiKey(String(apiKeyHeader || ''), apiKey)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  try {
    ensureQueueCapacity();
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }

  const rawSourceUrl = req.body?.url;
  if (!rawSourceUrl || typeof rawSourceUrl !== 'string') {
    return res.status(400).json({ error: 'url is required.' });
  }

  const sourceUrl = normalizeSourceUrl(rawSourceUrl);
  const maxHeight = req.body?.maxHeight || 'original';
  const audioTrack = req.body?.audioTrack;
  const jobId = createJobId();

  const job = {
    id: jobId,
    status: 'queued',
    createdAt: Date.now(),
    ttlMs: fileTtlHours * 60 * 60 * 1000,
    sourceUrl,
    message: 'Queued for conversion',
    progress: 0,
    outputPath: null,
    outputUrl: '',
    url: '',
    fileSize: 0,
    error: '',
    audioTracks: [],
    options: {
      maxHeight,
      audioTrack,
    },
  };

  jobs.set(jobId, job);
  setImmediate(() => triggerConversion(jobId, sourceUrl, job.options));

  return res.status(202).json({
    id: jobId,
    jobId,
    status: 'queued',
    url: `/api/jobs/${jobId}`,
  });
}

app.post('/api/jobs', createJobFromRequest);
app.post('/api/convert', createJobFromRequest);

app.get('/api/jobs/:jobId', (req, res) => {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!validateApiKey(String(apiKeyHeader || ''), apiKey)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  const jobId = req.params.jobId;
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID.' });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json(serializeJob(job));
});

app.delete('/api/jobs/:jobId', (req, res) => {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!validateApiKey(String(apiKeyHeader || ''), apiKey)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  const jobId = req.params.jobId;
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID.' });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  if (job.outputPath && fs.existsSync(job.outputPath)) {
    fs.unlinkSync(job.outputPath);
  }

  job.status = 'cancelled';
  job.message = 'Conversion cancelled';
  job.progress = 100;
  job.error = '';
  jobs.set(jobId, job);

  return res.json(serializeJob(job));
});

app.get('/api/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  if (!isValidMp4Name(fileName)) {
    return res.status(400).json({ error: 'Invalid file name.' });
  }

  const filePath = path.join(downloadDir, fileName);
  if (!filePath.startsWith(downloadDir)) {
    return res.status(400).json({ error: 'Invalid file location.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const lowerName = fileName.toLowerCase();
  const contentType = lowerName.endsWith('.webm')
    ? 'video/webm'
    : lowerName.endsWith('.ogg')
      ? 'video/ogg'
      : lowerName.endsWith('.mov') || lowerName.endsWith('.m4v')
        ? 'video/quicktime'
        : 'video/mp4';

  return res.sendFile(filePath, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline; filename="converted-video.mp4"',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', jobs: jobs.size });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

ensureDownloadDir();
cleanupExpiredJobs();

function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`Rave conversion server listening on http://localhost:${portToTry}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const nextPort = portToTry + 1;
      console.warn(`Port ${portToTry} is already in use. Retrying on ${nextPort}.`);
      startServer(nextPort);
      return;
    }

    throw error;
  });
}

startServer(port);
