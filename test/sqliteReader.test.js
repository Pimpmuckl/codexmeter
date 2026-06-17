import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
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

test('sqlite reader includes spawn-edge parent ids when available', async () => {
  const fixture = await createTempSmokeCodexHome('codexmeter-sqlite-edges-');

  try {
    const db = new DatabaseSync(path.join(fixture.codexHome, 'state_5.sqlite'));
    try {
      db.exec(`
        CREATE TABLE thread_spawn_edges (
          parent_thread_id TEXT NOT NULL,
          child_thread_id TEXT PRIMARY KEY NOT NULL,
          status TEXT NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
        VALUES (?, ?, ?)
      `).run('ci-smoke-thread-1', 'ci-smoke-thread-2', 'completed');
    } finally {
      db.close();
    }

    const rows = readThreads(fixture.codexHome);
    const parent = rows.find((row) => row.thread_id === 'ci-smoke-thread-1');
    const child = rows.find((row) => row.thread_id === 'ci-smoke-thread-2');

    assert.ok(parent);
    assert.ok(child);
    assert.equal(parent.parent_thread_id, null);
    assert.equal(child.parent_thread_id, 'ci-smoke-thread-1');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
