import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createTempSmokeCodexHome, fetchJson, fetchResponse, spawnCodexmeter, terminateProcessTree, waitForCodexmeterUrl, waitForOk } from '../scripts/ci/smoke-runtime.js';

test('cli boots with --no-open and serves root plus overview api', async () => {
  const fixture = await createTempSmokeCodexHome('codexmeter-cli-');
  const proc = spawnCodexmeter({ codexHome: fixture.codexHome, cwd: process.cwd() });

  try {
    const url = await waitForCodexmeterUrl(proc);
    const rootResponse = await fetchResponse(url);
    assert.equal(rootResponse.statusCode, 200);
    assert.match(rootResponse.contentType, /text\/html/i);

    await waitForOk(`${url}/api/overview`);
    const overview = await fetchJson(`${url}/api/overview`);
    assert.ok(overview?.data?.total);
    assert.ok(overview.data.total.total_sessions > 0);
  } finally {
    await terminateProcessTree(proc);
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('cli rejects malformed date filters before startup', async () => {
  const result = await runCodexmeter(['--no-open', '--from', '2026-02-31']);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--from must be a valid date in YYYY-MM-DD format/);
  assert.doesNotMatch(result.stdout, /codexmeter\s+/i);
});

test('cli rejects reversed date ranges before startup', async () => {
  const result = await runCodexmeter(['--no-open', '--from', '2026-05-02', '--to', '2026-05-01']);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--from must be earlier than or equal to --to/);
  assert.doesNotMatch(result.stdout, /codexmeter\s+/i);
});

function runCodexmeter(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['bin/codexmeter.js', ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`codexmeter did not exit\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 5000);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
