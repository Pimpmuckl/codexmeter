import { buildDailyStackPresentation, getDailyRows } from './dailyStack.js';

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function clampNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function pickRangeData(data, range) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return data?.data?.[range] || data?.data?.total || [];
}

export function getZoomSlice(range, dates) {
  if (!dates?.length) return [];
  if (range === 'd7') return dates.slice(-7);
  if (range === 'd30') return dates.slice(-30);
  return dates;
}

function normalizeMetricRows(rows, keyField, labelField) {
  return rows.map((row) => ({
    key: row?.[keyField] || '',
    label: row?.[labelField] || '',
    tokens: clampNumber(row?.tokens),
  })).filter((row) => row.key);
}

function buildDailyPresentation(daily, range) {
  const dailyArr = getDailyRows(daily);
  if (!dailyArr.length) {
    return { dates: [], series: [] };
  }

  const allDates = dailyArr.map((row) => row.date);
  const visibleDates = getZoomSlice(range, allDates);
  const { series } = buildDailyStackPresentation(daily, { split: 'model', metric: 'tokens', dates: visibleDates });
  return { dates: visibleDates, series };
}

function getVisibleDailyRows(daily, range) {
  const dailyArr = getDailyRows(daily);
  if (!dailyArr.length) return [];

  const visibleDates = new Set(getZoomSlice(range, dailyArr.map((row) => row.date)));
  return dailyArr.filter((row) => visibleDates.has(row.date));
}

function summarizeVisibleDailyRows(daily, range) {
  const rows = getVisibleDailyRows(daily, range);
  return {
    tokens: rows.reduce((sum, row) => sum + clampNumber(row?.tokens), 0),
    elapsed: rows.reduce((sum, row) => sum + clampNumber(row?.elapsed_seconds), 0),
    cost: rows.reduce((sum, row) => sum + clampNumber(row?.cost), 0),
    days: rows.length || 1,
  };
}

function scaleBreakdown(breakdown, factor, numericKeys) {
  const next = {};
  for (const [key, value] of Object.entries(breakdown || {})) {
    next[key] = {};
    for (const numericKey of numericKeys) {
      next[key][numericKey] = clampNumber(value?.[numericKey]) * factor;
    }
  }
  return next;
}

function scaleDailyRow(row, factor) {
  if (factor >= 0.999) return row;
  return {
    ...row,
    tokens: clampNumber(row?.tokens) * factor,
    elapsed_seconds: clampNumber(row?.elapsed_seconds) * factor,
    cost: clampNumber(row?.cost) * factor,
    sessions: clampNumber(row?.sessions) * factor,
    by_model: scaleBreakdown(row?.by_model, factor, ['tokens', 'cost', 'elapsed_seconds']),
    by_family: scaleBreakdown(row?.by_family, factor, ['tokens', 'cost', 'elapsed_seconds', 'sessions']),
    by_repo: scaleBreakdown(row?.by_repo, factor, ['tokens', 'cost', 'elapsed_seconds', 'sessions']),
  };
}

function sliceDailyRowsAtCursor(daily, cursor) {
  const rows = getDailyRows(daily);
  if (!rows.length) return [];

  const lastIndex = rows.length - 1;
  const clampedCursor = Math.max(0, Math.min(lastIndex, Number.isFinite(cursor) ? cursor : lastIndex));
  const fullIndex = Math.floor(clampedCursor);
  const nextIndex = Math.min(lastIndex, Math.ceil(clampedCursor));
  const fractional = clampedCursor - fullIndex;

  return rows.slice(0, nextIndex + 1).map((row, index) => (
    index <= fullIndex ? row : scaleDailyRow(row, fractional)
  ));
}

function sumMetricRows(rows, breakdownKey, keyField) {
  const totals = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row?.[breakdownKey] || {})) {
      if (!totals.has(key)) {
        totals.set(key, { key, label: key, [keyField]: key, tokens: 0 });
      }
      totals.get(key).tokens += clampNumber(value?.tokens);
    }
  }
  return [...totals.values()].sort((a, b) => b.tokens - a.tokens);
}

