import { readThreads } from './sqlite-reader.js';
import { randomUUID } from 'crypto';
import {
  normalizeCwd, deriveRepoKey, deriveRepoLabel,
  classifyAgentFamily, isSubagent, normalizeModelName,
} from './normalize.js';
import { calculateCostFromUsage, initPricing, priceSession } from './cost-catalog.js';
import { buildAggregates, buildSessionView } from './aggregator.js';
import { createDayKeyFormatter } from './day-key.js';
import { createLiveAggregateState, createEmptyLivePatch, applySessionToLiveState, buildLiveBootstrap, buildLivePatch } from './live-state.js';
import { createRolloutWorkerPool } from './rollout-worker-pool.js';

const LIVE_FRAME_INTERVAL_MS = 50;
const LIVE_DAYS_PER_SECOND = 6;
const LIVE_OVERVIEW_CADENCE_MS = Math.round(1000 / 10);
const LIVE_DAY_KEYS_PER_EMIT = 1;

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
    presentation_complete_pending: false,
    live_state: null,
    live_seq: 0,
    live_subscribers: new Set(),
    live_pump_timer: null,
    live_pending_patch: createEmptyLivePatch(),
    live_progress_dirty: false,
    live_last_emit_at: 0,
    live_last_overview_emit_at: 0,
  };
}

