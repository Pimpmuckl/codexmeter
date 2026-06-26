import { readThreads } from './sqlite-reader.js';
import { randomUUID } from 'crypto';
import {
  normalizeCwd, deriveRepoKey, deriveRepoLabel,
  classifyAgentFamily, deriveAgentRole, isReviewLauncherSession, isSubagent, normalizeModelName,
} from './normalize.js';
import { calculateCostFromUsage, initPricing, priceSession } from './cost-catalog.js';
import { buildAggregates, buildSessionView } from './aggregator.js';
import { createDayKeyFormatter } from './day-key.js';
import { createLiveAggregateState, applySessionToLiveState, buildLiveSnapshot } from './live-state.js';
import { createRolloutWorkerPool } from './rollout-worker-pool.js';
import { beginReplayCapture, createReplayCaptureState, failReplayCapture, getReplaySnapshot, recordReplayEvent, resetReplayCapture } from './export-replay.js';
import { findUsageEntryAtOrBefore, hasUsageTotals, readUsageTimeline, subtractUsageTotals } from './rollout-reader.js';
import { OVERVIEW_INGEST_ANIMATION } from '../src/utils/animationsDefault.js';

const LIVE_FRAME_INTERVAL_MS = Math.max(
  16,
  Math.round(Number(OVERVIEW_INGEST_ANIMATION.live?.frameIntervalMs) || 50)
);
const LIVE_SNAPSHOT_HZ = Math.max(
  1,
  Number(OVERVIEW_INGEST_ANIMATION.live?.snapshotHz) || 10
);
const LIVE_SNAPSHOT_CADENCE_MS = Math.round(1000 / LIVE_SNAPSHOT_HZ);
const ROLLOUT_READER_OPTIONS = { fastScan: true, rgScan: true };
const RESULT_CHUNK_SIZE = 16;
const ROOT_REFRESH_EVERY = 1000;
const FORK_CORRECTION_CONCURRENCY = 32;

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
    partial_ready: false,
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
    live_data_dirty: false,
    live_progress_dirty: false,
    live_last_emit_at: 0,
    live_last_snapshot_emit_at: 0,
    replay_capture: createReplayCaptureState(),
  };
}

