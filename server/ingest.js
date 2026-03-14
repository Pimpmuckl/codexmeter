import { readThreads } from './sqlite-reader.js';
import { enrichFromRollout } from './rollout-reader.js';
import { randomUUID } from 'crypto';
import {
  normalizeCwd, deriveRepoKey, deriveRepoLabel,
  classifyAgentFamily, isSubagent, normalizeModelName,
} from './normalize.js';
import { initPricing, priceSession } from './cost-catalog.js';
import { buildAggregates, buildSessionView } from './aggregator.js';
import { createDayKeyFormatter } from './day-key.js';
import { createLiveAggregateState, createEmptyLivePatch, applySessionToLiveState, buildLiveBootstrap, buildLivePatch } from './live-state.js';

const LIVE_FRAME_INTERVAL_MS = 17;
const LIVE_SURFACE_CADENCE_MS = {
  overview: LIVE_FRAME_INTERVAL_MS,
  rankings: LIVE_FRAME_INTERVAL_MS * 2,
  daily: LIVE_FRAME_INTERVAL_MS * 3,
  heatmap: LIVE_FRAME_INTERVAL_MS * 3,
};

export function createIngestState() {
  return {
    ingest_id: randomUUID(),
    run_token: 0,
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
    live_state: null,
    live_seq: 0,
    live_subscribers: new Set(),
    live_flush_timer: null,
    live_pump_timer: null,
    live_pending_patch: createEmptyLivePatch(),
    live_progress_dirty: false,
    live_last_emit_at: 0,
    live_last_surface_emit_at: { overview: 0, rankings: 0, daily: 0, heatmap: 0 },
  };
}

