import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fetchJson, fetchResponse, terminateProcessTree, waitForCodexmeterUrl, waitForOk } from './smoke-runtime.js';

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
  const url = await waitForCodexmeterUrl(proc);

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
    console.log(`Smoke OK via ${url}`);
  } finally {
    await terminateProcessTree(proc);
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
      detached: true,
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
