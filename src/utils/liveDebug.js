function dateDiffDays(from, to) {
  if (!from || !to) return null;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

export function isLiveDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const search = new URLSearchParams(window.location.search);
    return search.has('debugLive') ||
      window.localStorage?.getItem('codexmeter.debugLive') === '1' ||
      window.__CODEXMETER_DEBUG_LIVE__ === true;
  } catch {
    return false;
  }
}

export function summarizeDailyData(daily, currentDateBucket = null) {
  const rows = Array.isArray(daily?.dates) && Array.isArray(daily?.series)
    ? daily.dates.map((date, index) => ({
        date,
        tokens: daily.series.reduce((sum, series) => sum + (series?.data?.[index] || 0), 0),
      }))
    : Array.isArray(daily?.data)
    ? daily.data
    : Array.isArray(daily)
      ? daily
      : Object.entries(daily || {}).map(([date, value]) => ({ date, ...value }));
  const sorted = rows
    .filter((row) => row?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nonzero = sorted.filter((row) => (row.tokens || 0) > 0 || (row.sessions || 0) > 0);
  const first = sorted[0]?.date || null;
  const last = sorted[sorted.length - 1]?.date || null;
  const lastNonzero = nonzero[nonzero.length - 1]?.date || null;

  return {
    days: sorted.length,
    nonzeroDays: nonzero.length,
    first,
    last,
    lastNonzero,
    currentDateBucket,
    overreachDays: currentDateBucket && lastNonzero ? Math.max(0, dateDiffDays(currentDateBucket, lastNonzero) || 0) : 0,
    totalTokens: Math.round(sorted.reduce((sum, row) => sum + (row.tokens || 0), 0)),
  };
}

export function summarizeHeatmapData(heatmap, currentDateBucket = null) {
  const rows = Object.entries(heatmap || {})
    .map(([date, value]) => ({
      date,
      tokens: value?.tokens || 0,
      sessions: value?.sessions || 0,
      elapsed: value?.elapsed || 0,
      cost: value?.cost || 0,
    }))
    .filter((row) => row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nonzero = rows.filter((row) => row.tokens > 0 || row.sessions > 0 || row.elapsed > 0 || row.cost > 0);
  const first = rows[0]?.date || null;
  const last = rows[rows.length - 1]?.date || null;
  const lastNonzero = nonzero[nonzero.length - 1]?.date || null;

  return {
    days: rows.length,
    nonzeroDays: nonzero.length,
    first,
    last,
    lastNonzero,
    currentDateBucket,
    overreachDays: currentDateBucket && lastNonzero ? Math.max(0, dateDiffDays(currentDateBucket, lastNonzero) || 0) : 0,
    totalTokens: Math.round(rows.reduce((sum, row) => sum + row.tokens, 0)),
  };
}

export function summarizeLivePayload(payload) {
  return {
    seq: payload?.seq,
    phase: payload?.progress?.phase,
    percent: Number(((payload?.progress?.percent || 0) * 100).toFixed(1)),
    enriched: payload?.progress?.enriched,
    needs: payload?.progress?.needs_enrichment,
    complete: Boolean(payload?.progress?.complete),
    daily: summarizeDailyData(payload?.data?.daily || {}, payload?.progress?.current_date_bucket || null),
  };
}

export function summarizeLiveState(state, progress = null) {
  return {
    seq: state?.seq,
    ingestId: state?.ingest_id,
    daily: summarizeDailyData(state?.daily || {}, progress?.current_date_bucket || null),
  };
}

export function debugLive(label, details) {
  if (!isLiveDebugEnabled()) return;
  console.debug(`[codexmeter:live] ${label}`, details);
}