export async function runIngest(codexHome, state, opts = {}) {
  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toDayKey = createDayKeyFormatter(tz);
  const runToken = state.run_token;
  const isCurrentRun = () => state.run_token === runToken;

  try {
    state.live_state = createLiveAggregateState(tz);
    state.phase = 'inventory';
    state.percent = 0;
    queueLiveProgress(state);
    broadcastBootstrap(state);

    const threads = readThreads(codexHome, ({ total, read }) => {
      if (!isCurrentRun()) return;
      state.total_threads = total;
      state.inventoried = read;
      state.percent = total > 0 ? (read / total) * 0.08 : 0;
      queueLiveProgress(state);
    });
    if (!isCurrentRun()) return;

    state.inventoried = threads.length;
    state.total_threads = threads.length;
    state.percent = 0.08;
    state.phase = 'normalizing';
    queueLiveProgress(state);

    await initPricing();
    if (!isCurrentRun()) return;

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
        usage_total: null,
        active_by_day: null,
        agent_role: t.agent_role,
        agent_nickname: t.agent_nickname,
        agent_family: classifyAgentFamily(t.agent_role),
        is_subagent: isSubagent(t.agent_role),
        parent_thread_id: null,
        cost: null,
        cost_source: 'unavailable',
        materialized: !t.rollout_path,
        title: t.title,
        cli_version: t.cli_version,
      });
    }

    state.phase = 'enrichment';
    queueLiveProgress(state);

    const bootstrapSessions = sessions.filter((session) => !session.rollout_path);
    if (bootstrapSessions.length) {
      assignRootThreadIds(sessions);
      const bootstrapPatch = createEmptyLivePatch();
      for (const session of bootstrapSessions) {
        finalizeSessionMetrics(session, toDayKey);
        applySessionToLiveState(state.live_state, session, bootstrapPatch);
      }
      queueLivePatch(state, bootstrapPatch);
    }

    const candidates = sessions
      .filter(s => s.rollout_path)
      .sort((a, b) => (a.started_at || 0) - (b.started_at || 0));

    state.needs_enrichment = candidates.length;
    state.percent = candidates.length > 0 ? 0.08 : 0.90;
    const BATCH_SIZE = 25;
    const ROOT_REFRESH_EVERY = opts.rootRefreshEvery || 250;
    let lastRootRefreshCount = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      if (batch[0]?.started_at) {
        const d = new Date(batch[0].started_at * 1000);
        state.current_date_bucket = d.toLocaleDateString('en-CA', { timeZone: tz });
      }

      const results = await Promise.all(
        batch.map(s => enrichFromRollout(s.rollout_path, { timezone: tz, toDayKey }).catch(() => null))
      );
      if (!isCurrentRun()) return;

      for (let j = 0; j < batch.length; j++) {
        const s = batch[j];
        const data = results[j];
        if (data) {
          if (data.model_name) s.model_name = normalizeModelName(data.model_name);
          if (data.reasoning_effort) s.reasoning_effort = data.reasoning_effort;
          if (data.parent_thread_id) s.parent_thread_id = data.parent_thread_id;
          if (data.usage_total) s.usage_total = data.usage_total;
          if (data.active_seconds && data.active_seconds > 0) {
            s.elapsed_seconds = data.active_seconds;
            s.active_by_day = data.active_by_day || null;
          }
        }
        finalizeSessionMetrics(s, toDayKey);
        s.materialized = true;
      }

      const shouldRefreshRoots =
        state.enriched === 0 ||
        (state.enriched - lastRootRefreshCount) >= ROOT_REFRESH_EVERY;

      if (shouldRefreshRoots) {
        assignRootThreadIds(sessions);
        lastRootRefreshCount = state.enriched;
      }
      const livePatch = createEmptyLivePatch();
      for (const session of batch) {
        applySessionToLiveState(state.live_state, session, livePatch);
      }
      queueLivePatch(state, livePatch);

      state.enriched = Math.min(i + BATCH_SIZE, candidates.length);
      state.percent = candidates.length > 0
        ? 0.08 + (state.enriched / candidates.length) * 0.82
        : 0.90;
      queueLiveProgress(state);

      if (!isCurrentRun()) return;
    }

    for (const s of sessions) {
      finalizeSessionMetrics(s, toDayKey);
    }

    assignRootThreadIds(sessions);

    state.phase = 'aggregation';
    state.percent = state.needs_enrichment > 0 ? 0.95 : 0.90;
    queueLiveProgress(state);

    rebuildAggregates(sessions, state, opts, tz);
    if (!isCurrentRun()) return;
    state.percent = 1;
    state.phase = 'complete';
    state.complete = true;
    state.current_date_bucket = null;
    queueLiveProgress(state);
    flushLive(state, 'complete');

  } catch (err) {
    if (!isCurrentRun()) return;
    state.error = err.message;
    state.phase = 'error';
    console.error('Ingest error:', err);
    flushLive(state, 'ingest-error');
  }
}

export function restartIngest(codexHome, state, opts = {}) {
  if (state.live_flush_timer) {
    clearTimeout(state.live_flush_timer);
    state.live_flush_timer = null;
  }
  if (state.live_pump_timer) {
    clearInterval(state.live_pump_timer);
    state.live_pump_timer = null;
  }

  state.run_token += 1;
  state.ingest_id = randomUUID();
  state.phase = 'idle';
  state.total_threads = 0;
  state.inventoried = 0;
  state.needs_enrichment = 0;
  state.enriched = 0;
  state.current_date_bucket = null;
  state.percent = 0;
  state.complete = false;
  state.error = null;
  state.sessions = [];
  state.aggregates = null;
  state.generated_at = null;
  state.live_state = null;
  state.live_seq = 0;
  state.live_pending_patch = createEmptyLivePatch();
  state.live_progress_dirty = false;
  state.live_last_emit_at = 0;
  state.live_last_surface_emit_at = { overview: 0, rankings: 0, daily: 0, heatmap: 0 };

  return runIngest(codexHome, state, opts);
}

