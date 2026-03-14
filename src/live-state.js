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
    : { ...prev };

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
  } else if (prev) {
    next.overview = prev.overview;
  }

  next.repos = mergeRangeObjects(prev?.repos, payload.data?.repos, next.repos);
  next.models = mergeRangeObjects(prev?.models, payload.data?.models, next.models);
  next.families = mergeRangeObjects(prev?.families, payload.data?.families, next.families);
  next.daily = payload.data?.daily ? { ...(prev?.daily || {}), ...payload.data.daily } : (prev?.daily || next.daily);
  next.heatmap = payload.data?.heatmap ? { ...(prev?.heatmap || {}), ...payload.data.heatmap } : (prev?.heatmap || next.heatmap);

  return next;
}

function mergeRangeObjects(prevTarget, source, fallbackTarget) {
  if (!source) return prevTarget || fallbackTarget;
  const target = {
    total: prevTarget ? prevTarget.total : fallbackTarget.total,
    d7: prevTarget ? prevTarget.d7 : fallbackTarget.d7,
    d30: prevTarget ? prevTarget.d30 : fallbackTarget.d30,
  };
  for (const rangeKey of ['total', 'd7', 'd30']) {
    if (source[rangeKey]) target[rangeKey] = source[rangeKey];
  }
  return target;
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
