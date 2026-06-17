import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { buildAggregates } from '../server/aggregator.js';
import {
  applyForkUsageCorrection,
  createPartialAggregateSessions,
  getForkLineageParentThreadId,
  isSafeForPartialAggregation,
  selectForkParentUsageEntry,
} from '../server/ingest.js';
import { enrichFromRollout, findUsageAtOrBefore, readUsageTimeline } from '../server/rollout-reader.js';

function makeForkedSession(overrides = {}) {
  return {
    thread_id: 'child',
    root_thread_id: 'child',
    forked_from_id: 'parent',
    repo_key: 'repo:demo',
    repo_label: 'demo',
    model_name: 'gpt-5.4',
    agent_family: 'review',
    agent_role: 'review_brief',
    agent_nickname: 'reviewer',
    reasoning_effort: 'high',
    started_at: Date.parse('2026-03-15T21:35:55Z') / 1000,
    ended_at: Date.parse('2026-03-15T21:44:19Z') / 1000,
    elapsed_seconds: 480,
    active_by_day: { '2026-03-15': 480 },
    tokens_used: 466_373_912,
    cost: null,
    cost_source: 'unavailable',
    has_usage_by_day: true,
    usage_by_day: [],
    usage_total: {
      input_tokens: 464_981_155,
      cached_input_tokens: 439_950_720,
      output_tokens: 1_392_757,
      reasoning_output_tokens: 429_616,
      total_tokens: 466_373_912,
    },
    _usage_by_day_raw: {
      '2026-03-15': {
        input_tokens: 464_981_155,
        cached_input_tokens: 439_950_720,
        output_tokens: 1_392_757,
      },
    },
    title: 'Forked review task',
    ...overrides,
  };
}

test('fork usage correction removes inherited parent totals from child usage', () => {
  const session = makeForkedSession();
  const changed = applyForkUsageCorrection(session, {
    input_tokens: 451_828_093,
    cached_input_tokens: 438_209_280,
    output_tokens: 856_894,
    reasoning_output_tokens: 0,
    total_tokens: 452_684_987,
  });

  assert.equal(changed, true);
  assert.equal(session.tokens_used, 13_688_925);
  assert.deepEqual(session.usage_total, {
    input_tokens: 13_153_062,
    cached_input_tokens: 1_741_440,
    output_tokens: 535_863,
    reasoning_output_tokens: 429_616,
    total_tokens: 13_688_925,
  });
  assert.deepEqual(session._usage_by_day_raw, {
    '2026-03-15': {
      input_tokens: 13_153_062,
      cached_input_tokens: 1_741_440,
      output_tokens: 535_863,
    },
  });
});

test('fork usage correction preserves a valid cached/input mix after subtraction', () => {
  const session = makeForkedSession({
    usage_total: {
      input_tokens: 100,
      cached_input_tokens: 90,
      output_tokens: 7,
      reasoning_output_tokens: 0,
      total_tokens: 107,
    },
    _usage_by_day_raw: {
      '2026-03-15': {
        input_tokens: 100,
        cached_input_tokens: 90,
        output_tokens: 7,
      },
    },
    tokens_used: 107,
  });

  applyForkUsageCorrection(session, {
    input_tokens: 95,
    cached_input_tokens: 80,
    output_tokens: 1,
    reasoning_output_tokens: 0,
    total_tokens: 96,
  });

  assert.deepEqual(session.usage_total, {
    input_tokens: 10,
    cached_input_tokens: 10,
    output_tokens: 6,
    reasoning_output_tokens: 0,
    total_tokens: 16,
  });
  assert.deepEqual(session._usage_by_day_raw, {
    '2026-03-15': {
      input_tokens: 10,
      cached_input_tokens: 10,
      output_tokens: 6,
    },
  });
});