function rebuildAggregates(sessions, state, opts, tz, mode = {}) {
  const source = mode.partial ? sessions.filter(session => session.materialized) : sessions;
  const filtered = applyFilters(source, opts);
  const sessionView = buildSessionView(filtered, source);
  state.sessions = sessionView;
  state.aggregates = buildAggregates(filtered, tz, sessionView);
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

function finalizeSessionMetrics(session, toDayKey) {
  if (session.elapsed_seconds === null) {
    const fallback = (session.ended_at || 0) - (session.started_at || 0);
    if (fallback > 0 && fallback < 3600) {
      session.elapsed_seconds = fallback;
      if (session.started_at) {
        const dayKey = toDayKey(session.started_at * 1000);
        session.active_by_day = { [dayKey]: fallback };
      }
    }
  }

  if (session.cost === null) {
    const priced = priceSession(session.model_name, {
      totalTokens: session.tokens_used,
      usageBuckets: session.usage_total,
    });
    session.cost = priced.cost;
    session.cost_source = priced.source;
  }
}

function queueLiveProgress(state) {
  state.live_progress_dirty = true;
  ensureLivePump(state);
}

function queueLivePatch(state, patch) {
  mergePatchInto(state.live_pending_patch, patch);
  state.live_progress_dirty = true;
  ensureLivePump(state);
}

function ensureLivePump(state) {
  if (state.live_pump_timer || !state.live_subscribers.size) return;
  state.live_pump_timer = setInterval(() => flushLive(state), LIVE_FRAME_INTERVAL_MS);
}

function stopLivePumpIfIdle(state) {
  if (!state.live_pump_timer) return;
  if (state.live_subscribers.size) return;
  clearInterval(state.live_pump_timer);
  state.live_pump_timer = null;
}

function flushLive(state, forcedEvent = null) {
  if (state.live_flush_timer) {
    clearTimeout(state.live_flush_timer);
    state.live_flush_timer = null;
  }
  if (!state.live_subscribers.size) {
    state.live_pending_patch = createEmptyLivePatch();
    state.live_progress_dirty = false;
    stopLivePumpIfIdle(state);
    return;
  }

  if (!forcedEvent) {
    const now = Date.now();
    const earliestNextEmitAt = state.live_last_emit_at + LIVE_FRAME_INTERVAL_MS;
    if (now < earliestNextEmitAt) {
      return;
    }
  }

  const flushablePatch = forcedEvent ? state.live_pending_patch : takeFlushablePatch(state);
  const patchEmpty = isPatchEmpty(flushablePatch);
  const event = forcedEvent || (!patchEmpty ? 'patch' : 'progress');
  const payload = {
    ingest_id: state.ingest_id,
    seq: ++state.live_seq,
    progress: progressPayload(state),
  };

  if (event === 'patch') {
    payload.data = buildLivePatch(state.live_state, flushablePatch);
  } else if (event === 'complete' || event === 'bootstrap') {
    payload.data = buildLiveBootstrap(state.live_state);
  }

  broadcastLive(state, event, payload);
  state.live_last_emit_at = Date.now();
  state.live_progress_dirty = false;
  if (forcedEvent) {
    state.live_pending_patch = createEmptyLivePatch();
  }
}

function broadcastLive(state, event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of state.live_subscribers) {
    try {
      res.write(data);
    } catch {
      state.live_subscribers.delete(res);
    }
  }
}

function mergePatchInto(target, source) {
  for (const key of source.overview) target.overview.add(key);
  mergeRangePatchSets(target.repos, source.repos);
  mergeRangePatchSets(target.models, source.models);
  mergeRangePatchSets(target.families, source.families);
  for (const key of source.daily) target.daily.add(key);
  for (const key of source.heatmap) target.heatmap.add(key);
}

function mergeRangePatchSets(target, source) {
  for (const rangeKey of ['total', 'd7', 'd30']) {
    for (const key of source[rangeKey]) target[rangeKey].add(key);
  }
}

