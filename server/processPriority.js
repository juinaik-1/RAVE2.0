import { spawnSync } from 'node:child_process';

// FFmpeg takes every core it is given. The API proxies video streams out of
// the same process, so a conversion that saturates the CPU starves Node and
// every viewer in every room starts buffering. The media tools are therefore
// capped on threads and dropped to the lowest scheduler priority, so the
// server keeps answering while a conversion runs.

// The lowest POSIX nice value that a normal user can still start.
const NICE_LEVEL = 15;

// `nice` ships with coreutils. It does not exist on Windows, where the
// backend only runs for local development.
let niceAvailable = null;

function hasNice() {
  if (niceAvailable !== null) return niceAvailable;
  if (process.platform === 'win32') {
    niceAvailable = false;
    return false;
  }
  try {
    const probe = spawnSync('nice', ['--version'], { stdio: 'ignore', timeoutMs: 5000 });
    niceAvailable = probe.status === 0;
  } catch {
    niceAvailable = false;
  }
  return niceAvailable;
}

// Build the command for a low priority media tool.
//
// `nice` forks before it execs the real program, so the child handle is the
// wrapper and not the tool itself. The child is therefore started in its own
// process group, so cancelling the job can signal the whole group and stop
// the real ffmpeg as well.
export function prepareLowPriority(command, args) {
  if (!hasNice()) return { command, args, wrapped: false };
  return {
    command: 'nice',
    args: ['-n', String(NICE_LEVEL), command, ...args],
    wrapped: true,
  };
}

// Spawn options for a low priority child.
export function lowPrioritySpawnOptions(wrapped) {
  return wrapped
    ? { windowsHide: true, detached: true }
    : { windowsHide: true };
}

// Stop a media tool and everything it started.
export function killProcessTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // taskkill is run synchronously so it still finishes when the server is
    // on its way out and the event loop is no longer running.
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      });
    } catch {
      /* the process is already gone */
    }
    return;
  }
  try {
    // A negative pid signals the whole process group. This is what stops the
    // real ffmpeg when it was started through `nice`.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* the process is already gone */
    }
  }
}
