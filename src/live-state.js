export function createEmptyLiveClientState() {
  return {
    ingest_id: null,
    seq: 0,
    overview: { total: {}, d7: {}, d30: {}, cost_assumptions: null },
    repos: { total: [], d7: [], d30: [] },
    models: { total: [], d7: [], d30: [] },
    families: { total: [], d7: [], d30: [] },
    daily: {},
    heatmap: {},
  };
}

export function mergeLiveEvent(prev, payload, mode) {
  const replacesState = mode === 'bootstrap' || mode === 'snapshot' || mode === 'complete';
  const next = replacesState || !prev || prev.ingest_id !== payload.ingest_id
    ? createEmptyLiveClientState()
    : { ...prev };

  next.ingest_id = payload.ingest_id;
  next.seq = payload.seq;

  if (payload.data) {
    next.overview = payload.data.overview || next.overview;
    next.repos = payload.data.repos || next.repos;
    next.models = payload.data.models || next.models;
    next.families = payload.data.families || next.families;
    next.daily = payload.data.daily || next.daily;
    next.heatmap = payload.data.heatmap || next.heatmap;
  } else if (prev) {
    next.overview = prev.overview;
    next.repos = prev.repos;
    next.models = prev.models;
    next.families = prev.families;
    next.daily = prev.daily;
    next.heatmap = prev.heatmap;
  }

  return next;
}

export function buildLiveDataEnvelope(liveState) {
  if (!liveState) return null;

  return {
    overview: {
      data: liveState.overview,
      coverage: liveState.overview?.total?.coverage || { total: 0, enriched: 0, priced: 0, time_valid: 0 },
    },
    repos: {
      data: liveState.repos,
    },
    models: {
      data: liveState.models,
    },
    families: {
      data: liveState.families,
    },
    daily: {
      data: Object.entries(liveState.daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, ...value })),
    },
    heatmap: {
      data: liveState.heatmap,
    },
  };
}

export function shouldUseLiveData(liveData, { overviewIngestActive = false, settledOverviewReady = false, backendComplete = false } = {}) {
  if (!liveData) return false;
  if (!settledOverviewReady) return true;
  return Boolean(overviewIngestActive && !backendComplete);
}

export function hasLiveRows(envelope) {
  const data = envelope?.data;
  if (Array.isArray(data)) return data.length > 0;
  if (!data || typeof data !== 'object') return false;
  return ['total', 'd7', 'd30'].some((rangeKey) => Array.isArray(data[rangeKey]) && data[rangeKey].length > 0);
}

export function chooseLiveEnvelope(liveEnvelope, settledEnvelope, useLiveData) {
  if (!useLiveData) return settledEnvelope;
  return hasLiveRows(liveEnvelope) ? liveEnvelope : (settledEnvelope || liveEnvelope);
}

export function buildLiveStateFromSettled(data, ingestId, seq = 0) {
  const next = createEmptyLiveClientState();
  next.ingest_id = ingestId || null;
  next.seq = seq;
  next.overview = data?.overview?.data || next.overview;
  next.repos = data?.repos?.data || next.repos;
  next.models = data?.models?.data || next.models;
  next.families = data?.families?.data || next.families;
  next.daily = Object.fromEntries((data?.daily?.data || []).map((entry) => [entry.date, { ...entry }]));
  next.heatmap = data?.heatmap?.data || next.heatmap;
  return next;
}