test('daily aggregates reflect corrected incremental fork usage instead of inherited totals', () => {
  const session = makeForkedSession();
  applyForkUsageCorrection(session, {
    input_tokens: 451_828_093,
    cached_input_tokens: 438_209_280,
    output_tokens: 856_894,
    reasoning_output_tokens: 0,
    total_tokens: 452_684_987,
  });
  session.usage_by_day = [{ day: '2026-03-15', tokens: session.tokens_used, cost: 0 }];

  const aggregates = buildAggregates([session], 'Europe/Berlin');
  const day = aggregates.daily.find((entry) => entry.date === '2026-03-15');

  assert.ok(day);
  assert.equal(day.tokens, 13_688_925);
  assert.equal(day.by_family.review.tokens, 13_688_925);
  assert.equal(day.by_model['gpt-5.4'].tokens, 13_688_925);
  assert.equal(day.by_repo.demo.tokens, 13_688_925);
});

test('daily bucket subtraction preserves valid cached/input ratios across multiple days', () => {
  const session = makeForkedSession({
    usage_total: {
      input_tokens: 105,
      cached_input_tokens: 90,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 115,
    },
    _usage_by_day_raw: {
      '2026-03-14': {
        input_tokens: 95,
        cached_input_tokens: 80,
        output_tokens: 1,
      },
      '2026-03-15': {
        input_tokens: 10,
        cached_input_tokens: 10,
        output_tokens: 9,
      },
    },
    tokens_used: 115,
  });

  applyForkUsageCorrection(session, {
    input_tokens: 95,
    cached_input_tokens: 80,
    output_tokens: 1,
    reasoning_output_tokens: 0,
    total_tokens: 96,
  });

  assert.deepEqual(session._usage_by_day_raw, {
    '2026-03-15': {
      input_tokens: 10,
      cached_input_tokens: 10,
      output_tokens: 9,
    },
  });
});

test('fork lineage correction follows spawn-edge parent metadata', () => {
  const session = makeForkedSession({
    forked_from_id: null,
    parent_thread_id: 'spawn-edge-parent',
  });

  assert.equal(getForkLineageParentThreadId(session), 'spawn-edge-parent');
});

test('explicit fork metadata wins over spawn-edge parent metadata', () => {
  const session = makeForkedSession({
    forked_from_id: 'explicit-fork-parent',
    parent_thread_id: 'spawn-edge-parent',
  });

  assert.equal(getForkLineageParentThreadId(session), 'explicit-fork-parent');
});

test('partial aggregates skip unmaterialized fork children without mutating canonical sessions', () => {
  const toDayKey = () => '2026-03-15';
  const parent = makeForkedSession({
    thread_id: 'parent',
    forked_from_id: null,
    parent_thread_id: null,
    rollout_path: 'parent.jsonl',
    elapsed_seconds: null,
    active_by_day: null,
    model_name: 'gpt-5.5',
    usage_total: null,
    usage_by_day: null,
    has_usage_by_day: false,
    cost: null,
    cost_source: 'unavailable',
    materialized: false,
  });
  const child = makeForkedSession({
    thread_id: 'child',
    forked_from_id: null,
    parent_thread_id: 'parent',
    rollout_path: 'child.jsonl',
    elapsed_seconds: null,
    active_by_day: null,
    model_name: null,
    usage_total: null,
    usage_by_day: null,
    has_usage_by_day: false,
    cost: null,
    cost_source: 'unavailable',
    materialized: false,
  });

  const partial = createPartialAggregateSessions([parent, child], toDayKey);

  assert.equal(isSafeForPartialAggregation(parent), true);
  assert.equal(isSafeForPartialAggregation(child), false);
  assert.deepEqual(partial.map((session) => session.thread_id), ['parent']);
  assert.equal(partial[0].model_name, null);
  assert.equal(partial[0].elapsed_seconds, 504);
  assert.equal(partial[0].cost, null);
  assert.deepEqual(partial[0].usage_by_day, []);
  assert.equal(parent.elapsed_seconds, null);
  assert.equal(parent.cost, null);

  const aggregates = buildAggregates(partial, 'Europe/Berlin', null, {
    includeUnknownModels: false,
  });
  assert.deepEqual(aggregates.models.total, []);
  assert.equal(aggregates.daily.reduce((sum, day) => sum + day.tokens, 0), 0);
});

