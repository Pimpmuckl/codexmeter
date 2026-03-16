import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

const targetDir = process.argv[2];

if (!targetDir) {
  console.error('Usage: node scripts/ci/create-smoke-codex-home.mjs <target-dir>');
  process.exit(1);
}

await fs.mkdir(targetDir, { recursive: true });

const dbPath = path.join(targetDir, 'state_5.sqlite');
const db = new Database(dbPath);

try {
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      model_provider TEXT,
      cwd TEXT,
      title TEXT,
      tokens_used INTEGER,
      agent_nickname TEXT,
      agent_role TEXT,
      cli_version TEXT,
      git_branch TEXT,
      git_origin_url TEXT
    );
  `);

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      tokens_used, agent_nickname, agent_role, cli_version, git_branch, git_origin_url
    ) VALUES (
      @id, @rollout_path, @created_at, @updated_at, @source, @model_provider, @cwd, @title,
      @tokens_used, @agent_nickname, @agent_role, @cli_version, @git_branch, @git_origin_url
    )
  `);

  insert.run({
    id: 'ci-smoke-thread-1',
    rollout_path: null,
    created_at: now - 300,
    updated_at: now - 60,
    source: 'codex-cli',
    model_provider: 'openai',
    cwd: process.cwd(),
    title: 'CI smoke session',
    tokens_used: 12345,
    agent_nickname: null,
    agent_role: 'default',
    cli_version: 'ci-smoke',
    git_branch: 'main',
    git_origin_url: 'https://github.com/Pimpmuckl/codexmeter',
  });
} finally {
  db.close();
}

console.log(`Created smoke Codex home at ${targetDir}`);
