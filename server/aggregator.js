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

function modelKeyFor(session, opts = {}) {
  const key = session.model_name || 'unknown';
  if (key === 'unknown' && opts.includeUnknownModels === false) return null;
  return key;
}

export function buildAggregates(sessions, tz, sessionView = null, opts = {}) {
  const aggregateOpts = {
    includeUnknownModels: opts.includeUnknownModels !== false,
  };
  const now = Date.now() / 1000;
  const d7 = now - 7 * 86400;
  const d30 = now - 30 * 86400;
  const groupedSessions = sessionView || buildSessionView(sessions);

  const rawBuckets = { total: sessions, d7: [], d30: [] };
  for (const s of sessions) {
    if (overlapsLowerBound(s, d7)) rawBuckets.d7.push(s);
    if (overlapsLowerBound(s, d30)) rawBuckets.d30.push(s);
  }

  const overview = buildOverview(sessions, groupedSessions, d7, d30);
  const repos = {
    total: buildRepos(rawBuckets.total, aggregateOpts),
    d7: buildRepos(rawBuckets.d7, aggregateOpts),
    d30: buildRepos(rawBuckets.d30, aggregateOpts),
  };
  const models = {
    total: buildModels(rawBuckets.total, aggregateOpts),
    d7: buildModels(rawBuckets.d7, aggregateOpts),
    d30: buildModels(rawBuckets.d30, aggregateOpts),
  };
  const families = {
    total: buildFamilies(rawBuckets.total),
    d7: buildFamilies(rawBuckets.d7),
    d30: buildFamilies(rawBuckets.d30),
  };
  const daily = buildDaily(sessions, groupedSessions, tz, aggregateOpts);
  const heatmap = buildHeatmap(sessions, groupedSessions, tz);

  return { overview, repos, models, daily, heatmap, families };
}

export function buildSessionView(sessions, allSessions = sessions) {
  const grouped = new Map();
  const rootLookup = new Map(allSessions.map(session => [session.thread_id, session]));

  for (const session of sessions) {
    const key = session.root_thread_id || session.thread_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }

  return [...grouped.entries()]
    .map(([rootThreadId, group]) => collapseSessionGroup(rootThreadId, group, rootLookup))
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
}

function buildOverview(rawSessions, groupedSessions, d7, d30) {
  const rawBuckets = { total: rawSessions, d7: [], d30: [] };
  for (const session of rawSessions) {
    if (overlapsLowerBound(session, d7)) rawBuckets.d7.push(session);
    if (overlapsLowerBound(session, d30)) rawBuckets.d30.push(session);
  }

  const groupedBuckets = {
    total: groupedSessions,
    d7: groupedSessions.filter(session => overlapsLowerBound(session, d7)),
    d30: groupedSessions.filter(session => overlapsLowerBound(session, d30)),
  };

  const calc = (arr, groupedArr, lowerBound = 0) => {
    let tokens = 0, cost = 0, elapsed = 0, priced = 0, exactPriced = 0, heuristicPriced = 0, unpriced = 0, timeValid = 0, enriched = 0;
    const repoSet = new Set(), modelSet = new Set();
    let earliest = Infinity, latest = -Infinity;

    for (const s of arr) {
      tokens += s.tokens_used;
      if (s.cost !== null) {
        cost += s.cost;
        priced++;
        if (s.cost_source === 'exact') exactPriced++;
        if (s.cost_source === 'heuristic') heuristicPriced++;
      } else {
        unpriced++;
      }
      if (s.elapsed_seconds != null && s.elapsed_seconds > 0) { timeValid++; }
      if (s.model_name) { enriched++; modelSet.add(s.model_name); }
      repoSet.add(s.repo_label);
      if (s.started_at < earliest) earliest = s.started_at;
      if (s.ended_at > latest) latest = s.ended_at;
    }

    for (const s of groupedArr) {
      if (s.elapsed_seconds != null && s.elapsed_seconds > 0) {
        elapsed += s.elapsed_seconds;
      }
    }

    const boundedFrom = earliest === Infinity
      ? null
      : Math.max(earliest, lowerBound || 0);

    return {
      total_tokens: tokens,
      total_cost: cost,
      total_sessions: groupedArr.length,
      active_repos: repoSet.size,
      active_models: modelSet.size,
      total_elapsed_seconds: elapsed,
      date_range: { from: boundedFrom, to: latest === -Infinity ? null : latest },
      coverage: {
        total: arr.length,
        thread_rows: arr.length,
        root_sessions: groupedArr.length,
        enriched,
        priced,
        priced_exact: exactPriced,
        priced_fallback: heuristicPriced,
        unpriced,
        time_valid: timeValid,
      },
    };
  };

  return {
    total: calc(rawBuckets.total, groupedBuckets.total, 0),
    d7: calc(rawBuckets.d7, groupedBuckets.d7, d7),
    d30: calc(rawBuckets.d30, groupedBuckets.d30, d30),
    cost_assumptions: CACHE_ASSUMPTIONS,
  };
}

