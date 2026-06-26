import { CACHE_ASSUMPTIONS } from './cost-catalog.js';
import { createDayKeyFormatter, splitIntervalByDay } from './day-key.js';

function normalizeEffortKey(effort) {
  if (!effort) return 'unknown';
  const k = String(effort).toLowerCase().trim().replace(/-/g, '');
  if (k === 'low') return 'low';
  if (k === 'medium') return 'medium';
  if (k === 'high') return 'high';
  if (k === 'xhigh') return 'xhigh';
  return k || 'unknown';
}

export function createLiveAggregateState(tz) {
  const now = Date.now() / 1000;
  return {
    tz,
    lowerBounds: {
      total: 0,
      d7: now - 7 * 86400,
      d30: now - 30 * 86400,
    },
    overview: {
      total: createOverviewBucket(),
      d7: createOverviewBucket(),
      d30: createOverviewBucket(),
    },
    repos: {
      total: new Map(),
      d7: new Map(),
      d30: new Map(),
    },
    repoTopKeys: createTopKeyRanges(),
    models: {
      total: new Map(),
      d7: new Map(),
      d30: new Map(),
    },
    modelTopKeys: createTopKeyRanges(),
    families: {
      total: new Map(),
      d7: new Map(),
      d30: new Map(),
    },
    familyTopKeys: createTopKeyRanges(),
    daily: new Map(),
    heatmap: new Map(),
    toDayKey: createDayKeyFormatter(tz),
  };
}

export function applySessionToLiveState(live, session) {
  const rootId = session.root_thread_id || session.thread_id;

  for (const rangeKey of ['total', 'd7', 'd30']) {
    if (!overlapsLowerBound(session, live.lowerBounds[rangeKey])) continue;

    applyOverviewBucket(live.overview[rangeKey], session, rootId);
    applyRepoBucket(live.repos[rangeKey], live.repoTopKeys[rangeKey], session);
    applyModelBucket(live.models[rangeKey], live.modelTopKeys[rangeKey], session);
    applyFamilyBucket(live.families[rangeKey], live.familyTopKeys[rangeKey], session);
  }

  applyDailyBucket(live.daily, session, live.tz, live.toDayKey);
  applyHeatmapBucket(live.heatmap, session, live.tz, live.toDayKey);
}

export function buildLiveBootstrap(live) {
  return {
    overview: serializeOverview(live),
    repos: serializeTopRanges(live.repos, live.repoTopKeys, serializeRepoSummary),
    models: serializeTopRanges(live.models, live.modelTopKeys, serializeModelSummary),
    families: serializeTopRanges(live.families, live.familyTopKeys, serializeFamilySummary),
    daily: serializeDaily(live.daily),
    heatmap: serializeHeatmap(live.heatmap),
  };
}

export function buildLiveSnapshot(live) {
  return {
    overview: serializeOverview(live),
    repos: serializeTopRanges(live.repos, live.repoTopKeys, serializeRepoSummary),
    models: serializeTopRanges(live.models, live.modelTopKeys, serializeModelSummary),
    families: serializeTopRanges(live.families, live.familyTopKeys, serializeFamilySummary),
    daily: serializeDailySnapshot(live.daily),
    heatmap: serializeHeatmap(live.heatmap),
  };
}

function createTopKeyRanges() {
  return {
    total: [],
    d7: [],
    d30: [],
  };
}

function createOverviewBucket() {
  return {
    total_tokens: 0,
    total_cost: 0,
    total_elapsed_seconds: 0,
    thread_rows: 0,
    rootIds: new Set(),
    repoSet: new Set(),
    modelSet: new Set(),
    enriched: 0,
    priced: 0,
    priced_exact: 0,
    priced_fallback: 0,
    unpriced: 0,
    time_valid: 0,
    earliest: Infinity,
    latest: -Infinity,
  };
}

