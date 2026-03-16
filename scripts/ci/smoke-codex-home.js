import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

export async function createSmokeCodexHome(targetDir) {
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

    const repos = ['nextide-web', 'nextide-api', 'codexmeter'];
    const models = ['gpt-5.4', 'gpt-5.3-codex', 'o3'];
    const roles = ['generic', 'planning', 'review'];
    const rows = Array.from({ length: 36 }, (_, index) => {
      const repo = repos[index % repos.length];
      const model = models[index % models.length];
      const role = roles[index % roles.length];
      const dayOffset = 5 - (index % 6);
      const createdAt = now - (dayOffset * 86400) - (index * 90);
      const durationSeconds = 600 + (index % 5) * 240;
      return {
        id: `ci-smoke-thread-${index + 1}`,
        rollout_path: null,
        created_at: createdAt,
        updated_at: createdAt + durationSeconds,
        source: 'codex-cli',
        model_provider: model,
        cwd: path.join(process.cwd(), repo),
        title: `CI smoke session ${index + 1}`,
        tokens_used: 5000 + (index * 1379),
        agent_nickname: `Smoke ${String.fromCharCode(65 + (index % 26))}`,
        agent_role: role,
        cli_version: 'ci-smoke',
        git_branch: 'main',
        git_origin_url: 'https://github.com/Pimpmuckl/codexmeter',
      };
    });

    for (const row of rows) {
      insert.run(row);
    }
  } finally {
    db.close();
  }

  return dbPath;
}