function buildRepos(sessions, opts) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.repo_label;
    if (!map.has(key)) {
      map.set(key, {
        repo_key: s.repo_key,
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
    const r = map.get(key);
    r.tokens += s.tokens_used;
    if (s.cost !== null) {
      r.cost += s.cost;
      r.cost_known++;
      if (s.cost_source === 'exact') r.exact_priced++;
      if (s.cost_source === 'heuristic') r.heuristic_priced++;
    }
    r.sessions++;

    const mKey = modelKeyFor(s, opts);
    if (mKey) {
      if (!r.by_model[mKey]) r.by_model[mKey] = { tokens: 0, cost: 0, sessions: 0, exact_priced: 0, heuristic_priced: 0 };
      r.by_model[mKey].tokens += s.tokens_used;
      if (s.cost !== null) {
        r.by_model[mKey].cost += s.cost;
        if (s.cost_source === 'exact') r.by_model[mKey].exact_priced++;
        if (s.cost_source === 'heuristic') r.by_model[mKey].heuristic_priced++;
      }
      r.by_model[mKey].sessions++;
    }

    const fKey = s.agent_family;
    if (!r.by_family[fKey]) r.by_family[fKey] = { tokens: 0, cost: 0, sessions: 0, exact_priced: 0, heuristic_priced: 0 };
    r.by_family[fKey].tokens += s.tokens_used;
    if (s.cost !== null) {
      r.by_family[fKey].cost += s.cost;
      if (s.cost_source === 'exact') r.by_family[fKey].exact_priced++;
      if (s.cost_source === 'heuristic') r.by_family[fKey].heuristic_priced++;
    }
    r.by_family[fKey].sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildModels(sessions, opts) {
  const map = new Map();
  for (const s of sessions) {
    const key = modelKeyFor(s, opts);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { model_name: key, tokens: 0, cost: 0, cost_known: 0, exact_priced: 0, heuristic_priced: 0, sessions: 0, by_effort: {} });
    const m = map.get(key);
    m.tokens += s.tokens_used;
    if (s.cost !== null) {
      m.cost += s.cost;
      m.cost_known++;
      if (s.cost_source === 'exact') m.exact_priced++;
      if (s.cost_source === 'heuristic') m.heuristic_priced++;
    }
    m.sessions++;
    const eKey = normalizeEffortKey(s.reasoning_effort);
    if (!m.by_effort[eKey]) m.by_effort[eKey] = { tokens: 0, cost: 0, sessions: 0, exact_priced: 0, heuristic_priced: 0 };
    m.by_effort[eKey].tokens += s.tokens_used;
    if (s.cost !== null) {
      m.by_effort[eKey].cost += s.cost;
      if (s.cost_source === 'exact') m.by_effort[eKey].exact_priced++;
      if (s.cost_source === 'heuristic') m.by_effort[eKey].heuristic_priced++;
    }
    m.by_effort[eKey].sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildFamilies(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.agent_family;
    if (!map.has(key)) map.set(key, { family: key, tokens: 0, cost: 0, exact_priced: 0, heuristic_priced: 0, sessions: 0 });
    const f = map.get(key);
    f.tokens += s.tokens_used;
    if (s.cost !== null) {
      f.cost += s.cost;
      if (s.cost_source === 'exact') f.exact_priced++;
      if (s.cost_source === 'heuristic') f.heuristic_priced++;
    }
    f.sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildDaily(rawSessions, groupedSessions, tz, opts) {
  const dayMap = new Map();
  for (const s of rawSessions) {
    if (!s.started_at || !s.ended_at) continue;

    const startMs = s.started_at * 1000;
    const endMs = s.ended_at * 1000;
    const totalDur = endMs - startMs;
    if (totalDur <= 0) continue;

    if (s.has_usage_by_day) {
      addSessionPresence(dayMap, startMs, endMs, totalDur, tz, s);
      addUsageByDay(dayMap, s, opts);
    } else {
      for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
        addToDay(dayMap, dayKey, s, overlapMs / totalDur, opts);
      }
    }
  }

  for (const s of rawSessions) {
    if (!s.active_by_day) continue;
    for (const [dayKey, seconds] of Object.entries(s.active_by_day)) {
      addElapsedToDay(dayMap, dayKey, s, seconds || 0, opts);
    }
  }

  return [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      tokens: Math.round(d.tokens),
      cost: d.cost,
      elapsed_seconds: Math.round(d.elapsed_seconds),
      sessions: d.sessions,
      by_model: Object.fromEntries(
        Object.entries(d.by_model).map(([k, v]) => [k, { tokens: Math.round(v.tokens), cost: v.cost, elapsed_seconds: Math.round(v.elapsed_seconds) }])
      ),
      by_family: Object.fromEntries(
        Object.entries(d.by_family).map(([k, v]) => [k, { tokens: Math.round(v.tokens), cost: v.cost, elapsed_seconds: Math.round(v.elapsed_seconds), sessions: v.sessions }])
      ),
      by_repo: Object.fromEntries(
        Object.entries(d.by_repo || {}).map(([k, v]) => [k, { tokens: Math.round(v.tokens), cost: v.cost, elapsed_seconds: Math.round(v.elapsed_seconds), sessions: v.sessions }])
      ),
      approximate: true,
    }));
}

function addToDay(dayMap, dayKey, session, fraction, opts) {
  if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {}, by_repo: {} });
  const d = dayMap.get(dayKey);
  d.tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.cost += session.cost * fraction;
  if (fraction > 0.001) d.sessions++;

  const mKey = modelKeyFor(session, opts);
  if (mKey) {
    if (!d.by_model[mKey]) d.by_model[mKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
    d.by_model[mKey].tokens += session.tokens_used * fraction;
    if (session.cost !== null) d.by_model[mKey].cost += session.cost * fraction;
  }

  const fKey = session.agent_family;
  if (!d.by_family[fKey]) d.by_family[fKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  d.by_family[fKey].tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.by_family[fKey].cost += session.cost * fraction;
  if (fraction > 0.001) d.by_family[fKey].sessions++;

  const rKey = session.repo_label || 'unknown';
  if (!d.by_repo[rKey]) d.by_repo[rKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  d.by_repo[rKey].tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.by_repo[rKey].cost += session.cost * fraction;
  if (fraction > 0.001) d.by_repo[rKey].sessions++;
}

function buildHeatmap(rawSessions, groupedSessions, tz) {
  const toDayKeyInTz = createDayKeyFormatter(tz);
  const dayMap = new Map();
  for (const s of rawSessions) {
    if (!s.started_at) continue;
    const startMs = s.started_at * 1000;
    const endMs = (s.ended_at || s.started_at) * 1000;
    const totalDur = endMs - startMs;
    if (s.has_usage_by_day) {
      for (const usageDay of s.usage_by_day || []) {
        const dayKey = usageDay.day;
        if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
        const d = dayMap.get(dayKey);
        d.tokens += usageDay.tokens || 0;
        if (usageDay.cost !== null) d.cost += usageDay.cost;
      }
      addHeatmapPresence(dayMap, s, startMs, endMs, totalDur, tz, toDayKeyInTz);
    } else if (totalDur > 0) {
      for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
        addHeatmapUsage(dayMap, dayKey, s, overlapMs / totalDur);
      }
    } else {
      addHeatmapUsage(dayMap, toDayKeyInTz(startMs), s, 1);
    }
  }

  for (const s of groupedSessions) {
    if (!s.active_by_day) continue;
    for (const [dayKey, seconds] of Object.entries(s.active_by_day)) {
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
      dayMap.get(dayKey).elapsed += seconds;
    }
  }
  return Object.fromEntries(dayMap);
}

function addHeatmapUsage(dayMap, dayKey, session, fraction) {
  if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
  const d = dayMap.get(dayKey);
  d.tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.cost += session.cost * fraction;
  if (fraction > 0.001) d.sessions++;
}

function addHeatmapPresence(dayMap, session, startMs, endMs, totalDur, tz, toDayKeyInTz) {
  if (totalDur <= 0) {
    const dayKey = toDayKeyInTz(startMs);
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
    dayMap.get(dayKey).sessions++;
    return;
  }
  for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
    if ((overlapMs / totalDur) > 0.001) dayMap.get(dayKey).sessions++;
  }
}

function addSessionPresence(dayMap, startMs, endMs, totalDur, tz, session) {
  for (const { dayKey, overlapMs } of splitIntervalByDay(startMs, endMs, tz)) {
    addPresenceToDay(dayMap, dayKey, session, overlapMs / totalDur);
  }
}

function addPresenceToDay(dayMap, dayKey, session, fraction) {
  if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {}, by_repo: {} });
  const d = dayMap.get(dayKey);
  if (fraction > 0.001) d.sessions++;

  const fKey = session.agent_family;
  if (!d.by_family[fKey]) d.by_family[fKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  if (fraction > 0.001) d.by_family[fKey].sessions++;

  const rKey = session.repo_label || 'unknown';
  if (!d.by_repo[rKey]) d.by_repo[rKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  if (fraction > 0.001) d.by_repo[rKey].sessions++;
}

function addUsageByDay(dayMap, session, opts) {
  for (const usageDay of session.usage_by_day || []) {
    const dayKey = usageDay.day;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {}, by_repo: {} });
    const d = dayMap.get(dayKey);
    d.tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) d.cost += usageDay.cost;

    const mKey = modelKeyFor(session, opts);
    if (mKey) {
      if (!d.by_model[mKey]) d.by_model[mKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
      d.by_model[mKey].tokens += usageDay.tokens || 0;
      if (usageDay.cost !== null) d.by_model[mKey].cost += usageDay.cost;
    }

    const fKey = session.agent_family;
    if (!d.by_family[fKey]) d.by_family[fKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
    d.by_family[fKey].tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) d.by_family[fKey].cost += usageDay.cost;

    const rKey = session.repo_label || 'unknown';
    if (!d.by_repo[rKey]) d.by_repo[rKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
    d.by_repo[rKey].tokens += usageDay.tokens || 0;
    if (usageDay.cost !== null) d.by_repo[rKey].cost += usageDay.cost;
  }
}