export function buildDailyCursorPresentationTarget({ daily, range, cursor, fallback }) {
  const rowsAtCursor = sliceDailyRowsAtCursor(daily, cursor);
  const visibleRows = range === 'd7'
    ? rowsAtCursor.slice(-7)
    : range === 'd30'
    ? rowsAtCursor.slice(-30)
    : rowsAtCursor;

  if (!visibleRows.length) return fallback;

  const stats = {
    ...(fallback?.stats || {}),
    tokens: visibleRows.reduce((sum, row) => sum + clampNumber(row?.tokens), 0),
    elapsed: visibleRows.reduce((sum, row) => sum + clampNumber(row?.elapsed_seconds), 0),
    cost: visibleRows.reduce((sum, row) => sum + clampNumber(row?.cost), 0),
    sessions: visibleRows.reduce((sum, row) => sum + clampNumber(row?.sessions), 0),
    days: visibleRows.length || 1,
  };

  return {
    ...(fallback || {}),
    ready: true,
    stats,
    topRepos: sumMetricRows(visibleRows, 'by_repo', 'repo_label').slice(0, 6),
    topFamilies: sumMetricRows(visibleRows, 'by_family', 'family'),
    topModels: sumMetricRows(visibleRows, 'by_model', 'model_name').slice(0, 6),
  };
}

function buildHeatmapPresentation(heatmap) {
  const entries = heatmap?.data && typeof heatmap.data === 'object' ? heatmap.data : {};
  const next = {};
  for (const [day, value] of Object.entries(entries)) {
    next[day] = {
      tokens: clampNumber(value?.tokens),
      elapsed: clampNumber(value?.elapsed),
      cost: clampNumber(value?.cost),
    };
  }
  return next;
}

export function buildOverviewPresentationTarget({ overview, heatmap, daily, families, repos, models, range }) {
  const ov = overview?.data;
  if (!ov) {
    return {
      ready: true,
      stats: {
        tokens: 0,
        elapsed: 0,
        cost: 0,
        sessions: 0,
        enriched: 0,
        priced: 0,
        exactPriced: 0,
        fallbackPriced: 0,
        unpriced: 0,
        days: 1,
      },
      topRepos: [],
      topFamilies: [],
      topModels: [],
      daily: { dates: [], series: [] },
      heatmap: {},
    };
  }

  const d = ov?.[range] || ov?.total || {};
  const coverage = d.coverage || {};
  const threadRows = clampNumber(coverage.thread_rows ?? coverage.total);
  const rootSessions = clampNumber(coverage.root_sessions ?? d.total_sessions);
  const priced = clampNumber(coverage.priced);
  const exactPriced = clampNumber(coverage.priced_exact);
  const fallbackPriced = clampNumber(coverage.priced_fallback);
  const unpriced = clampNumber(coverage.unpriced ?? Math.max(threadRows - priced, 0));
  const dateRange = d.date_range;
  const overviewDays = dateRange?.from != null && dateRange?.to != null
    ? Math.max(1, Math.ceil((dateRange.to - dateRange.from) / 86400))
    : 1;
  const visibleDailySummary = summarizeVisibleDailyRows(daily, range);
  const useVisibleDailySummary = range === 'd7' || range === 'd30';

  return {
    ready: true,
    stats: {
      tokens: useVisibleDailySummary ? visibleDailySummary.tokens : clampNumber(d.total_tokens),
      elapsed: useVisibleDailySummary ? visibleDailySummary.elapsed : clampNumber(d.total_elapsed_seconds),
      cost: useVisibleDailySummary ? visibleDailySummary.cost : clampNumber(d.total_cost),
      sessions: rootSessions,
      enriched: clampNumber(coverage.enriched),
      priced,
      exactPriced,
      fallbackPriced,
      unpriced,
      days: useVisibleDailySummary ? visibleDailySummary.days : overviewDays,
    },
    topRepos: normalizeMetricRows(pickRangeData(repos, range).slice(0, 6), 'repo_label', 'repo_label'),
    topFamilies: normalizeMetricRows(pickRangeData(families, range), 'family', 'family'),
    topModels: normalizeMetricRows(pickRangeData(models, range).slice(0, 6), 'model_name', 'model_name'),
    daily: buildDailyPresentation(daily, range),
    heatmap: buildHeatmapPresentation(heatmap),
  };
}

