import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLiveEnvelope, hasLiveRows, shouldUseLiveData } from '../src/live-state.js';

test('live ingest data wins over partial settled data', () => {
  const liveData = { daily: { data: [{ date: '2026-01-01', tokens: 10 }] } };

  assert.equal(shouldUseLiveData(liveData, { overviewIngestActive: true, settledOverviewReady: true }), true);
  assert.equal(shouldUseLiveData(liveData, { overviewIngestActive: false, settledOverviewReady: true }), false);
  assert.equal(shouldUseLiveData(liveData, { overviewIngestActive: false, settledOverviewReady: false }), true);
});

test('empty live sections do not hide settled tab rows', () => {
  const settledModels = {
    data: {
      total: [{ model_name: 'gpt-5', tokens: 100 }],
      d7: [],
      d30: [],
    },
  };
  const liveModels = {
    data: {
      total: [],
      d7: [],
      d30: [],
    },
  };
  const liveDaily = { data: [{ date: '2026-01-01', tokens: 100 }] };

  assert.equal(hasLiveRows(liveModels), false);
  assert.equal(hasLiveRows(liveDaily), true);
  assert.equal(chooseLiveEnvelope(liveModels, settledModels, true), settledModels);
  assert.equal(chooseLiveEnvelope(liveDaily, settledModels, true), liveDaily);
  assert.equal(chooseLiveEnvelope(liveDaily, settledModels, false), settledModels);
});