test('usage lookup works even when timeline entries are not pre-sorted', () => {
  const usage = findUsageAtOrBefore([
    { timestamp: 300, usage: { total_tokens: 30 } },
    { timestamp: 100, usage: { total_tokens: 10 } },
    { timestamp: 200, usage: { total_tokens: 20 } },
  ].sort((a, b) => b.timestamp - a.timestamp), 250);

  assert.deepEqual(usage, { total_tokens: 20 });
});

test('rollout usage resets discard inherited pre-reset totals instead of double-counting them', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-03-04T17:19:25.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 90, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:26.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 180, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 210 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:27.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20, cached_input_tokens: 15, output_tokens: 2, reasoning_output_tokens: 0, total_tokens: 22 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:28.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 70, cached_input_tokens: 55, output_tokens: 4, reasoning_output_tokens: 0, total_tokens: 74 } } },
      }),
      '',
    ].join('\n'));

    const data = await enrichFromRollout(rolloutPath, { timezone: 'Europe/Berlin' });

    assert.deepEqual(data.usage_total, {
      input_tokens: 70,
      cached_input_tokens: 55,
      output_tokens: 4,
      reasoning_output_tokens: 0,
      total_tokens: 74,
    });
    assert.equal(data.usage_reset_detected, true);
    assert.equal(data.first_usage_timestamp, Date.parse('2026-03-04T17:19:27.000Z'));
    assert.deepEqual(data.usage_by_day, {
      '2026-03-04': {
        input_tokens: 70,
        cached_input_tokens: 55,
        output_tokens: 4,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reasoning-only token events still establish the first usage timestamp', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-03-04T17:19:25.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 12, total_tokens: 12 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:26.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 40, cached_input_tokens: 10, output_tokens: 4, reasoning_output_tokens: 12, total_tokens: 44 } } },
      }),
      '',
    ].join('\n'));

    const data = await enrichFromRollout(rolloutPath, { timezone: 'Europe/Berlin' });

    assert.equal(data.first_usage_timestamp, Date.parse('2026-03-04T17:19:25.000Z'));
    assert.deepEqual(data.usage_by_day, {
      '2026-03-04': {
        input_tokens: 40,
        cached_input_tokens: 10,
        output_tokens: 4,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rollout active seconds split across timezone midnight', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-04-10T21:59:50.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', effort: 'medium' },
      }),
      JSON.stringify({
        timestamp: '2026-04-10T22:00:10.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', effort: 'medium' },
      }),
      '',
    ].join('\n'));

    const data = await enrichFromRollout(rolloutPath, { timezone: 'Europe/Berlin' });

    assert.deepEqual(data.active_by_day, {
      '2026-04-10': 10,
      '2026-04-11': 10,
    });
    assert.equal(data.active_seconds, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rg rollout scan falls back when timestamp coverage is partial', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-04-10T21:59:50.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', effort: 'medium' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 10,
              output_tokens: 4,
              reasoning_output_tokens: 0,
              total_tokens: 44,
            },
          },
        },
        timestamp: '2026-04-10T22:00:10.000Z',
      }),
      '',
    ].join('\n'));

    const data = await enrichFromRollout(rolloutPath, {
      timezone: 'Europe/Berlin',
      fastScan: true,
      rgScan: true,
      rgMinBytes: 0,
    });

    assert.equal(data.first_timestamp, Date.parse('2026-04-10T21:59:50.000Z'));
    assert.equal(data.last_timestamp, Date.parse('2026-04-10T22:00:10.000Z'));
    assert.equal(data.active_seconds, 20);
    assert.equal(data.first_usage_timestamp, Date.parse('2026-04-10T22:00:10.000Z'));
    assert.deepEqual(data.usage_by_day, {
      '2026-04-11': { input_tokens: 40, cached_input_tokens: 10, output_tokens: 4 },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fast rollout scan still counts timestamped irrelevant lines', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-04-10T21:59:50.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.4', effort: 'medium' },
      }),
      JSON.stringify({
        timestamp: '2026-04-10T22:00:10.000Z',
        type: 'event_msg',
        payload: { type: 'agent_reasoning_delta' },
      }),
      '',
    ].join('\n'));

    const data = await enrichFromRollout(rolloutPath, {
      timezone: 'Europe/Berlin',
      fastScan: true,
    });

    assert.equal(data.first_timestamp, Date.parse('2026-04-10T21:59:50.000Z'));
    assert.equal(data.last_timestamp, Date.parse('2026-04-10T22:00:10.000Z'));
    assert.equal(data.active_seconds, 20);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('usage timeline preserves resets while timestamp lookup resolves the correct segment', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codexmeter-rollout-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  try {
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-03-04T17:19:25.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 90, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:26.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 200, cached_input_tokens: 180, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 210 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:27.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 20, cached_input_tokens: 15, output_tokens: 2, reasoning_output_tokens: 0, total_tokens: 22 } } },
      }),
      JSON.stringify({
        timestamp: '2026-03-04T17:19:28.000Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 70, cached_input_tokens: 55, output_tokens: 4, reasoning_output_tokens: 0, total_tokens: 74 } } },
      }),
      '',
    ].join('\n'));

    const timeline = await readUsageTimeline(rolloutPath);

    assert.equal(timeline.length, 4);
    assert.deepEqual(findUsageAtOrBefore(timeline, Date.parse('2026-03-04T17:19:26.500Z')), {
      input_tokens: 200,
      cached_input_tokens: 180,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      total_tokens: 210,
    });
    assert.deepEqual(findUsageAtOrBefore(timeline, Date.parse('2026-03-04T17:19:27.500Z')), {
      input_tokens: 20,
      cached_input_tokens: 15,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 22,
    });
    assert.deepEqual(timeline.map(({ segment_id, usage }) => ({ segment_id, total: usage.total_tokens })), [
      { segment_id: 0, total: 105 },
      { segment_id: 0, total: 210 },
      { segment_id: 1, total: 22 },
      { segment_id: 1, total: 74 },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fork parent usage selection falls back to the pre-reset segment when needed', () => {
  const timeline = [
    { timestamp: 1_000, segment_id: 0, usage: { total_tokens: 100, input_tokens: 90, cached_input_tokens: 80, output_tokens: 10, reasoning_output_tokens: 0 } },
    { timestamp: 2_000, segment_id: 1, usage: { total_tokens: 20, input_tokens: 18, cached_input_tokens: 10, output_tokens: 2, reasoning_output_tokens: 0 } },
    { timestamp: 3_000, segment_id: 1, usage: { total_tokens: 30, input_tokens: 25, cached_input_tokens: 12, output_tokens: 5, reasoning_output_tokens: 0 } },
  ];

  assert.deepEqual(
    selectForkParentUsageEntry(timeline, { startedAtMs: 1_500, firstUsageTimestampMs: 2_500 }),
    timeline[0],
  );
  assert.deepEqual(
    selectForkParentUsageEntry(timeline, { startedAtMs: 2_500, firstUsageTimestampMs: 3_000 }),
    timeline[2],
  );
});

test('fork usage correction can still adjust aggregate token totals without detailed usage_total', () => {
  const session = {
    thread_id: 'child-no-usage-total',
    tokens_used: 1_000,
    usage_total: null,
    _usage_by_day_raw: null,
  };

  const changed = applyForkUsageCorrection(session, {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 600,
  });

  assert.equal(changed, true);
  assert.equal(session.tokens_used, 400);
});
