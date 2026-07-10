import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { createIngestState, runIngest } from '../server/ingest.js';

async function createCodexHomeWithMissingRolloutThread() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmeter-ingest-fallback-'));
  const codexHome = path.join(root, '.codex');
  await fs.mkdir(codexHome, { recursive: true });

  const dbPath = path.join(codexHome, 'state_5.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      agent_nickname TEXT,
      agent_role TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      git_branch TEXT,
      git_origin_url TEXT
    );
  `);

  const startedAt = Math.floor(Date.parse('2026-04-09T21:30:00Z') / 1000);
  const endedAt = Math.floor(Date.parse('2026-04-09T22:30:00Z') / 1000);
  const insert = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at,
      source, model_provider, model, reasoning_effort, cwd, title,
      tokens_used, agent_nickname, agent_role, cli_version, git_branch, git_origin_url
    ) VALUES (
      @id, @rollout_path, @created_at, @updated_at,
      @source, @model_provider, @model, @reasoning_effort, @cwd, @title,
      @tokens_used, @agent_nickname, @agent_role, @cli_version, @git_branch, @git_origin_url
    )
  `);
  const worktreeThread = {
    id: 'fallback-model-thread',
    rollout_path: path.join(codexHome, 'sessions', 'missing-rollout.jsonl'),
    created_at: startedAt,
    updated_at: endedAt,
    source: 'cli',
    model_provider: 'openai',
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    cwd: '\\\\?\\C:\\Users\\test\\.codex\\worktrees\\spp_worktrees\\yayj5j5t',
    title: 'Fallback model session',
    tokens_used: 1_000_000,
    agent_nickname: null,
    agent_role: null,
    cli_version: '0.0.0-test',
    git_branch: 'main',
    git_origin_url: 'https://github.com/Pimpmuckl/nextide-saas-vod-kraken.git',
  };
  insert.run(worktreeThread);
  insert.run({
    ...worktreeThread,
    id: 'renamed-checkout-thread',
    rollout_path: path.join(codexHome, 'sessions', 'missing-checkout-rollout.jsonl'),
    cwd: '\\\\?\\C:\\Code\\local-kraken-clone',
    title: 'Renamed checkout session',
    tokens_used: 0,
  });
  db.close();

  return { root, codexHome };
}

test('ingest preserves SQLite metadata when rollout file is missing', async () => {
  const fixture = await createCodexHomeWithMissingRolloutThread();

  try {
    const state = createIngestState();
    await runIngest(fixture.codexHome, state, { timezone: 'Europe/Berlin' });

    assert.equal(state.partial_ready, true);
    assert.equal(state.aggregates.overview.total.total_tokens, 1_000_000);

    const session = state.sessions.find((row) => row.thread_id === 'fallback-model-thread');
    assert.ok(session);
    assert.equal(session.model_name, 'gpt-5.4');
    assert.equal(session.reasoning_effort, 'medium');
    assert.equal(session.repo_label, 'nextide-saas-vod-kraken');
    assert.equal(session.cost_source, 'heuristic');
    assert.equal(state.sessions.find((row) => row.thread_id === 'renamed-checkout-thread')?.repo_label, 'nextide-saas-vod-kraken');
    assert.equal(state.aggregates.repos.total.length, 1);
    assert.equal(state.aggregates.repos.total[0].repo_key, 'repo:nextide-saas-vod-kraken');

    const byDate = new Map((state.aggregates.daily || []).map((row) => [row.date, row]));
    const apr09 = byDate.get('2026-04-09');
    const apr10 = byDate.get('2026-04-10');

    assert.ok(apr09);
    assert.equal(apr09.by_model.unknown, undefined);

    const dailyRows = [...byDate.values()];
    const totalGpt54Tokens = dailyRows.reduce((sum, row) => sum + (row.by_model['gpt-5.4']?.tokens || 0), 0);
    const totalUnknownTokens = dailyRows.reduce((sum, row) => sum + (row.by_model.unknown?.tokens || 0), 0);

    assert.equal(totalGpt54Tokens, 1_000_000);
    assert.equal(totalUnknownTokens, 0);

    if (apr10) {
      assert.equal(apr10.by_model.unknown, undefined);
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
