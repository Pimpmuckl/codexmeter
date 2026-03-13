import { CACHE_ASSUMPTIONS } from './cost-catalog.js';

export function buildAggregates(sessions, tz) {
  const now = Date.now() / 1000;
  const d7 = now - 7 * 86400;
  const d30 = now - 30 * 86400;

  const overview = buildOverview(sessions, d7, d30);
  const repos = buildRepos(sessions);
  const models = buildModels(sessions);
  const daily = buildDaily(sessions, tz);
  const heatmap = buildHeatmap(sessions, tz);
  const families = buildFamilies(sessions);

  return { overview, repos, models, daily, heatmap, families };
}

function buildOverview(sessions, d7, d30) {
  const buckets = { total: sessions, d7: [], d30: [] };
  for (const s of sessions) {
    if (s.started_at >= d7) buckets.d7.push(s);
    if (s.started_at >= d30) buckets.d30.push(s);
  }

  const calc = (arr) => {
    let tokens = 0, cost = 0, elapsed = 0, priced = 0, timeValid = 0, enriched = 0;
    const repoSet = new Set(), modelSet = new Set();
    let earliest = Infinity, latest = -Infinity;

    for (const s of arr) {
      tokens += s.tokens_used;
      if (s.cost !== null) { cost += s.cost; priced++; }
      if (s.elapsed_seconds != null && s.elapsed_seconds > 0) { timeValid++; elapsed += s.elapsed_seconds; }
      if (s.model_name) { enriched++; modelSet.add(s.model_name); }
      repoSet.add(s.repo_label);
      if (s.started_at < earliest) earliest = s.started_at;
      if (s.ended_at > latest) latest = s.ended_at;
    }

    return {
      total_tokens: tokens,
      total_cost: cost,
      total_sessions: arr.length,
      active_repos: repoSet.size,
      active_models: modelSet.size,
      total_elapsed_seconds: elapsed,
      date_range: { from: earliest === Infinity ? null : earliest, to: latest === -Infinity ? null : latest },
      coverage: { total: arr.length, enriched, priced, time_valid: timeValid },
    };
  };

  return {
    total: calc(buckets.total),
    d7: calc(buckets.d7),
    d30: calc(buckets.d30),
    cost_assumptions: CACHE_ASSUMPTIONS,
  };
}

function buildRepos(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.repo_label;
    if (!map.has(key)) {
      map.set(key, { repo_key: s.repo_key, repo_label: key, tokens: 0, cost: 0, cost_known: 0, sessions: 0, by_model: {}, by_family: {} });
    }
    const r = map.get(key);
    r.tokens += s.tokens_used;
    if (s.cost !== null) { r.cost += s.cost; r.cost_known++; }
    r.sessions++;

    const mKey = s.model_name || 'unknown';
    if (!r.by_model[mKey]) r.by_model[mKey] = { tokens: 0, cost: 0, sessions: 0 };
    r.by_model[mKey].tokens += s.tokens_used;
    if (s.cost !== null) r.by_model[mKey].cost += s.cost;
    r.by_model[mKey].sessions++;

    const fKey = s.agent_family;
    if (!r.by_family[fKey]) r.by_family[fKey] = { tokens: 0, cost: 0, sessions: 0 };
    r.by_family[fKey].tokens += s.tokens_used;
    if (s.cost !== null) r.by_family[fKey].cost += s.cost;
    r.by_family[fKey].sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildModels(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.model_name || 'unknown';
    if (!map.has(key)) map.set(key, { model_name: key, tokens: 0, cost: 0, cost_known: 0, sessions: 0, by_effort: {} });
    const m = map.get(key);
    m.tokens += s.tokens_used;
    if (s.cost !== null) { m.cost += s.cost; m.cost_known++; }
    m.sessions++;
    const eKey = s.reasoning_effort || 'unknown';
    if (!m.by_effort[eKey]) m.by_effort[eKey] = { tokens: 0, cost: 0, sessions: 0 };
    m.by_effort[eKey].tokens += s.tokens_used;
    if (s.cost !== null) m.by_effort[eKey].cost += s.cost;
    m.by_effort[eKey].sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildFamilies(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const key = s.agent_family;
    if (!map.has(key)) map.set(key, { family: key, tokens: 0, cost: 0, sessions: 0 });
    const f = map.get(key);
    f.tokens += s.tokens_used;
    if (s.cost !== null) f.cost += s.cost;
    f.sessions++;
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function buildDaily(sessions, tz) {
  const dayMap = new Map();
  for (const s of sessions) {
    if (!s.started_at || !s.ended_at) continue;
    const elapsed = s.elapsed_seconds;
    if (!elapsed || elapsed <= 0) continue;

    const startMs = s.started_at * 1000;
    const endMs = s.ended_at * 1000;
    const totalDur = endMs - startMs;
    if (totalDur <= 0) continue;

    const startDay = toDayKey(startMs, tz);
    const endDay = toDayKey(endMs - 1, tz);

    if (startDay === endDay) {
      addToDay(dayMap, startDay, s, 1.0);
    } else {
      let cursor = dayStartMs(startDay);
      while (cursor < endMs) {
        const nextDay = cursor + 86400000;
        const overlapStart = Math.max(cursor, startMs);
        const overlapEnd = Math.min(nextDay, endMs);
        const fraction = (overlapEnd - overlapStart) / totalDur;
        if (fraction > 0) addToDay(dayMap, toDayKey(cursor, tz), s, fraction);
        cursor = nextDay;
      }
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
        Object.entries(d.by_family).map(([k, v]) => [k, { tokens: Math.round(v.tokens), cost: v.cost, sessions: v.sessions }])
      ),
      approximate: true,
    }));
}

function addToDay(dayMap, dayKey, session, fraction) {
  if (!dayMap.has(dayKey)) dayMap.set(dayKey, { tokens: 0, cost: 0, elapsed_seconds: 0, sessions: 0, by_model: {}, by_family: {} });
  const d = dayMap.get(dayKey);
  d.tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.cost += session.cost * fraction;
  d.elapsed_seconds += (session.elapsed_seconds || 0) * fraction;
  if (fraction > 0.001) d.sessions++;

  const mKey = session.model_name || 'unknown';
  if (!d.by_model[mKey]) d.by_model[mKey] = { tokens: 0, cost: 0, elapsed_seconds: 0 };
  d.by_model[mKey].tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.by_model[mKey].cost += session.cost * fraction;
  d.by_model[mKey].elapsed_seconds += (session.elapsed_seconds || 0) * fraction;

  const fKey = session.agent_family;
  if (!d.by_family[fKey]) d.by_family[fKey] = { tokens: 0, cost: 0, sessions: 0 };
  d.by_family[fKey].tokens += session.tokens_used * fraction;
  if (session.cost !== null) d.by_family[fKey].cost += session.cost * fraction;
  if (fraction > 0.001) d.by_family[fKey].sessions++;
}

function buildHeatmap(sessions, tz) {
  const dayMap = new Map();
  for (const s of sessions) {
    if (!s.started_at) continue;
    const dk = toDayKey(s.started_at * 1000, tz);
    if (!dayMap.has(dk)) dayMap.set(dk, { tokens: 0, cost: 0, elapsed: 0, sessions: 0 });
    const d = dayMap.get(dk);
    d.tokens += s.tokens_used;
    if (s.cost !== null) d.cost += s.cost;
    d.elapsed += s.elapsed_seconds || 0;
    d.sessions++;
  }
  return Object.fromEntries(dayMap);
}

function toDayKey(ms, tz) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
}

function dayStartMs(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