export async function runIngest(codexHome, state, opts = {}) {
  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toDayKey = createDayKeyFormatter(tz);
  const runToken = state.run_token;
  const isCurrentRun = () => state.run_token === runToken;
  const workerPool = createRolloutWorkerPool({ readerOptions: ROLLOUT_READER_OPTIONS });

  try {
    state.live_state = createLiveAggregateState(tz);
    state.phase = 'inventory';
    state.percent = 0;
    beginReplayCapture(state.replay_capture, state.ingest_id, {
      ingest_id: state.ingest_id,
      seq: 0,
      progress: progressPayload(state),
      data: buildLiveSnapshot(state.live_state),
    });
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
      const agentRole = deriveAgentRole(t.agent_role, t.source_raw, t.title);
      sessions.push({
        thread_id: t.thread_id,
        rollout_path: t.rollout_path,
        source_raw: t.source_raw,
        cwd_raw: t.cwd_raw,
        repo_key: deriveRepoKey(nc),
        repo_label: deriveRepoLabel(nc),
        started_at: t.created_at,
        ended_at: t.updated_at,
        elapsed_seconds: null,
        tokens_used: t.tokens_used,
        model_provider: t.model_provider,
        model_name: t.model_name ? normalizeModelName(t.model_name) : null,
        reasoning_effort: t.reasoning_effort || null,
        usage_total: null,
        usage_by_day: null,
        has_usage_by_day: false,
        live_sort_ts: null,
        active_by_day: null,
        agent_role: agentRole,
        agent_nickname: t.agent_nickname,
        agent_family: classifyAgentFamily(agentRole),
        is_subagent: isSubagent(agentRole),
        parent_thread_id: t.parent_thread_id || null,
        forked_from_id: null,
        cost: null,
        cost_source: 'unavailable',
        materialized: !t.rollout_path,
        title: t.title,
        cli_version: t.cli_version,
      });
    }

    const sessionById = new Map(sessions.map((session) => [session.thread_id, session]));
    inheritMissingLineageModels(sessions, sessionById);

    state.phase = 'enrichment';
    queueLiveProgress(state);

    publishPartialAggregates(sessions, state, opts, tz, toDayKey);

    const bootstrapCandidates = sessions.filter((session) => !session.rollout_path);
    if (bootstrapCandidates.length) {
      assignRootThreadIds(sessions);
      const bootstrapSessions = filterLiveSessions(bootstrapCandidates, opts);
      for (const session of bootstrapSessions) {
        finalizeSessionMetrics(session, toDayKey);
        applySessionToLiveState(state.live_state, session);
      }
      queueLiveData(state);
    }

    const candidates = selectEnrichmentCandidates(sessions);

    state.needs_enrichment = candidates.length;
    state.percent = candidates.length > 0 ? 0.08 : 0.90;
    const resolveForkUsageSnapshot = createForkUsageSnapshotResolver(sessions);
    let lastRootRefreshCount = 0;
    let enrichedCount = 0;

    const handleEnrichedBatch = async (batch, results) => {
      if (batch[0]?.started_at) {
        const d = new Date(batch[0].started_at * 1000);
        state.current_date_bucket = d.toLocaleDateString('en-CA', { timeZone: tz });
      }

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
          if (data.forked_from_id) s.forked_from_id = data.forked_from_id;
          if (data.usage_total) s.usage_total = data.usage_total;
          if (data.usage_by_day) s._usage_by_day_raw = structuredClone(data.usage_by_day);
          if (data.usage_by_day) {
            s.usage_by_day = buildUsageByDayMetrics(s.model_name, data.usage_by_day);
            s.has_usage_by_day = s.usage_by_day.length > 0;
          }
          if (data.usage_reset_detected) {
            s._usage_reset_detected = true;
          }
          if (data.first_usage_timestamp) {
            s._first_usage_timestamp_ms = data.first_usage_timestamp;
            s.live_sort_ts = Math.floor(data.first_usage_timestamp / 1000);
          }
          if (data.active_seconds && data.active_seconds > 0) {
            s.elapsed_seconds = data.active_seconds;
            s.active_by_day = data.active_by_day || null;
          }
        }
      }

      inheritMissingLineageModels(batch, sessionById);
      await applyForkUsageCorrections(batch, resolveForkUsageSnapshot, FORK_CORRECTION_CONCURRENCY);
      for (const s of batch) {
        if (s._usage_by_day_raw) {
          s.usage_by_day = buildUsageByDayMetrics(s.model_name, s._usage_by_day_raw);
          s.has_usage_by_day = s.usage_by_day.length > 0;
        }
        delete s._usage_by_day_raw;
        delete s._first_usage_timestamp_ms;
        delete s._usage_reset_detected;
        finalizeSessionMetrics(s, toDayKey);
        s.live_sort_day = deriveLiveSortDay(s, toDayKey);
        s.materialized = true;
      }

      enrichedCount = Math.min(enrichedCount + batch.length, candidates.length);
      const shouldRefreshRoots =
        enrichedCount === batch.length ||
        (enrichedCount - lastRootRefreshCount) >= ROOT_REFRESH_EVERY;

      if (shouldRefreshRoots) {
        assignRootThreadIds(sessions);
        lastRootRefreshCount = enrichedCount;
      }
      const liveReady = filterLiveSessions(batch, opts);
      state.current_date_bucket = pickVisibleDateBucket([], liveReady);
      for (const session of liveReady) {
        applySessionToLiveState(state.live_state, session);
      }
      queueLiveData(state);

      state.enriched = enrichedCount;
      state.percent = candidates.length > 0
        ? 0.08 + (state.enriched / candidates.length) * 0.82
        : 0.90;
      queueLiveProgress(state);

    };

    await workerPool.mapRolloutsInChunks(
      candidates.map((session) => session.rollout_path),
      tz,
      {
        chunkSize: RESULT_CHUNK_SIZE,
        onChunk: async (chunk) => {
          const orderedChunk = chunk.slice().sort((a, b) => a.index - b.index);
          const batch = orderedChunk.map(({ index }) => candidates[index]);
          const results = orderedChunk.map(({ result }) => result);
          await handleEnrichedBatch(batch, results);
        },
      }
    );
    if (!isCurrentRun()) return;

    inheritMissingLineageModels(sessions, sessionById);
    for (const s of sessions) {
      finalizeSessionMetrics(s, toDayKey);
    }

    assignRootThreadIds(sessions);
    state.live_state = createLiveAggregateState(tz);
    for (const session of filterLiveSessions(sessions, opts)) {
      applySessionToLiveState(state.live_state, session);
    }
    queueLiveData(state);

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
    failReplayCapture(state.replay_capture);
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
  state.partial_ready = false;
  state.complete = false;
  state.error = null;
  state.sessions = [];
  state.aggregates = null;
  state.generated_at = null;
  state.presentation_complete_pending = false;
  state.live_state = null;
  state.live_seq = 0;
  state.live_data_dirty = false;
  state.live_progress_dirty = false;
  state.live_last_emit_at = 0;
  state.live_last_snapshot_emit_at = 0;
  resetReplayCapture(state.replay_capture);

  return runIngest(codexHome, state, opts);
}