function addElapsedToDay(dayMap, dayKey, session, seconds, opts) {
  if (!seconds) return;
  if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {}, by_repo: {} });
  const d = dayMap.get(dayKey);
  d.elapsed_seconds += seconds;

  const mKey = modelKeyFor(session, opts);
  if (mKey) {
    if (!d.by_model[mKey]) d.by_model[mKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
    d.by_model[mKey].elapsed_seconds += seconds;
  }

  const fKey = session.agent_family || 'generic';
  if (!d.by_family[fKey]) d.by_family[fKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  d.by_family[fKey].elapsed_seconds += seconds;

  const rKey = session.repo_label || 'unknown';
  if (!d.by_repo[rKey]) d.by_repo[rKey] = { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0 };
  d.by_repo[rKey].elapsed_seconds += seconds;
}

function overlapsLowerBound(session, lowerBound) {
  const startedAt = session.started_at || 0;
  const endedAt = session.ended_at || startedAt;
  return endedAt >= lowerBound;
}

function collapseSessionGroup(rootThreadId, group, rootLookup) {
  const sorted = [...group].sort((a, b) => (a.started_at || 0) - (b.started_at || 0));
  const root = rootLookup.get(rootThreadId) || group.find(s => s.thread_id === rootThreadId) || sorted[0];
  const rootIncluded = group.some(session => session.thread_id === root.thread_id);
  const repoLabels = new Set(group.map(s => s.repo_label).filter(Boolean));
  const modelNames = new Set(group.map(s => s.model_name).filter(Boolean));
  const efforts = new Set(group.map(s => s.reasoning_effort).filter(Boolean));
  const agentRoles = new Set(group.map(s => s.agent_role).filter(Boolean));
  const agentNicknames = new Set(group.map(s => s.agent_nickname).filter(Boolean));
  const titles = new Set(group.map(s => s.title).filter(Boolean));

  let startedAt = Infinity;
  let endedAt = -Infinity;
  let tokensUsed = 0;
  let elapsedSeconds = 0;
  let cost = 0;
  let hasCost = false;
  const agentFamilySet = new Set();
  const activeByDay = new Map();

  for (const session of group) {
    if (session.started_at && session.started_at < startedAt) startedAt = session.started_at;
    if (session.ended_at && session.ended_at > endedAt) endedAt = session.ended_at;
    tokensUsed += session.tokens_used || 0;
    elapsedSeconds += session.elapsed_seconds || 0;
    mergeActiveByDay(activeByDay, session.active_by_day);
    if (session.cost !== null) {
      cost += session.cost;
      hasCost = true;
    }
    if (session.agent_family) agentFamilySet.add(session.agent_family);
  }

  const rootStartedAt = startedAt === Infinity ? root.started_at : startedAt;
  const rootEndedAt = endedAt === -Infinity ? root.ended_at : endedAt;
  const exactPriced = group.filter(session => session.cost_source === 'exact').length;
  const heuristicPriced = group.filter(session => session.cost_source === 'heuristic').length;
  const availablePriced = exactPriced + heuristicPriced;

  return {
    thread_id: root.thread_id,
    root_thread_id: rootThreadId,
    repo_label: repoLabels.size === 1 ? [...repoLabels][0] : (root.repo_label || 'mixed'),
    model_name: summarizeGroupedValue(root.model_name, modelNames),
    reasoning_effort: summarizeGroupedValue(root.reasoning_effort, efforts),
    agent_role: summarizeGroupedValue(root.agent_role, agentRoles),
    agent_nickname: summarizeGroupedValue(root.agent_nickname, agentNicknames),
    agent_family: summarizeGroupedValue(root.agent_family, agentFamilySet),
    is_subagent: false,
    started_at: rootStartedAt,
    ended_at: rootEndedAt,
    elapsed_seconds: elapsedSeconds || null,
    active_by_day: activeByDay.size > 0 ? Object.fromEntries(activeByDay) : null,
    tokens_used: tokensUsed,
    cost: hasCost ? cost : null,
    title: root.title,
    thread_count: group.length,
    subagent_count: group.length - (rootIncluded ? 1 : 0),
    cost_source:
      availablePriced === 0 ? 'unavailable'
      : heuristicPriced === 0 ? 'exact'
      : exactPriced === 0 ? 'heuristic'
      : 'mixed',
    descendant_models: [...modelNames],
    descendant_families: [...agentFamilySet],
    descendant_roles: [...agentRoles],
    descendant_nicknames: [...agentNicknames],
    related_titles: [...titles].slice(0, 5),
  };
}

function summarizeGroupedValue(rootValue, values) {
  if (values.size === 0) return rootValue || null;
  if (values.size === 1) return [...values][0];
  return 'mixed';
}

function mergeActiveByDay(target, source) {
  if (!source) return;
  for (const [dayKey, seconds] of Object.entries(source)) {
    target.set(dayKey, (target.get(dayKey) || 0) + (seconds || 0));
  }
}
