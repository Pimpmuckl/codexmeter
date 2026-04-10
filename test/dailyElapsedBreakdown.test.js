import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregates } from '../server/aggregator.js';
import { createLiveAggregateState, createEmptyLivePatch, applySessionToLiveState, buildLiveBootstrap } from '../server/live-state.js';

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