function rebuildAggregates(sessions, state, opts, tz, mode = {}) {
  const source = mode.partial ? sessions.filter(isSafeForPartialAggregation) : sessions;
  const visibleSource = filterVisibleSessions(source);
  const filtered = applyFilters(visibleSource, opts);
  const sessionView = buildSessionView(filtered, source);
  state.sessions = sessionView;
  state.aggregates = buildAggregates(filtered, tz, sessionView, {
    includeUnknownModels: mode.includeUnknownModels !== false,
  });
  state.generated_at = new Date().toISOString();
}

function publishPartialAggregates(sessions, state, opts, tz, toDayKey) {
  const partialSessions = createPartialAggregateSessions(sessions, toDayKey);
  rebuildAggregates(partialSessions, state, opts, tz, {
    includeUnknownModels: false,
  });
  state.partial_ready = true;
  state.percent = Math.max(state.percent, 0.081);
  queueLiveProgress(state);
}

export function createPartialAggregateSessions(sessions, toDayKey) {
  assignRootThreadIds(sessions, toDayKey);
  return sessions
    .filter(isSafeForPartialAggregation)
    .map((session) => {
      const clone = { ...session };
      const isUnparsedRollout = clone.rollout_path && !clone.materialized;
      if (isUnparsedRollout) {
        clone.model_name = null;
        clone.cost = null;
        clone.cost_source = 'unavailable';
        clone.has_usage_by_day = true;
        clone.usage_by_day = [];
      }
      finalizeSessionMetrics(clone, toDayKey);
      if (isUnparsedRollout) {
        clone.cost = null;
        clone.cost_source = 'unavailable';
      }
      return clone;
    });
}

export function isSafeForPartialAggregation(session) {
  if (!session?.rollout_path || session.materialized) return true;
  return !getForkLineageParentThreadId(session);
}

export function filterVisibleSessions(sessions) {
  return sessions.filter((session) => !isReviewLauncherSession(session));
}

function filterLiveSessions(sessions, opts) {
  return applyFilters(filterVisibleSessions(sessions), opts);
}

export function selectEnrichmentCandidates(sessions) {
  return sessions
    .filter((session) => session.rollout_path)
    .sort((a, b) => (a.started_at || 0) - (b.started_at || 0));
}

export function inheritMissingLineageModels(targets, sessionById = new Map(targets.map((session) => [session.thread_id, session]))) {
  const memo = new Map();
  const resolving = new Set();

  const resolveModel = (session) => {
    if (!session) return null;
    if (session.model_name) return session.model_name;
    if (memo.has(session.thread_id)) return memo.get(session.thread_id);
    if (resolving.has(session.thread_id)) return null;

    resolving.add(session.thread_id);
    const parent = sessionById.get(getForkLineageParentThreadId(session));
    const modelName = resolveModel(parent);
    if (modelName && !session.model_name) {
      session.model_name = modelName;
    }
    resolving.delete(session.thread_id);

    memo.set(session.thread_id, session.model_name || null);
    return memo.get(session.thread_id);
  };

  for (const session of targets) {
    resolveModel(session);
  }
}

