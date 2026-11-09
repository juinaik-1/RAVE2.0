import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 3001;
const VITE_PORT = 5173;

function waitForServer(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.on('error', () => reject(new Error('Server not ready')));
  });
}

function isPortInUse() {
  return new Promise((resolve) => {
    const request = http.get(`http://localhost:${PORT}/api/health`, (response) => {
      response.resume();
      resolve(true);
    });

    request.on('error', () => resolve(false));
  });
}

async function main() {
  const backendAlreadyRunning = await isPortInUse();

  const backend = backendAlreadyRunning
    ? null
    : spawn('node', ['server/server.js'], {
        stdio: 'inherit',
        shell: true,
      });

  const frontend = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', String(VITE_PORT)], {
    stdio: 'inherit',
    shell: true,
  });

  const shutdown = () => {
    if (backend) {
      backend.kill('SIGTERM');
    }
    frontend.kill('SIGTERM');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (!backendAlreadyRunning) {
    try {
      await waitForServer(`http://localhost:${PORT}/api/health`);
    } catch (_error) {
      // backend start is synchronous enough that the process will continue to stream logs
    }
  }

  console.log(`Local app ready: http://localhost:${VITE_PORT}`);
  console.log(`Backend: ${backendAlreadyRunning ? 'existing server' : `http://localhost:${PORT}`}`);
}

main().catch((error) => {
  console.error('Local dev startup failed:', error.message);
  process.exit(1);
});
