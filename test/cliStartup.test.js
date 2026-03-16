import test from 'node:test';
import assert from 'node:assert/strict';
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
