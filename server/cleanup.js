import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { listReferencedFilePaths, pruneMissingStreamRecords } from './streams.js';
import { listActiveJobIds } from './jobs.js';

// Partial downloads and scratch files. They are never referenced by a
// finished conversion, so an old one is always leftover.
const TEMP_SUFFIXES = ['.part', '.temp', '.tmp'];

// Everything this server writes is named after the job or the stream id.
const MANAGED_FILE_PATTERN = /^[a-f0-9]{32}\./;

// How often the disk is swept.
const SWEEP_INTERVAL_MS = 60 * 60_000;

// Remove the files a conversion left behind.
export function sweepDisk(now = Date.now(), maxAgeMs = config.orphanFileTtlMs) {
  let names = [];
  try {
    names = fs.readdirSync(config.downloadDir);
  } catch {
    return { removed: 0, bytes: 0 };
  }
  const referenced = new Set(listReferencedFilePaths());
  const activeJobIds = listActiveJobIds();
  let removed = 0;
  let bytes = 0;
  for (const name of names) {
    const filePath = path.join(config.downloadDir, name);
    // A conversion that is running right now owns its files.
    if (activeJobIds.some((jobId) => name.startsWith(`${jobId}.`))) continue;
    // A file a live stream serves is never removed.
    if (referenced.has(path.resolve(filePath))) continue;
    const lower = name.toLowerCase();
    const isTemp = TEMP_SUFFIXES.some((suffix) => lower.endsWith(suffix));
    const isManaged = MANAGED_FILE_PATTERN.test(name);
    if (!isTemp && !isManaged) continue;
    let stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (now - stats.mtimeMs <= maxAgeMs) continue;
    try {
      fs.rmSync(filePath, { force: true });
      removed += 1;
      bytes += stats.size;
    } catch {
      // The file is in use or already gone. The next sweep tries again.
    }
  }
  return { removed, bytes };
}

// Sweep the disk on startup and then once an hour.
export function startDiskCleanup() {
  const run = () => {
    try {
      const result = sweepDisk();
      if (result.removed > 0) {
        console.log(
          `Disk cleanup removed ${result.removed} leftover file(s), ${Math.round(result.bytes / 1024 / 1024)} MB.`,
        );
      }
      // Records whose file is gone are clutter and are never served.
      if (pruneMissingStreamRecords()) {
        console.log('Disk cleanup removed stream records whose file no longer exists.');
      }
    } catch (error) {
      console.error('Scheduled disk cleanup failed.', error);
    }
  };
  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