function applyOverviewBucket(bucket, session, rootId) {
  bucket.total_tokens += session.tokens_used || 0;
  bucket.total_cost += session.cost || 0;
  bucket.total_elapsed_seconds += session.elapsed_seconds || 0;
  bucket.thread_rows += 1;
  bucket.rootIds.add(rootId);
  bucket.repoSet.add(session.repo_label || 'unknown');
  if (session.model_name) {
    bucket.modelSet.add(session.model_name);
    bucket.enriched += 1;
  }
  if (session.cost !== null) {
    bucket.priced += 1;
    if (session.cost_source === 'exact') bucket.priced_exact += 1;
    if (session.cost_source === 'heuristic') bucket.priced_fallback += 1;
  } else {
    bucket.unpriced += 1;
  }
  if (session.elapsed_seconds != null && session.elapsed_seconds > 0) bucket.time_valid += 1;
  if (session.started_at && session.started_at < bucket.earliest) bucket.earliest = session.started_at;
  if (session.ended_at && session.ended_at > bucket.latest) bucket.latest = session.ended_at;
}

function applyRepoBucket(repoMap, topKeys, session) {
  const key = session.repo_label || 'unknown';
  if (!repoMap.has(key)) {
    repoMap.set(key, {
      repo_key: session.repo_key,
      repo_label: key,
      tokens: 0,
      cost: 0,
      cost_known: 0,
      exact_priced: 0,
      heuristic_priced: 0,
      sessions: 0,
      by_model: {},
      by_family: {},
    });
  }
  const repo = repoMap.get(key);
  repo.tokens += session.tokens_used || 0;
  repo.sessions += 1;
  if (session.cost !== null) {
    repo.cost += session.cost;
    repo.cost_known += 1;
    if (session.cost_source === 'exact') repo.exact_priced += 1;
    if (session.cost_source === 'heuristic') repo.heuristic_priced += 1;
  }
  addBreakdown(repo.by_model, session.model_name || 'unknown', session);
  addBreakdown(repo.by_family, session.agent_family || 'generic', session);

  updateTopKeys(repoMap, topKeys, key);
}

function applyModelBucket(modelMap, topKeys, session) {
  const key = session.model_name || 'unknown';
  if (!modelMap.has(key)) {
    modelMap.set(key, { model_name: key, tokens: 0, cost: 0, cost_known: 0, exact_priced: 0, heuristic_priced: 0, sessions: 0, by_effort: {} });
  }
  const model = modelMap.get(key);
  model.tokens += session.tokens_used || 0;
  model.sessions += 1;
  if (session.cost !== null) {
    model.cost += session.cost;
    model.cost_known += 1;
    if (session.cost_source === 'exact') model.exact_priced += 1;
    if (session.cost_source === 'heuristic') model.heuristic_priced += 1;
  }
  addBreakdown(model.by_effort, normalizeEffortKey(session.reasoning_effort), session);

  updateTopKeys(modelMap, topKeys, key);
}

function addBreakdown(target, key, session) {
  if (!target[key]) target[key] = { tokens: 0, cost: 0, sessions: 0, exact_priced: 0, heuristic_priced: 0 };
  const bucket = target[key];
  bucket.tokens += session.tokens_used || 0;
  bucket.sessions += 1;
  if (session.cost !== null) {
    bucket.cost += session.cost;
    if (session.cost_source === 'exact') bucket.exact_priced += 1;
    if (session.cost_source === 'heuristic') bucket.heuristic_priced += 1;
  }
}

function applyFamilyBucket(familyMap, topKeys, session) {
  const key = session.agent_family || 'generic';
  if (!familyMap.has(key)) {
    familyMap.set(key, { family: key, tokens: 0, cost: 0, exact_priced: 0, heuristic_priced: 0, sessions: 0 });
  }
  const family = familyMap.get(key);
  family.tokens += session.tokens_used || 0;
  family.sessions += 1;
  if (session.cost !== null) {
    family.cost += session.cost;
    if (session.cost_source === 'exact') family.exact_priced += 1;
    if (session.cost_source === 'heuristic') family.heuristic_priced += 1;
  }
  updateTopKeys(familyMap, topKeys, key);
}

