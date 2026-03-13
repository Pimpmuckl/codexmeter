import net from 'net';
import { spawn } from 'child_process';
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

console.log(`\n  codexmeter dev -> api ${apiUrl} | web ${webUrl}\n`);

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
    env: process.env,
  }
);

const frontend = spawn(
  process.execPath,
  [
    viteBin,
    '--host', HOST,
    '--port', String(webPort),
    '--strictPort',
    '--open',
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
