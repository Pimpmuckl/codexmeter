import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';

const repoRoot = process.cwd();
const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmeter-smoke-'));
const codexHome = path.join(smokeRoot, '.codex');
let tarballPath = null;

try {
  await run(process.execPath, ['scripts/ci/create-smoke-codex-home.mjs', codexHome], { cwd: repoRoot });
  const packOutput = await runNpmCapture(['pack', '--json'], { cwd: repoRoot });
  const packEntries = extractPackEntries(packOutput.stdout, packOutput.stderr);
  const tarballName = packEntries?.[0]?.filename;
  if (!tarballName) {
    throw new Error(`Could not resolve tarball from npm pack output:\n${packOutput.stdout}\n${packOutput.stderr}`);
  }
  tarballPath = path.join(repoRoot, tarballName);

  const proc = spawnPackagedCli(tarballName, codexHome, repoRoot);
  let stdout = '';
  let stderr = '';
  let settled = false;

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for codexmeter URL.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 45000);

    const onChunk = (chunk, stream) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      const combined = `${stdout}\n${stderr}`;
      const match = combined.match(/codexmeter\s+\u2192\s+(http:\/\/127\.0\.0\.1:\d+)/i)
        || combined.match(/codexmeter\s+->\s+(http:\/\/127\.0\.0\.1:\d+)/i);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };

    proc.stdout.on('data', (chunk) => onChunk(chunk, 'stdout'));
    proc.stderr.on('data', (chunk) => onChunk(chunk, 'stderr'));
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once('exit', (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      reject(new Error(`codexmeter exited before smoke probe completed (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });

  try {
    const rootResponse = await fetchResponse(url);
    if ((rootResponse.statusCode || 500) >= 400 || !/text\/html/i.test(rootResponse.contentType || '')) {
      throw new Error(`Unexpected root response: status=${rootResponse.statusCode} content-type=${rootResponse.contentType}`);
    }
    await waitForOk(`${url}/api/overview`);
    const overview = await fetchJson(`${url}/api/overview`);
    if (!overview || typeof overview !== 'object' || !('data' in overview)) {
      throw new Error(`Unexpected overview payload: ${JSON.stringify(overview)}`);
    }
    settled = true;
    console.log(`Smoke OK via ${url}`);
  } finally {
    await terminate(proc);
  }
} finally {
  await fs.rm(smokeRoot, { recursive: true, force: true });
  if (tarballPath) {
    await fs.rm(tarballPath, { force: true });
  }
}

function spawnPackagedCli(tarballName, codexHome, cwd) {
  if (process.platform === 'win32') {
    return spawn(
      'cmd.exe',
      ['/d', '/s', '/c', 'npm', 'exec', '--yes', '--package', tarballName, '--', 'codexmeter', '--codex-home', codexHome, '--no-open', '--port', '0'],
      {
        cwd,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  }

  return spawn(
    'npm',
    ['exec', '--yes', '--package', tarballName, '--', 'codexmeter', '--codex-home', codexHome, '--no-open', '--port', '0'],
    {
      cwd,
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

async function run(cmd, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function runAndCapture(cmd, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function runNpmCapture(args, options) {
  if (process.platform === 'win32') {
    return await runAndCapture('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options);
  }
  return await runAndCapture('npm', args, options);
}

function extractPackEntries(stdout, stderr) {
  const trimmed = stdout.trimEnd();
  const match = trimmed.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
  if (!match?.[1]) {
    throw new Error(`Could not find trailing npm pack JSON output:\n${stdout}\n${stderr}`);
  }

  return JSON.parse(match[1]);
}

async function terminate(proc) {
  if (proc.killed) return;
  proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!proc.killed) proc.kill('SIGKILL');
}

async function waitForOk(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = await fetchStatus(url);
      if (status >= 200 && status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fetchJson(url) {
  const body = await fetchBody(url);
  return JSON.parse(body);
}

function fetchResponse(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          contentType: res.headers['content-type'] || '',
          body,
        });
      });
    });
    req.once('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.once('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}

function fetchBody(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.once('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  });
}