function applyDailyBucket(dayMap, session, tz, toDayKey) {
  if (!session.started_at || !session.ended_at) return;

  const startMs = session.started_at * 1000;
  const endMs = session.ended_at * 1000;
  const totalDur = endMs - startMs;
  if (totalDur > 0) {
    if (session.has_usage_by_day) {
      addSessionPresence(dayMap, startMs, endMs, totalDur, tz, session);
      addUsageByDay(dayMap, session);
    } else {
      for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
        addToDay(dayMap, dayKey, session, overlapMs / totalDur);
      }
    }
  }

  if (session.active_by_day) {
    for (const [dayKey, seconds] of Object.entries(session.active_by_day)) {
      addElapsedToDay(dayMap, dayKey, session, seconds || 0);
    }
  }
}

function applyHeatmapBucket(dayMap, session, tz, toDayKey) {
  const startMs = session.started_at ? session.started_at * 1000 : null;
  const endMs = (session.ended_at || session.started_at) ? (session.ended_at || session.started_at) * 1000 : null;
  const totalDur = endMs - startMs;

  if (session.has_usage_by_day) {
    for (const usageDay of session.usage_by_day || []) {
      const dayKey = usageDay.day;
      const day = ensureHeatmapDay(dayMap, dayKey);
      day.tokens += usageDay.tokens || 0;
      if (usageDay.cost !== null) day.cost += usageDay.cost;
    }
    if (startMs !== null) {
      if (totalDur > 0) {
        for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
          const day = ensureHeatmapDay(dayMap, dayKey);
          if ((overlapMs / totalDur) > 0.001) day.sessions += 1;
        }
      } else {
        const startDay = toDayKey(startMs);
        const day = ensureHeatmapDay(dayMap, startDay);
        day.sessions += 1;
      }
    }
  } else if (startMs !== null) {
    if (totalDur > 0) {
      for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
        const fraction = overlapMs / totalDur;
        const day = ensureHeatmapDay(dayMap, dayKey);
        day.tokens += (session.tokens_used || 0) * fraction;
        if (session.cost !== null) day.cost += session.cost * fraction;
        if (fraction > 0.001) day.sessions += 1;
      }
    } else {
      const dayKey = toDayKey(startMs);
      const day = ensureHeatmapDay(dayMap, dayKey);
      day.tokens += session.tokens_used || 0;
      if (session.cost !== null) day.cost += session.cost;
      day.sessions += 1;
    }
  }

  if (session.active_by_day) {
    for (const [dayKey, seconds] of Object.entries(session.active_by_day)) {
      const day = ensureHeatmapDay(dayMap, dayKey);
      day.elapsed += seconds || 0;
    }
  }
}

function addSessionPresence(dayMap, startMs, endMs, totalDur, tz, session) {
  for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
    addPresenceToDay(dayMap, dayKey, session, overlapMs / totalDur);
  }
}

