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
  const next = mode === 'bootstrap' || !prev || prev.ingest_id !== payload.ingest_id
    ? createEmptyLiveClientState()
    : cloneLiveState(prev);

  next.ingest_id = payload.ingest_id;
  next.seq = payload.seq;

  if (payload.data?.overview) {
    next.overview = {
      ...next.overview,
      ...payload.data.overview,
      total: payload.data.overview.total ? { ...next.overview.total, ...payload.data.overview.total } : next.overview.total,
      d7: payload.data.overview.d7 ? { ...next.overview.d7, ...payload.data.overview.d7 } : next.overview.d7,
      d30: payload.data.overview.d30 ? { ...next.overview.d30, ...payload.data.overview.d30 } : next.overview.d30,
    };
  }

  mergeRangeObjects(next.repos, payload.data?.repos);
  mergeRangeObjects(next.models, payload.data?.models);
  mergeRangeObjects(next.families, payload.data?.families);
  if (payload.data?.daily) next.daily = { ...next.daily, ...payload.data.daily };
  if (payload.data?.heatmap) next.heatmap = { ...next.heatmap, ...payload.data.heatmap };

  return next;
}

function mergeRangeObjects(target, source) {
  if (!source) return;
  for (const rangeKey of ['total', 'd7', 'd30']) {
    if (source[rangeKey]) target[rangeKey] = source[rangeKey];
  }
}

function cloneLiveState(state) {
  return {
    ingest_id: state.ingest_id,
    seq: state.seq,
    overview: {
      total: { ...state.overview.total },
      d7: { ...state.overview.d7 },
      d30: { ...state.overview.d30 },
      cost_assumptions: state.overview.cost_assumptions,
    },
    repos: {
      total: [...state.repos.total],
      d7: [...state.repos.d7],
      d30: [...state.repos.d30],
    },
    models: {
      total: [...state.models.total],
      d7: [...state.models.d7],
      d30: [...state.models.d30],
    },
    families: {
      total: [...state.families.total],
      d7: [...state.families.d7],
      d30: [...state.families.d30],
    },
    daily: { ...state.daily },
    heatmap: { ...state.heatmap },
  };
}

export function buildLiveDataEnvelope(liveState, progress) {
  if (!liveState) return null;

  return {
    overview: {
      data: liveState.overview,
      complete: progress?.complete || false,
      coverage: liveState.overview?.total?.coverage || { total: 0, enriched: 0, priced: 0, time_valid: 0 },
      generated_at: progress?.generated_at || null,
    },
    repos: {
      data: liveState.repos,
      complete: progress?.complete || false,
      generated_at: progress?.generated_at || null,
    },
    models: {
      data: liveState.models,
      complete: progress?.complete || false,
      generated_at: progress?.generated_at || null,
    },
    families: {
      data: liveState.families,
      complete: progress?.complete || false,
      generated_at: progress?.generated_at || null,
    },
    daily: {
      data: Object.entries(liveState.daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, ...value })),
      complete: progress?.complete || false,
      generated_at: progress?.generated_at || null,
    },
    heatmap: {
      data: liveState.heatmap,
      complete: progress?.complete || false,
      generated_at: progress?.generated_at || null,
    },
  };
}