function isPatchEmpty(patch) {
  return patch.overview.size === 0 &&
    patch.repos.total.size === 0 && patch.repos.d7.size === 0 && patch.repos.d30.size === 0 &&
    patch.models.total.size === 0 && patch.models.d7.size === 0 && patch.models.d30.size === 0 &&
    patch.families.total.size === 0 && patch.families.d7.size === 0 && patch.families.d30.size === 0 &&
    patch.daily.size === 0 &&
    patch.heatmap.size === 0;
}

function takeFlushablePatch(state) {
  const now = Date.now();
  const sent = createEmptyLivePatch();

  if (state.live_pending_patch.overview.size > 0 && readyForSurface(state, 'overview', now)) {
    moveSet(state.live_pending_patch.overview, sent.overview);
    state.live_last_surface_emit_at.overview = now;
  }

  const rankingsDirty =
    state.live_pending_patch.repos.total.size > 0 || state.live_pending_patch.repos.d7.size > 0 || state.live_pending_patch.repos.d30.size > 0 ||
    state.live_pending_patch.models.total.size > 0 || state.live_pending_patch.models.d7.size > 0 || state.live_pending_patch.models.d30.size > 0 ||
    state.live_pending_patch.families.total.size > 0 || state.live_pending_patch.families.d7.size > 0 || state.live_pending_patch.families.d30.size > 0;

  if (rankingsDirty && readyForSurface(state, 'rankings', now)) {
    moveRangeSets(state.live_pending_patch.repos, sent.repos);
    moveRangeSets(state.live_pending_patch.models, sent.models);
    moveRangeSets(state.live_pending_patch.families, sent.families);
    state.live_last_surface_emit_at.rankings = now;
  }

  if (state.live_pending_patch.daily.size > 0 && readyForSurface(state, 'daily', now)) {
    moveSet(state.live_pending_patch.daily, sent.daily);
    state.live_last_surface_emit_at.daily = now;
  }

  if (state.live_pending_patch.heatmap.size > 0 && readyForSurface(state, 'heatmap', now)) {
    moveSet(state.live_pending_patch.heatmap, sent.heatmap);
    state.live_last_surface_emit_at.heatmap = now;
  }

  return sent;
}

function readyForSurface(state, surfaceKey, now) {
  return (now - state.live_last_surface_emit_at[surfaceKey]) >= LIVE_SURFACE_CADENCE_MS[surfaceKey];
}

function moveSet(from, to) {
  for (const value of from) to.add(value);
  from.clear();
}

function moveRangeSets(fromRanges, toRanges) {
  for (const rangeKey of ['total', 'd7', 'd30']) {
    moveSet(fromRanges[rangeKey], toRanges[rangeKey]);
  }
}

function progressPayload(state) {
  return {
    phase: state.phase,
    total_threads: state.total_threads,
    inventoried: state.inventoried,
    needs_enrichment: state.needs_enrichment,
    enriched: state.enriched,
    current_date_bucket: state.current_date_bucket,
    percent: state.percent,
    complete: state.complete,
    error: state.error,
    generated_at: state.generated_at,
  };
}

export function attachLiveSubscriber(state, res) {
  state.live_subscribers.add(res);
  ensureLivePump(state);
  const payload = {
    ingest_id: state.ingest_id,
    seq: ++state.live_seq,
    progress: progressPayload(state),
    data: buildLiveBootstrap(state.live_state || createLiveAggregateState(Intl.DateTimeFormat().resolvedOptions().timeZone)),
  };
  res.write(`event: bootstrap\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function detachLiveSubscriber(state, res) {
  state.live_subscribers.delete(res);
  stopLivePumpIfIdle(state);
}

function broadcastBootstrap(state) {
  if (!state.live_subscribers.size) return;
  const payload = {
    ingest_id: state.ingest_id,
    seq: ++state.live_seq,
    progress: progressPayload(state),
    data: buildLiveBootstrap(state.live_state || createLiveAggregateState(Intl.DateTimeFormat().resolvedOptions().timeZone)),
  };
  broadcastLive(state, 'bootstrap', payload);
}
