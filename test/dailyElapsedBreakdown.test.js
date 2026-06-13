import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregates } from '../server/aggregator.js';
import { createLiveAggregateState, createEmptyLivePatch, applySessionToLiveState, buildLiveBootstrap } from '../server/live-state.js';
import { splitIntervalByDay } from '../server/day-key.js';

function makeSession() {
  return {
    thread_id: 'thread-1',
    root_thread_id: 'thread-1',
    repo_key: 'repo:demo',
    repo_label: 'demo',
    model_name: 'gpt-5.4',
    agent_family: 'review',
    agent_role: 'review_fast',
    agent_nickname: 'reviewer',
    reasoning_effort: 'high',
    started_at: 1_744_243_200,
    ended_at: 1_744_246_800,
    elapsed_seconds: 3600,
    active_by_day: { '2025-04-10': 3600 },
    tokens_used: 1_500_000,
    cost: 2.5,
    cost_source: 'exact',
    title: 'Review the code changes',
    has_usage_by_day: true,
    usage_by_day: [{ day: '2025-04-10', tokens: 1_500_000, cost: 2.5 }],
  };
}

test('daily aggregates include elapsed seconds for model and family breakdowns', () => {
  const session = makeSession();
  const aggregates = buildAggregates([session], 'Europe/Berlin');
  const day = aggregates.daily.find((entry) => entry.date === '2025-04-10');

  assert.ok(day);
  assert.equal(day.elapsed_seconds, 3600);
  assert.equal(day.by_model['gpt-5.4'].elapsed_seconds, 3600);
  assert.equal(day.by_family.review.elapsed_seconds, 3600);
  assert.equal(day.by_repo.demo.elapsed_seconds, 3600);
});

test('live daily bootstrap includes elapsed seconds for model and family breakdowns', () => {
  const session = makeSession();
  const live = createLiveAggregateState('Europe/Berlin');
  const patch = createEmptyLivePatch();

  applySessionToLiveState(live, session, patch);
  const bootstrap = buildLiveBootstrap(live);
  const day = bootstrap.daily['2025-04-10'];

  assert.ok(day);
  assert.equal(day.elapsed_seconds, 3600);
  assert.equal(day.by_model['gpt-5.4'].elapsed_seconds, 3600);
  assert.equal(day.by_family.review.elapsed_seconds, 3600);
  assert.equal(day.by_repo.demo.elapsed_seconds, 3600);
});

test('timezone intervals split at the requested local midnight', () => {
  const parts = splitIntervalByDay(
    Date.parse('2026-04-10T21:59:50Z'),
    Date.parse('2026-04-10T22:00:10Z'),
    'Europe/Berlin'
  );

  assert.deepEqual(parts, [
    { dayKey: '2026-04-10', overlapMs: 10_000 },
    { dayKey: '2026-04-11', overlapMs: 10_000 },
  ]);
});

test('settled and live daily buckets split sessions across timezone midnight', () => {
  const session = {
    ...makeSession(),
    started_at: Date.parse('2026-04-10T21:59:50Z') / 1000,
    ended_at: Date.parse('2026-04-10T22:00:10Z') / 1000,
    elapsed_seconds: null,
    active_by_day: null,
    tokens_used: 200,
    cost: 2,
    has_usage_by_day: false,
    usage_by_day: null,
  };

  const aggregates = buildAggregates([session], 'Europe/Berlin');
  const settledByDay = new Map(aggregates.daily.map((entry) => [entry.date, entry]));
  assert.equal(settledByDay.get('2026-04-10')?.tokens, 100);
  assert.equal(settledByDay.get('2026-04-11')?.tokens, 100);
  assert.equal(settledByDay.get('2026-04-10')?.sessions, 1);
  assert.equal(settledByDay.get('2026-04-11')?.sessions, 1);
  assert.equal(aggregates.heatmap['2026-04-10']?.tokens, 100);
  assert.equal(aggregates.heatmap['2026-04-11']?.tokens, 100);
  assert.equal(aggregates.heatmap['2026-04-10']?.sessions, 1);
  assert.equal(aggregates.heatmap['2026-04-11']?.sessions, 1);

  const live = createLiveAggregateState('Europe/Berlin');
  const patch = createEmptyLivePatch();
  applySessionToLiveState(live, session, patch);
  const bootstrap = buildLiveBootstrap(live);
  assert.equal(bootstrap.daily['2026-04-10']?.tokens, 100);
  assert.equal(bootstrap.daily['2026-04-11']?.tokens, 100);
  assert.equal(bootstrap.daily['2026-04-10']?.sessions, 1);
  assert.equal(bootstrap.daily['2026-04-11']?.sessions, 1);
  assert.equal(bootstrap.heatmap['2026-04-10']?.tokens, 100);
  assert.equal(bootstrap.heatmap['2026-04-11']?.tokens, 100);
  assert.equal(bootstrap.heatmap['2026-04-10']?.sessions, 1);
  assert.equal(bootstrap.heatmap['2026-04-11']?.sessions, 1);
});

test('daily elapsed breakdowns use raw session metadata for mixed roots', () => {
  const root = {
    ...makeSession(),
    thread_id: 'root',
    root_thread_id: 'root',
    repo_label: 'nextide-web',
    repo_key: 'repo:nextide-web',
    model_name: 'gpt-5.3-codex',
    agent_family: 'generic',
    agent_role: null,
    tokens_used: 0,
    cost: 0,
    has_usage_by_day: false,
    usage_by_day: null,
    elapsed_seconds: 600,
    active_by_day: { '2025-04-10': 600 },
  };
  const child = {
    ...makeSession(),
    thread_id: 'child',
    root_thread_id: 'root',
    repo_label: '.codex',
    repo_key: 'repo:.codex',
    model_name: 'gpt-5.4',
    agent_family: 'review',
    agent_role: 'review_brief',
    tokens_used: 1000,
    cost: 1,
    has_usage_by_day: true,
    usage_by_day: [{ day: '2025-04-10', tokens: 1000, cost: 1 }],
    elapsed_seconds: 1800,
    active_by_day: { '2025-04-10': 1800 },
  };

  const aggregates = buildAggregates([root, child], 'Europe/Berlin');
  const day = aggregates.daily.find((entry) => entry.date === '2025-04-10');

  assert.ok(day);
  assert.equal(day.elapsed_seconds, 2400);
  assert.equal(day.by_family.generic.elapsed_seconds, 600);
  assert.equal(day.by_family.review.elapsed_seconds, 1800);
  assert.equal(day.by_model['gpt-5.3-codex'].elapsed_seconds, 600);
  assert.equal(day.by_model['gpt-5.4'].elapsed_seconds, 1800);
  assert.equal(day.by_repo['nextide-web'].elapsed_seconds, 600);
  assert.equal(day.by_repo['.codex'].elapsed_seconds, 1800);
});
