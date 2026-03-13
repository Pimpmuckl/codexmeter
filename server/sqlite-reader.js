import { createRequire } from 'module';
import { existsSync } from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

export function readThreads(codexHome, onProgress) {
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite database not found at ${dbPath}`);
  }

  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  try {
    const count = db.prepare('SELECT count(*) as c FROM threads').get().c;
    if (onProgress) onProgress({ total: count, read: 0 });

    const stmt = db.prepare(`
      SELECT
        id, rollout_path, created_at, updated_at,
        source, model_provider, cwd, title,
        tokens_used, agent_nickname, agent_role,
        cli_version, git_branch, git_origin_url
      FROM threads
      ORDER BY created_at DESC
    `);

    const threads = [];
    let read = 0;
    for (const row of stmt.iterate()) {
      threads.push({
        thread_id: row.id,
        rollout_path: row.rollout_path,
        created_at: row.created_at,
        updated_at: row.updated_at,
        source: row.source,
        model_provider: row.model_provider,
        cwd_raw: row.cwd,
        title: row.title ? row.title.slice(0, 200) : '',
        tokens_used: row.tokens_used || 0,
        agent_nickname: row.agent_nickname || null,
        agent_role: row.agent_role || null,
        cli_version: row.cli_version || '',
        git_branch: row.git_branch || null,
      });
      read++;
      if (onProgress && read % 200 === 0) {
        onProgress({ total: count, read });
      }
    }

    if (onProgress) onProgress({ total: count, read });
    return threads;
  } finally {
    db.close();
  }
}
