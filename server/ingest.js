import { readThreads } from './sqlite-reader.js';
import { enrichFromRollout } from './rollout-reader.js';
import {
  normalizeCwd, deriveRepoKey, deriveRepoLabel,
  classifyAgentFamily, isSubagent, normalizeModelName,
} from './normalize.js';
import { initPricing, estimateCost } from './cost-catalog.js';
import { buildAggregates, buildSessionView } from './aggregator.js';

export function createIngestState() {
  return {
    phase: 'idle',
    total_threads: 0,
    inventoried: 0,
    needs_enrichment: 0,
    enriched: 0,
    current_date_bucket: null,
    percent: 0,
    complete: false,
    error: null,
    sessions: [],
    aggregates: null,
    generated_at: null,
  };
}

export async function runIngest(codexHome, state, opts = {}) {
  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    state.phase = 'inventory';
    state.percent = 0;

    const threads = readThreads(codexHome, ({ total, read }) => {
      state.total_threads = total;
      state.inventoried = read;
      state.percent = (read / total) * 0.2;
    });

    state.inventoried = threads.length;
    state.total_threads = threads.length;
    state.percent = 0.2;
    state.phase = 'normalizing';

    await initPricing();

    const sessions = [];
    for (const t of threads) {
      const nc = normalizeCwd(t.cwd_raw);
      sessions.push({
        thread_id: t.thread_id,
        rollout_path: t.rollout_path,
        cwd_raw: t.cwd_raw,
        repo_key: deriveRepoKey(nc),
        repo_label: deriveRepoLabel(nc),
        started_at: t.created_at,
        ended_at: t.updated_at,
        elapsed_seconds: null,
        tokens_used: t.tokens_used,
        model_provider: t.model_provider,
        model_name: null,
        reasoning_effort: null,
        agent_role: t.agent_role,
        agent_nickname: t.agent_nickname,
        agent_family: classifyAgentFamily(t.agent_role),
        is_subagent: isSubagent(t.agent_role),
        parent_thread_id: null,
        cost: null,
        title: t.title,
        cli_version: t.cli_version,
      });
    }

    state.percent = 0.25;
    state.phase = 'enrichment';

    const candidates = sessions
      .filter(s => s.rollout_path)
      .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));

    state.needs_enrichment = candidates.length;
    const BATCH_SIZE = 25;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      if (batch[0]?.started_at) {
        const d = new Date(batch[0].started_at * 1000);
        state.current_date_bucket = d.toLocaleDateString('en-CA', { timeZone: tz });
      }

      const results = await Promise.all(
        batch.map(s => enrichFromRollout(s.rollout_path).catch(() => null))
      );

      for (let j = 0; j < batch.length; j++) {
        const s = batch[j];
        const data = results[j];
        if (data) {
          if (data.model_name) s.model_name = normalizeModelName(data.model_name);
          if (data.reasoning_effort) s.reasoning_effort = data.reasoning_effort;
          if (data.parent_thread_id) s.parent_thread_id = data.parent_thread_id;

          if (data.first_timestamp && data.last_timestamp) {
            const rolloutDuration = (data.last_timestamp - data.first_timestamp) / 1000;
            if (rolloutDuration > 0 && rolloutDuration < 86400 * 7) {
              s.elapsed_seconds = Math.round(rolloutDuration);
            }
          }
        }
      }

      state.enriched = Math.min(i + BATCH_SIZE, candidates.length);
      state.percent = 0.25 + (state.enriched / candidates.length) * 0.60;

      if (state.enriched % 200 < BATCH_SIZE) {
        assignRootThreadIds(sessions);
        rebuildAggregates(sessions, state, opts, tz);
      }
    }

    for (const s of sessions) {
      if (s.elapsed_seconds === null) {
        const fallback = (s.ended_at || 0) - (s.started_at || 0);
        if (fallback > 0 && fallback < 86400) {
          s.elapsed_seconds = fallback;
        }
      }
      s.cost = estimateCost(s.model_name, s.tokens_used);
    }

    assignRootThreadIds(sessions);

    state.phase = 'aggregation';
    state.percent = 0.92;

    rebuildAggregates(sessions, state, opts, tz);
    state.percent = 1;
    state.phase = 'complete';
    state.complete = true;
    state.current_date_bucket = null;

  } catch (err) {
    state.error = err.message;
    state.phase = 'error';
    console.error('Ingest error:', err);
  }
}

function rebuildAggregates(sessions, state, opts, tz) {
  const filtered = applyFilters(sessions, opts);
  state.sessions = buildSessionView(filtered, sessions);
  state.aggregates = buildAggregates(filtered, tz);
  state.generated_at = new Date().toISOString();
}

function applyFilters(sessions, opts) {
  let result = sessions;
  if (opts.from) {
    const fromTs = new Date(opts.from + 'T00:00:00').getTime() / 1000;
    result = result.filter(s => s.ended_at >= fromTs);
  }
  if (opts.to) {
    const toDate = new Date(opts.to + 'T00:00:00');
    toDate.setDate(toDate.getDate() + 1);
    const toTs = toDate.getTime() / 1000;
    result = result.filter(s => s.started_at < toTs);
  }
  if (opts.repo) {
    const sub = opts.repo.toLowerCase();
    result = result.filter(s => s.repo_label.toLowerCase().includes(sub));
  }
  if (opts.agentFamily) {
    result = result.filter(s => s.agent_family === opts.agentFamily);
  }
  return result;
}

function assignRootThreadIds(sessions) {
  const byId = new Map(sessions.map(session => [session.thread_id, session]));
  const memo = new Map();

  const resolveRoot = (session) => {
    if (!session) return null;
    if (memo.has(session.thread_id)) return memo.get(session.thread_id);

    const trail = [];
    const seen = new Set();
    let current = session;
    let rootId = session.thread_id;

    while (current) {
      trail.push(current.thread_id);
      const parentId = current.parent_thread_id;

      if (!parentId || parentId === current.thread_id || seen.has(parentId)) {
        rootId = current.thread_id;
        break;
      }

      if (memo.has(parentId)) {
        rootId = memo.get(parentId);
        break;
      }

      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        rootId = parentId;
        break;
      }
      current = parent;
    }

    for (const threadId of trail) memo.set(threadId, rootId);
    return rootId;
  };

  for (const session of sessions) {
    session.root_thread_id = resolveRoot(session) || session.thread_id;
  }
}
