// Remove the files a conversion left behind.
//
//   node server/scripts/cleanup-disk.mjs            keep the age rule (36h)
//   node server/scripts/cleanup-disk.mjs --force    remove every leftover now
//
// A file that a live stream still serves is never removed, and a conversion
// that is running right now keeps its files.
import { ensureDataDirectories } from '../config.js';
import { sweepDisk } from '../cleanup.js';
import { pruneMissingStreamRecords } from '../streams.js';

ensureDataDirectories();

const force = process.argv.includes('--force');
const now = Date.now();
const maxAgeMs = force ? 0 : undefined;

const result = sweepDisk(now, maxAgeMs);
console.log(
  force
    ? `Removed ${result.removed} leftover file(s), ${Math.round(result.bytes / 1024 / 1024)} MB.`
    : `Removed ${result.removed} leftover file(s) older than the age limit, ${Math.round(result.bytes / 1024 / 1024)} MB.`,
);

const pruned = pruneMissingStreamRecords();
console.log(pruned ? 'Removed the stream records whose file no longer exists.' : 'The stream registry is clean.');