function addPresenceToDay(dayMap, dayKey, session, fraction) {
  const day = ensureDay(dayMap, dayKey);
  if (fraction > 0.001) day.sessions += 1;

  const familyKey = session.agent_family || 'generic';
  if (!day.by_family[familyKey]) day.by_family[familyKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  if (fraction > 0.001) day.by_family[familyKey].sessions += 1;

  const repoKey = session.repo_label || 'unknown';
  if (!day.by_repo[repoKey]) day.by_repo[repoKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  if (fraction > 0.001) day.by_repo[repoKey].sessions += 1;
}

function addUsageByDay(dayMap, session) {
  for (const usageDay of session.usage_by_day || []) {
    const dayKey = usageDay.day;
    const day = ensureDay(dayMap, dayKey);
    day.tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) day.cost += usageDay.cost;

    const modelKey = session.model_name || 'unknown';
    if (!day.by_model[modelKey]) day.by_model[modelKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
    day.by_model[modelKey].tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) day.by_model[modelKey].cost += usageDay.cost;

    const familyKey = session.agent_family || 'generic';
    if (!day.by_family[familyKey]) day.by_family[familyKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
    day.by_family[familyKey].tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) day.by_family[familyKey].cost += usageDay.cost;

    const repoKey = session.repo_label || 'unknown';
    if (!day.by_repo[repoKey]) day.by_repo[repoKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
    day.by_repo[repoKey].tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) day.by_repo[repoKey].cost += usageDay.cost;
  }
}

function addToDay(dayMap, dayKey, session, fraction) {
  const day = ensureDay(dayMap, dayKey);
  day.tokens += (session.tokens_used || 0) * fraction;
  if (session.cost !== null) day.cost += session.cost * fraction;
  if (fraction > 0.001) day.sessions += 1;

  const modelKey = session.model_name || 'unknown';
  if (!day.by_model[modelKey]) day.by_model[modelKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
  day.by_model[modelKey].tokens += (session.tokens_used || 0) * fraction;
  if (session.cost !== null) day.by_model[modelKey].cost += session.cost * fraction;

  const familyKey = session.agent_family || 'generic';
  if (!day.by_family[familyKey]) day.by_family[familyKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  day.by_family[familyKey].tokens += (session.tokens_used || 0) * fraction;
  if (session.cost !== null) day.by_family[familyKey].cost += session.cost * fraction;
  if (fraction > 0.001) day.by_family[familyKey].sessions += 1;

  const repoKey = session.repo_label || 'unknown';
  if (!day.by_repo[repoKey]) day.by_repo[repoKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  day.by_repo[repoKey].tokens += (session.tokens_used || 0) * fraction;
  if (session.cost !== null) day.by_repo[repoKey].cost += session.cost * fraction;
  if (fraction > 0.001) day.by_repo[repoKey].sessions += 1;
}

function ensureDay(dayMap, dayKey) {
  if (!dayMap.has(dayKey)) {
    dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {}, by_repo: {} });
  }
  return dayMap.get(dayKey);
}

function addElapsedToDay(dayMap, dayKey, session, seconds) {
  if (!seconds) return;
  const day = ensureDay(dayMap, dayKey);
  day.elapsed_seconds += seconds;

  const modelKey = session.model_name || 'unknown';
  if (!day.by_model[modelKey]) day.by_model[modelKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
  day.by_model[modelKey].elapsed_seconds += seconds;

  const familyKey = session.agent_family || 'generic';
  if (!day.by_family[familyKey]) day.by_family[familyKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  day.by_family[familyKey].elapsed_seconds += seconds;

  const repoKey = session.repo_label || 'unknown';
  if (!day.by_repo[repoKey]) day.by_repo[repoKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  day.by_repo[repoKey].elapsed_seconds += seconds;
}

function ensureHeatmapDay(dayMap, dayKey) {
  if (!dayMap.has(dayKey)) {
    dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
  }
  return dayMap.get(dayKey);
}

function serializeOverview(live) {
  return {
    total: serializeOverviewBucket(live.overview.total, live.lowerBounds.total),
    d7: serializeOverviewBucket(live.overview.d7, live.lowerBounds.d7),
    d30: serializeOverviewBucket(live.overview.d30, live.lowerBounds.d30),
    cost_assumptions: CACHE_ASSUMPTIONS,
  };
}

function serializeOverviewBucket(bucket, lowerBound = 0) {
  const boundedFrom = bucket.earliest === Infinity
    ? null
    : Math.max(bucket.earliest, lowerBound || 0);
  return {
    total_tokens: bucket.total_tokens,
    total_cost: bucket.total_cost,
    total_sessions: bucket.rootIds.size,
    active_repos: bucket.repoSet.size,
    active_models: bucket.modelSet.size,
    total_elapsed_seconds: bucket.total_elapsed_seconds,
    date_range: {
      from: boundedFrom,
      to: bucket.latest === -Infinity ? null : bucket.latest,
    },
    coverage: {
      total: bucket.thread_rows,
      thread_rows: bucket.thread_rows,
      root_sessions: bucket.rootIds.size,
      enriched: bucket.enriched,
      priced: bucket.priced,
      priced_exact: bucket.priced_exact,
      priced_fallback: bucket.priced_fallback,
      unpriced: bucket.unpriced,
      time_valid: bucket.time_valid,
    },
  };
}

function serializeTopRanges(rangeMaps, topKeyRanges, projector) {
  return {
    total: serializeTopRange(rangeMaps.total, topKeyRanges.total, projector),
    d7: serializeTopRange(rangeMaps.d7, topKeyRanges.d7, projector),
    d30: serializeTopRange(rangeMaps.d30, topKeyRanges.d30, projector),
  };
}

function serializeTopRange(map, topKeys, projector) {
  return topKeys
    .map((key) => map.get(key))
    .filter(Boolean)
    .map(projector);
}

function serializeDaily(dayMap) {
  return Object.fromEntries([...dayMap.entries()].map(([dayKey, value]) => [dayKey, serializeDailyEntry(value)]));
}

function serializeDailySnapshot(dayMap) {
  return Object.fromEntries([...dayMap.entries()].map(([dayKey, value]) => [dayKey, serializeDailySnapshotEntry(value)]));
}

function serializeDailyEntry(value) {
  return {
    tokens: Math.round(value?.tokens || 0),
    cost: value?.cost || 0,
    elapsed_seconds: Math.round(value?.elapsed_seconds || 0),
    sessions: value?.sessions || 0,
    by_model: deepRoundClone(value?.by_model || {}, ['tokens', 'cost', 'elapsed_seconds']),
    by_family: deepRoundClone(value?.by_family || {}, ['tokens', 'cost', 'elapsed_seconds', 'sessions']),
    by_repo: deepRoundClone(value?.by_repo || {}, ['tokens', 'cost', 'elapsed_seconds', 'sessions']),
    approximate: true,
  };
}

function serializeDailySnapshotEntry(value) {
  return serializeDailyEntry(value);
}

function serializeHeatmap(dayMap) {
  return Object.fromEntries([...dayMap.entries()].map(([dayKey, value]) => [dayKey, serializeHeatmapEntry(value)]));
}

function serializeHeatmapEntry(value) {
  return {
    tokens: Math.round(value?.tokens || 0),
    cost: value?.cost || 0,
    elapsed: Math.round(value?.elapsed || 0),
    sessions: value?.sessions || 0,
  };
}

function deepRoundClone(source, numericKeys) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = {};
    for (const numKey of numericKeys) {
      const nextValue = value?.[numKey] || 0;
      out[key][numKey] = numKey === 'cost' ? nextValue : Math.round(nextValue);
    }
  }
  return out;
}

function updateTopKeys(map, topKeys, key, limit = 6) {
  if (!topKeys.includes(key)) {
    if (topKeys.length < limit) {
      topKeys.push(key);
    } else {
      const weakestKey = topKeys[topKeys.length - 1];
      const weakestValue = map.get(weakestKey)?.tokens || 0;
      const nextValue = map.get(key)?.tokens || 0;
      if (nextValue <= weakestValue) return;
      topKeys.push(key);
    }
  }

  topKeys.sort((a, b) => {
    const aValue = map.get(a)?.tokens || 0;
    const bValue = map.get(b)?.tokens || 0;
    if (bValue !== aValue) return bValue - aValue;
    return String(a).localeCompare(String(b));
  });

  if (topKeys.length > limit) {
    topKeys.length = limit;
  }
}

function serializeRepoSummary(value) {
  return {
    repo_key: value.repo_key,
    repo_label: value.repo_label,
    tokens: value.tokens,
    cost: value.cost,
    cost_known: value.cost_known,
    exact_priced: value.exact_priced,
    heuristic_priced: value.heuristic_priced,
    sessions: value.sessions,
    by_model: deepRoundClone(value.by_model || {}, ['tokens', 'cost', 'sessions', 'exact_priced', 'heuristic_priced']),
    by_family: deepRoundClone(value.by_family || {}, ['tokens', 'cost', 'sessions', 'exact_priced', 'heuristic_priced']),
  };
}

function serializeModelSummary(value) {
  return {
    model_name: value.model_name,
    tokens: value.tokens,
    cost: value.cost,
    cost_known: value.cost_known,
    exact_priced: value.exact_priced,
    heuristic_priced: value.heuristic_priced,
    sessions: value.sessions,
    by_effort: deepRoundClone(value.by_effort || {}, ['tokens', 'cost', 'sessions', 'exact_priced', 'heuristic_priced']),
  };
}

function serializeFamilySummary(value) {
  return {
    family: value.family,
    tokens: value.tokens,
    cost: value.cost,
    exact_priced: value.exact_priced,
    heuristic_priced: value.heuristic_priced,
    sessions: value.sessions,
  };
}

function overlapsLowerBound(session, lowerBound) {
  const startedAt = session.started_at || 0;
  const endedAt = session.ended_at || startedAt;
  return endedAt >= lowerBound;
}