function interpolateMetricRows(fromRows, toRows, t) {
  const fromMap = new Map((fromRows || []).map((row) => [row.key, row]));
  const toMap = new Map((toRows || []).map((row) => [row.key, row]));
  const keys = [];
  const seen = new Set();
  for (const row of toRows || []) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    keys.push(row.key);
  }
  for (const row of fromRows || []) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    keys.push(row.key);
  }
  const rows = [];

  for (const key of keys) {
    const from = fromMap.get(key);
    const to = toMap.get(key);
    const label = to?.label || from?.label || key;
    const tokens = lerp(clampNumber(from?.tokens), clampNumber(to?.tokens), t);
    if (tokens <= 0.001 && !to) continue;
    rows.push({ key, label, tokens });
  }

  return rows;
}

export function interpolateDaily(fromDaily, toDaily, t) {
  const dates = (toDaily?.dates?.length ? toDaily.dates : (fromDaily?.dates || [])).slice();
  const fromSeries = new Map((fromDaily?.series || []).map((series) => [series.key, series]));
  const toSeries = new Map((toDaily?.series || []).map((series) => [series.key, series]));
  const keys = new Set([...fromSeries.keys(), ...toSeries.keys()]);
  const series = [];

  for (const key of keys) {
    const from = fromSeries.get(key);
    const to = toSeries.get(key);
    const fromByDate = new Map((from?.data || []).map((value, index) => [fromDaily?.dates?.[index], value]));
    const toByDate = new Map((to?.data || []).map((value, index) => [toDaily?.dates?.[index], value]));
    const data = dates.map((date) => lerp(clampNumber(fromByDate.get(date)), clampNumber(toByDate.get(date)), t));
    if (data.every((value) => value <= 0.001) && !to) continue;
    series.push({
      key,
      label: to?.label || from?.label || key,
      data,
    });
  }

  return { dates, series };
}

export function emptyDailyLike(d) {
  return {
    dates: d.dates,
    series: (d.series || []).map((s) => ({
      key: s.key,
      label: s.label,
      data: s.data.map(() => 0),
    })),
  };
}

function interpolateHeatmap(fromHeatmap, toHeatmap, t) {
  const keys = new Set([
    ...Object.keys(fromHeatmap || {}),
    ...Object.keys(toHeatmap || {}),
  ]);
  const next = {};

  for (const key of keys) {
    const from = fromHeatmap?.[key];
    const to = toHeatmap?.[key];
    next[key] = {
      tokens: lerp(clampNumber(from?.tokens), clampNumber(to?.tokens), t),
      elapsed: lerp(clampNumber(from?.elapsed), clampNumber(to?.elapsed), t),
      cost: lerp(clampNumber(from?.cost), clampNumber(to?.cost), t),
    };
  }

  return next;
}

export function interpolateOverviewPresentation(from, to, t) {
  return {
    ready: to.ready,
    stats: {
      tokens: lerp(clampNumber(from?.stats?.tokens), clampNumber(to?.stats?.tokens), t),
      elapsed: lerp(clampNumber(from?.stats?.elapsed), clampNumber(to?.stats?.elapsed), t),
      cost: lerp(clampNumber(from?.stats?.cost), clampNumber(to?.stats?.cost), t),
      sessions: lerp(clampNumber(from?.stats?.sessions), clampNumber(to?.stats?.sessions), t),
      enriched: lerp(clampNumber(from?.stats?.enriched), clampNumber(to?.stats?.enriched), t),
      priced: lerp(clampNumber(from?.stats?.priced), clampNumber(to?.stats?.priced), t),
      exactPriced: lerp(clampNumber(from?.stats?.exactPriced), clampNumber(to?.stats?.exactPriced), t),
      fallbackPriced: lerp(clampNumber(from?.stats?.fallbackPriced), clampNumber(to?.stats?.fallbackPriced), t),
      unpriced: lerp(clampNumber(from?.stats?.unpriced), clampNumber(to?.stats?.unpriced), t),
      days: clampNumber(to?.stats?.days) || 1,
    },
    topRepos: interpolateMetricRows(from?.topRepos, to?.topRepos, t),
    topFamilies: interpolateMetricRows(from?.topFamilies, to?.topFamilies, t),
    topModels: interpolateMetricRows(from?.topModels, to?.topModels, t),
    daily: interpolateDaily(from?.daily, to?.daily, t),
    heatmap: interpolateHeatmap(from?.heatmap, to?.heatmap, t),
  };
}
