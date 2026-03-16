import { spawn } from 'child_process';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { createSmokeCodexHome } from './smoke-codex-home.js';

export async function createTempSmokeCodexHome(prefix = 'codexmeter-test-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const codexHome = path.join(root, '.codex');
  await createSmokeCodexHome(codexHome);
  return { root, codexHome };
}

export function spawnCodexmeter({ codexHome, cwd, port = '0', extraEnv = {} }) {
  return spawn(
    process.execPath,
    ['bin/codexmeter.js', '--codex-home', codexHome, '--no-open', '--port', String(port)],
    {
      cwd,
      env: { ...process.env, CODEX_HOME: codexHome, ...extraEnv },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

export async function waitForCodexmeterUrl(proc, timeoutMs = 45000) {
  let stdout = '';
  let stderr = '';

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for codexmeter URL.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);

    const onChunk = (chunk, stream) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout += text;
      else stderr += text;
      const combined = `${stdout}\n${stderr}`;
      const match = combined.match(/codexmeter\s+\u2192\s+(http:\/\/127\.0\.0\.1:\d+)/i)
        || combined.match(/codexmeter\s+->\s+(http:\/\/127\.0\.0\.1:\d+)/i);
      if (match?.[1]) {
        clearTimeout(timer);
        cleanup();
        resolve(match[1]);
      }
    };

    const onError = (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    };

    const onExit = (code, signal) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`codexmeter exited before startup completed (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    };

    const cleanup = () => {
      proc.stdout.off('data', onStdout);
      proc.stderr.off('data', onStderr);
      proc.off('error', onError);
      proc.off('exit', onExit);
    };

    const onStdout = (chunk) => onChunk(chunk, 'stdout');
    const onStderr = (chunk) => onChunk(chunk, 'stderr');

    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', onStderr);
    proc.once('error', onError);
    proc.once('exit', onExit);
  });
}

export async function terminateProcessTree(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

  if (process.platform === 'win32') {
    await runCommand('taskkill.exe', ['/pid', String(proc.pid), '/t', '/f']).catch(() => {});
  } else {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {}
    if (!await waitForExit(proc, 1500)) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {}
    }
  }

  await waitForExit(proc, 3000).catch(() => {});
}

export async function fetchJson(url) {
  const body = await fetchBody(url);
  return JSON.parse(body);
}

export async function fetchResponse(url) {
  return await new Promise((resolve, reject) => {
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

export async function waitForOk(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await fetchStatus(url);
      if (status >= 200 && status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
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

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }

    const timer = setTimeout(() => {
      proc.off('exit', onExit);
      resolve(false);
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };

    proc.once('exit', onExit);
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}\n${stdout}\n${stderr}`));
    });
  });
}