export function pickVisibleDateBucket(bufferedSessions, liveReadySessions) {
  return bufferedSessions[0]?.live_sort_day || liveReadySessions[0]?.live_sort_day || null;
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

export function assignRootThreadIds(sessions, toDayKey = createDayKeyFormatter(Intl.DateTimeFormat().resolvedOptions().timeZone)) {
  const byId = new Map(sessions.map(session => [session.thread_id, session]));
  const memo = new Map();

  const resolveRoot = (session) => {
    if (!session) return null;
    if (memo.has(session.thread_id)) return memo.get(session.thread_id);

    const trail = [];
    const seen = new Set();
    let current = session;
    let root = {
      id: session.thread_id,
      dayKey: session.started_at ? toDayKey(session.started_at * 1000) : null,
    };

    while (current) {
      trail.push(current.thread_id);
      const parentId = current.parent_thread_id;

      if (!parentId || parentId === current.thread_id || seen.has(parentId)) {
        root = {
          id: current.thread_id,
          dayKey: current.started_at ? toDayKey(current.started_at * 1000) : null,
        };
        break;
      }

      if (memo.has(parentId)) {
        const parentRoot = memo.get(parentId);
        const currentDayKey = current.started_at ? toDayKey(current.started_at * 1000) : null;
        root = parentRoot?.dayKey && currentDayKey === parentRoot.dayKey
          ? parentRoot
          : {
              id: current.thread_id,
              dayKey: currentDayKey,
            };
        break;
      }

      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        root = {
          id: parentId,
          dayKey: current.started_at ? toDayKey(current.started_at * 1000) : null,
        };
        break;
      }

      const parentDayKey = parent.started_at ? toDayKey(parent.started_at * 1000) : null;
      const currentDayKey = current.started_at ? toDayKey(current.started_at * 1000) : null;
      if (currentDayKey && parentDayKey && currentDayKey !== parentDayKey) {
        root = {
          id: current.thread_id,
          dayKey: currentDayKey,
        };
        break;
      }
      current = parent;
    }

    for (const threadId of trail) memo.set(threadId, root);
    return root;
  };

  for (const session of sessions) {
    session.root_thread_id = resolveRoot(session)?.id || session.thread_id;
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

function createForkUsageSnapshotResolver(sessions) {
  const byId = new Map(sessions.map((session) => [session.thread_id, session]));
  const timelineCache = new Map();

  return async function resolveForkUsageSnapshot(parentThreadId, boundary) {
    if (!parentThreadId || !boundary) return null;
    const parent = byId.get(parentThreadId);
    if (!parent?.rollout_path) return null;

    let timelinePromise = timelineCache.get(parentThreadId);
    if (!timelinePromise) {
      timelinePromise = readUsageTimeline(parent.rollout_path, ROLLOUT_READER_OPTIONS);
      timelineCache.set(parentThreadId, timelinePromise);
    }

    const timeline = await timelinePromise;
    return selectForkParentUsageEntry(timeline, boundary)?.usage || null;
  };
}

export function selectForkParentUsageEntry(timeline, {
  startedAtMs = null,
  firstUsageTimestampMs = null,
} = {}) {
  if (!Array.isArray(timeline) || !timeline.length) return null;
  const startEntry = findUsageEntryAtOrBefore(timeline, startedAtMs);
  const firstUsageEntry = findUsageEntryAtOrBefore(timeline, firstUsageTimestampMs);
  if (startEntry && firstUsageEntry && startEntry.segment_id !== firstUsageEntry.segment_id) {
    return startEntry;
  }
  return firstUsageEntry || startEntry || null;
}

async function applyForkUsageCorrections(sessions, resolveForkUsageSnapshot, concurrency = 1) {
  const targets = sessions.filter((session) => {
    const parentThreadId = getForkLineageParentThreadId(session);
    return parentThreadId && !session._usage_reset_detected;
  });
  if (!targets.length) return;

  let index = 0;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), targets.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < targets.length) {
      const session = targets[index++];
      const parentThreadId = getForkLineageParentThreadId(session);
      // Use the child's first observed token snapshot as the primary fork
      // boundary. On the real fork-heavy March chains, this consistently
      // produced better attribution than started_at: the delay from start to
      // first token_count is usually sub-second, while started_at retains
      // slightly more inherited parent usage. We still pass started_at through
      // to the resolver so a parent reset between fork start and first child
      // stream can fall back to the pre-reset parent segment instead of
      // under-subtracting inherited usage. If the child rollout later resets its
      // token counters, we treat the post-reset segment as the authoritative
      // child-only usage and do not subtract the parent again, because that
      // would double-normalize the same inherited baseline and undercount the
      // child.
      const inheritedUsage = await resolveForkUsageSnapshot(parentThreadId, {
        startedAtMs: session.started_at ? session.started_at * 1000 : null,
        firstUsageTimestampMs: session._first_usage_timestamp_ms || null,
      });
      applyForkUsageCorrection(session, inheritedUsage);
    }
  }));
}

