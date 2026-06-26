import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginReplayCapture,
  createReplayCaptureState,
  getReplaySnapshot,
  recordReplayEvent,
} from '../server/export-replay.js';

test('replay snapshot exposes completed replay and returns cloned payloads', () => {
  const replay = createReplayCaptureState();
  beginReplayCapture(replay, 'ingest-1', {
    ingest_id: 'ingest-1',
    seq: 0,
    progress: { percent: 0.1, complete: false },
    data: { overview: { total: { total_tokens: 10 } } },
  });
  recordReplayEvent(replay, 'snapshot', {
    ingest_id: 'ingest-1',
    seq: 1,
    progress: { percent: 0.5, complete: false },
    data: { overview: { total: { total_tokens: 50 } } },
  });
  recordReplayEvent(replay, 'complete', {
    ingest_id: 'ingest-1',
    seq: 2,
    progress: { percent: 1, complete: true },
  });

  const snapshot = getReplaySnapshot(replay);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events[0].mode, 'snapshot');
  assert.equal(snapshot.events[1].mode, 'progress');

  snapshot.bootstrap.payload.data.overview.total.total_tokens = 999;
  snapshot.events[0].payload.progress.percent = 0;

  const freshSnapshot = getReplaySnapshot(replay);
  assert.equal(freshSnapshot.bootstrap.payload.data.overview.total.total_tokens, 10);
  assert.equal(freshSnapshot.events[0].payload.progress.percent, 0.5);
});
