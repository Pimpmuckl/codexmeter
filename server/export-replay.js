function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

export function createReplayCaptureState() {
  return {
    ingest_id: null,
    active: false,
    available: false,
    started_at_ms: 0,
    completed_at_ms: 0,
    events: [],
  };
}

export function resetReplayCapture(replay) {
  replay.ingest_id = null;
  replay.active = false;
  replay.available = false;
  replay.started_at_ms = 0;
  replay.completed_at_ms = 0;
  replay.events = [];
}

export function beginReplayCapture(replay, ingestId, bootstrapPayload) {
  resetReplayCapture(replay);
  replay.ingest_id = ingestId;
  replay.active = true;
  replay.started_at_ms = Date.now();
  replay.events.push({
    event: 'bootstrap',
    at_ms: 0,
    payload: bootstrapPayload,
  });
}

export function recordReplayEvent(replay, event, payload) {
  if (!replay?.active) return;
  if (!['progress', 'patch', 'complete'].includes(event)) return;
  replay.events.push({
    event,
    at_ms: Math.max(0, Date.now() - replay.started_at_ms),
    payload,
  });
  if (event === 'complete') {
    replay.active = false;
    replay.available = true;
    replay.completed_at_ms = Date.now();
  }
}

export function failReplayCapture(replay) {
  if (!replay) return;
  replay.active = false;
  replay.available = false;
}

export function getReplaySnapshot(replay) {
  if (!replay?.available || !replay.events.length) return null;
  const [bootstrap, ...rest] = replay.events;
  const durationMs = replay.events[replay.events.length - 1]?.at_ms || 0;
  return {
    ready: true,
    ingest_id: replay.ingest_id,
    started_at_ms: replay.started_at_ms,
    completed_at_ms: replay.completed_at_ms,
    duration_ms: durationMs,
    bootstrap: bootstrap ? {
      event: bootstrap.event,
      at_ms: bootstrap.at_ms,
      payload: clonePayload(bootstrap.payload),
    } : null,
    events: rest.map((event) => ({
      event: event.event,
      at_ms: event.at_ms,
      mode: event.event === 'patch' ? 'patch' : 'progress',
      payload: clonePayload(event.payload),
    })),
  };
}