export function getForkLineageParentThreadId(session) {
  return session?.forked_from_id || session?.parent_thread_id || null;
}

export function applyForkUsageCorrection(session, inheritedUsage) {
  if (!hasUsageTotals(inheritedUsage)) return false;

  let changed = false;

  if (session?.usage_total) {
    session.usage_total = subtractUsageTotals(session.usage_total, inheritedUsage);
    session.tokens_used = session.usage_total.total_tokens || 0;
    changed = true;
  } else if (typeof session?.tokens_used === 'number') {
    session.tokens_used = Math.max(session.tokens_used - (inheritedUsage.total_tokens || 0), 0);
    changed = true;
  }

  if (session._usage_by_day_raw) {
    session._usage_by_day_raw = subtractUsageFromDayBuckets(session._usage_by_day_raw, inheritedUsage);
    changed = true;
  }

  return changed;
}

function subtractUsageFromDayBuckets(usageByDay, inheritedUsage) {
  const remaining = {
    input_tokens: inheritedUsage?.input_tokens || 0,
    cached_input_tokens: inheritedUsage?.cached_input_tokens || 0,
    output_tokens: inheritedUsage?.output_tokens || 0,
    reasoning_output_tokens: inheritedUsage?.reasoning_output_tokens || 0,
    total_tokens: inheritedUsage?.total_tokens || 0,
  };

  const next = {};
  for (const dayKey of Object.keys(usageByDay || {}).sort()) {
    const current = usageByDay[dayKey] || {};
    const adjusted = subtractUsageTotals({
      input_tokens: current.input_tokens || 0,
      cached_input_tokens: current.cached_input_tokens || 0,
      output_tokens: current.output_tokens || 0,
      total_tokens: (current.input_tokens || 0) + (current.output_tokens || 0),
    }, remaining);

    const consumed = subtractUsageTotals({
      input_tokens: current.input_tokens || 0,
      cached_input_tokens: current.cached_input_tokens || 0,
      output_tokens: current.output_tokens || 0,
      total_tokens: (current.input_tokens || 0) + (current.output_tokens || 0),
    }, adjusted);

    Object.assign(remaining, subtractUsageTotals(remaining, consumed));

    if (adjusted.input_tokens > 0 || adjusted.cached_input_tokens > 0 || adjusted.output_tokens > 0) {
      next[dayKey] = {
        input_tokens: adjusted.input_tokens,
        cached_input_tokens: adjusted.cached_input_tokens,
        output_tokens: adjusted.output_tokens,
      };
    }
  }

  return next;
}