export async function runIngest(codexHome, state, opts = {}) {
  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toDayKey = createDayKeyFormatter(tz);
  const runToken = state.run_token;
  const isCurrentRun = () => state.run_token === runToken;
  const workerPool = createRolloutWorkerPool({ size: opts.workerThreads });

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
        usage_by_day: null,
        has_usage_by_day: false,
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
    const BATCH_SIZE = opts.batchSize || 40;
    const ROOT_REFRESH_EVERY = opts.rootRefreshEvery || 1000;
    let lastRootRefreshCount = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      if (batch[0]?.started_at) {
        const d = new Date(batch[0].started_at * 1000);
        state.current_date_bucket = d.toLocaleDateString('en-CA', { timeZone: tz });
      }

      const results = await workerPool.mapRollouts(batch.map((session) => session.rollout_path), tz);
      if (!isCurrentRun()) return;

      const workerError = results.find((result) => result?.ok === false);
      if (workerError) {
        throw new Error(`Rollout worker failure: ${workerError.error}`);
      }

      for (let j = 0; j < batch.length; j++) {
        const s = batch[j];
        const data = results[j]?.data || null;
        if (data) {
          if (data.model_name) s.model_name = normalizeModelName(data.model_name);
          if (data.reasoning_effort) s.reasoning_effort = data.reasoning_effort;
          if (data.parent_thread_id) s.parent_thread_id = data.parent_thread_id;
          if (data.usage_total) s.usage_total = data.usage_total;
          if (data.usage_by_day) {
            s.usage_by_day = buildUsageByDayMetrics(s.model_name, data.usage_by_day);
            s.has_usage_by_day = s.usage_by_day.length > 0;
          }
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
    state.percent = 0.99;
    state.phase = 'finalizing';
    state.complete = false;
    state.presentation_complete_pending = true;
    state.current_date_bucket = null;
    queueLiveProgress(state);
    finalizeWithoutSubscribers(state);

  } catch (err) {
    if (!isCurrentRun()) return;
    state.error = err.message;
    state.phase = 'error';
    console.error('Ingest error:', err);
    flushLive(state, 'ingest-error');
  } finally {
    await workerPool.close();
  }
}

export function restartIngest(codexHome, state, opts = {}) {
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
  state.presentation_complete_pending = false;
  state.live_state = null;
  state.live_seq = 0;
  state.live_pending_patch = createEmptyLivePatch();
  state.live_progress_dirty = false;
  state.live_last_emit_at = 0;
  state.live_last_overview_emit_at = 0;

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

function buildUsageByDayMetrics(modelName, usageByDay) {
  const entries = [];
  for (const [dayKey, usage] of Object.entries(usageByDay || {})) {
    const tokens = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
    const cost = calculateCostFromUsage(modelName, usage);
    entries.push({
      day: dayKey,
      tokens,
      cost,
    });
  }
  entries.sort((a, b) => a.day.localeCompare(b.day));
  return entries;
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
  finalizeWithoutSubscribers(state);
}

function finalizeWithoutSubscribers(state) {
  if (state.live_subscribers.size) return;
  if (!state.presentation_complete_pending) return;
  state.phase = 'complete';
  state.percent = 1;
  state.complete = true;
  state.presentation_complete_pending = false;
  state.live_progress_dirty = false;
  state.live_pending_patch = createEmptyLivePatch();
}

function flushLive(state, forcedEvent = null) {
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

  const flushablePatch = forcedEvent ? takeAllPendingPatch(state) : takeFlushablePatch(state);
  const patchEmpty = isPatchEmpty(flushablePatch);
  const pendingPatchEmpty = isPatchEmpty(state.live_pending_patch);
  const shouldEmitComplete = !forcedEvent && patchEmpty && pendingPatchEmpty && state.presentation_complete_pending;
  const event = forcedEvent || (shouldEmitComplete ? 'complete' : (!patchEmpty ? 'patch' : 'progress'));

  if (shouldEmitComplete) {
    state.phase = 'complete';
    state.percent = 1;
    state.complete = true;
    state.presentation_complete_pending = false;
  }

  const payload = {
    ingest_id: state.ingest_id,
    seq: ++state.live_seq,
    progress: progressPayload(state),
  };

  if (event === 'patch') {
    payload.data = buildLivePatch(state.live_state, flushablePatch);
  } else if (event === 'bootstrap') {
    payload.data = buildLiveBootstrap(state.live_state);
  }

  broadcastLive(state, event, payload);
  state.live_last_emit_at = Date.now();
  state.live_progress_dirty = shouldEmitComplete ? false : (event === 'progress' ? false : state.live_progress_dirty);
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

  const overviewDirty =
    state.live_pending_patch.overview.size > 0 ||
    state.live_pending_patch.repos.total.size > 0 || state.live_pending_patch.repos.d7.size > 0 || state.live_pending_patch.repos.d30.size > 0 ||
    state.live_pending_patch.models.total.size > 0 || state.live_pending_patch.models.d7.size > 0 || state.live_pending_patch.models.d30.size > 0 ||
    state.live_pending_patch.families.total.size > 0 || state.live_pending_patch.families.d7.size > 0 || state.live_pending_patch.families.d30.size > 0 ||
    state.live_pending_patch.daily.size > 0 || state.live_pending_patch.heatmap.size > 0;

  if (!overviewDirty || !readyForOverview(state, now)) {
    return sent;
  }

  moveSet(state.live_pending_patch.overview, sent.overview);
  moveRangeSets(state.live_pending_patch.repos, sent.repos);
  moveRangeSets(state.live_pending_patch.models, sent.models);
  moveRangeSets(state.live_pending_patch.families, sent.families);

  const nextDayKeys = takeNextChronologicalDayKeys(
    state.live_pending_patch.daily,
    state.live_pending_patch.heatmap,
    LIVE_DAY_KEYS_PER_EMIT
  );
  moveSpecificKeys(state.live_pending_patch.daily, sent.daily, nextDayKeys);
  moveSpecificKeys(state.live_pending_patch.heatmap, sent.heatmap, nextDayKeys);
  state.live_last_overview_emit_at = now;

  return sent;
}

function readyForOverview(state, now) {
  return (now - state.live_last_overview_emit_at) >= LIVE_OVERVIEW_CADENCE_MS;
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

function takeAllPendingPatch(state) {
  const sent = createEmptyLivePatch();
  moveSet(state.live_pending_patch.overview, sent.overview);
  moveRangeSets(state.live_pending_patch.repos, sent.repos);
  moveRangeSets(state.live_pending_patch.models, sent.models);
  moveRangeSets(state.live_pending_patch.families, sent.families);
  moveSet(state.live_pending_patch.daily, sent.daily);
  moveSet(state.live_pending_patch.heatmap, sent.heatmap);
  return sent;
}

function moveSpecificKeys(from, to, keys) {
  for (const key of keys) {
    if (!from.has(key)) continue;
    from.delete(key);
    to.add(key);
  }
}

function takeNextChronologicalDayKeys(dailySet, heatmapSet, limit) {
  const allKeys = new Set([...dailySet, ...heatmapSet]);
  return [...allKeys]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .slice(0, limit);
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


