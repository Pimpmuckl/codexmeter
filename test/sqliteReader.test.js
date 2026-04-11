import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { readThreads } from '../server/sqlite-reader.js';
import { createTempSmokeCodexHome } from '../scripts/ci/smoke-runtime.js';

test('sqlite reader opens smoke snapshot and reads thread rows', async () => {
  const fixture = await createTempSmokeCodexHome('codexmeter-sqlite-');

  try {
    const progressEvents = [];
    const rows = readThreads(fixture.codexHome, (progress) => {
      progressEvents.push(progress);
    });

    assert.ok(rows.length >= 30);
    assert.ok(rows.some((row) => row.thread_id === 'ci-smoke-thread-1'));
    assert.ok(rows.some((row) => row.title === 'CI smoke session 1'));
    assert.ok(rows.some((row) => row.agent_role === 'generic'));
    assert.ok(rows.some((row) => row.model_name === 'gpt-5.4'));
    assert.ok(rows.some((row) => row.reasoning_effort === 'medium'));
    assert.ok(progressEvents.length >= 1);
    assert.equal(progressEvents.at(-1)?.total, rows.length);
    assert.equal(progressEvents.at(-1)?.read, rows.length);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