function deriveLiveSortDay(session, toDayKey) {
  if (session.has_usage_by_day && session.usage_by_day?.length) {
    let best = session.usage_by_day[0];
    for (const entry of session.usage_by_day) {
      if ((entry.tokens || 0) > (best.tokens || 0)) {
        best = entry;
        continue;
      }
      if ((entry.tokens || 0) === (best.tokens || 0) && String(entry.day) > String(best.day)) {
        best = entry;
      }
    }
    return best?.day || null;
  }
  if (session.started_at) {
    return toDayKey(session.started_at * 1000);
  }
  return null;
}

function queueLiveProgress(state) {
  state.live_progress_dirty = true;
  ensureLivePump(state);
}

function queueLiveData(state) {
  state.live_data_dirty = true;
  state.live_progress_dirty = true;
  ensureLivePump(state);
}

function ensureLivePump(state) {
  if (state.live_pump_timer) return;
  if (!state.live_subscribers.size && !state.replay_capture.active) return;
  state.live_pump_timer = setInterval(() => flushLive(state), LIVE_FRAME_INTERVAL_MS);
}

function stopLivePumpIfIdle(state) {
  if (!state.live_pump_timer) return;
  if (state.live_subscribers.size || state.replay_capture.active) return;
  clearInterval(state.live_pump_timer);
  state.live_pump_timer = null;
  finalizeWithoutSubscribers(state);
}

function finalizeWithoutSubscribers(state) {
  if (state.live_subscribers.size) return;
  if (state.replay_capture.active) return;
  if (!state.presentation_complete_pending) return;
  state.phase = 'complete';
  state.percent = 1;
  state.complete = true;
  state.presentation_complete_pending = false;
  state.live_progress_dirty = false;
  state.live_data_dirty = false;
}

function flushLive(state, forcedEvent = null) {
  if (!state.live_subscribers.size && !state.replay_capture.active) {
    state.live_data_dirty = false;
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

  const readyForSnapshot = forcedEvent || (state.live_data_dirty && readyForSnapshotEmit(state, Date.now()));
  if (!forcedEvent && !readyForSnapshot && !state.live_progress_dirty && !state.presentation_complete_pending) {
    return;
  }

  const shouldEmitComplete = !forcedEvent && state.presentation_complete_pending;
  const event = forcedEvent || (shouldEmitComplete ? 'complete' : (readyForSnapshot ? 'snapshot' : 'progress'));

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

  if (event === 'snapshot' || event === 'complete') {
    payload.data = buildLiveSnapshot(state.live_state);
  }

  recordReplayEvent(state.replay_capture, event, payload);
  if (state.live_subscribers.size) {
    broadcastLive(state, event, payload);
  }
  state.live_last_emit_at = Date.now();
  if (event === 'snapshot' || event === 'complete') {
    state.live_last_snapshot_emit_at = state.live_last_emit_at;
  }
  state.live_progress_dirty = event === 'progress' || event === 'snapshot' || event === 'complete'
    ? false
    : state.live_progress_dirty;
  if (event === 'snapshot' || event === 'complete' || forcedEvent) {
    state.live_data_dirty = false;
  }
  stopLivePumpIfIdle(state);
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

function readyForSnapshotEmit(state, now) {
  return (now - state.live_last_snapshot_emit_at) >= LIVE_SNAPSHOT_CADENCE_MS;
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
    partial_ready: state.partial_ready,
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
    data: buildLiveSnapshot(state.live_state || createLiveAggregateState(Intl.DateTimeFormat().resolvedOptions().timeZone)),
  };
  res.write(`event: bootstrap\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function detachLiveSubscriber(state, res) {
  state.live_subscribers.delete(res);
  stopLivePumpIfIdle(state);
}

export function getLatestReplay(state) {
  return getReplaySnapshot(state.replay_capture);
}

function broadcastBootstrap(state) {
  if (!state.live_subscribers.size) return;
  const payload = {
    ingest_id: state.ingest_id,
    seq: ++state.live_seq,
    progress: progressPayload(state),
    data: buildLiveSnapshot(state.live_state || createLiveAggregateState(Intl.DateTimeFormat().resolvedOptions().timeZone)),
  };
  broadcastLive(state, 'bootstrap', payload);
}
