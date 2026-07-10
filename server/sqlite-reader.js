import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'fs';
import path from 'path';

export function readThreads(codexHome, onProgress) {
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite database not found at ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const count = db.prepare('SELECT count(*) as c FROM threads').get().c;
    if (onProgress) onProgress({ total: count, read: 0 });

    const hasThreadSpawnEdges = db.prepare(
      'SELECT count(*) as c FROM sqlite_master WHERE type = ? AND name = ?'
    ).get('table', 'thread_spawn_edges').c > 0;
    const parentSelect = hasThreadSpawnEdges ? 'e.parent_thread_id' : 'NULL';
    const parentJoin = hasThreadSpawnEdges
      ? 'LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id'
      : '';

    const stmt = db.prepare(`
      SELECT
        t.id, t.rollout_path, t.created_at, t.updated_at,
        t.source, t.model_provider, t.model, t.reasoning_effort, t.cwd, t.title,
        t.tokens_used, t.agent_nickname, t.agent_role,
        t.cli_version, t.git_branch, t.git_origin_url,
        ${parentSelect} AS parent_thread_id
      FROM threads t
      ${parentJoin}
      ORDER BY t.created_at ASC
    `);

    const threads = [];
    let read = 0;
    for (const row of stmt.iterate()) {
      threads.push({
        thread_id: row.id,
        rollout_path: row.rollout_path,
        created_at: row.created_at,
        updated_at: row.updated_at,
        source_raw: row.source,
        model_provider: row.model_provider,
        model_name: row.model || null,
        reasoning_effort: row.reasoning_effort || null,
        cwd_raw: row.cwd,
        title: row.title ? row.title.slice(0, 200) : '',
        tokens_used: row.tokens_used || 0,
        agent_nickname: row.agent_nickname || null,
        agent_role: row.agent_role || null,
        parent_thread_id: row.parent_thread_id || null,
        cli_version: row.cli_version || '',
        git_branch: row.git_branch || null,
        git_origin_url: row.git_origin_url || null,
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
