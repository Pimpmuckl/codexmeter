import net from 'net';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const HOST = '127.0.0.1';
const DEFAULT_API_PORT = parsePort(process.env.CODEXMETER_DEV_API_PORT, 3210);
const DEFAULT_WEB_PORT = parsePort(process.env.CODEXMETER_DEV_WEB_PORT, 5173);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const nodemonBin = path.join(repoRoot, 'node_modules', 'nodemon', 'bin', 'nodemon.js');

const apiPort = await findAvailablePort(DEFAULT_API_PORT);
const webPort = await findAvailablePort(DEFAULT_WEB_PORT, new Set([apiPort]));
const apiUrl = `http://${HOST}:${apiPort}`;
const webUrl = `http://${HOST}:${webPort}`;

console.log(`\n  codexmeter dev -> web ${webUrl}\n  api ${apiUrl}\n`);

const children = [];
let shuttingDown = false;

const backend = spawn(
  process.execPath,
  [
    nodemonBin,
    '--watch', 'server',
    '--watch', 'bin',
    '--ext', 'js',
    '--exec', `node bin/codexmeter.js --port ${apiPort} --no-open`,
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CODEXMETER_DEV_API_ONLY: '1',
      CODEXMETER_FRONTEND_URL: webUrl,
    },
  }
);

await waitForBackendReady(apiUrl);

const frontend = spawn(
  process.execPath,
  [
    viteBin,
    '--host', HOST,
    '--port', String(webPort),
    '--strictPort',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CODEXMETER_API_URL: apiUrl,
    },
  }
);

children.push(backend, frontend);

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`codexmeter dev child exited with ${reason}`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 500).unref();
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function findAvailablePort(startPort, reserved = new Set()) {
  let candidate = startPort;
  while (reserved.has(candidate) || !await isPortAvailable(candidate)) {
    candidate += 1;
  }
  return candidate;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ host: HOST, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForBackendReady(baseUrl) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (shuttingDown) return;
    const ready = await canReach(`${baseUrl}/api/progress`);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for backend readiness at ${baseUrl}`);
}

function canReach(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}
