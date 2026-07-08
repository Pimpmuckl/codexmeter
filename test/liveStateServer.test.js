import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySessionToLiveState,
  buildLiveBootstrap,
  createLiveAggregateState,
} from '../server/live-state.js';

test('live top summaries include drilldown breakdowns', () => {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    thread_id: 'thread-1',
    root_thread_id: 'thread-1',
    repo_key: 'repo:demo',
    repo_label: 'demo',
    model_name: 'gpt-5.4',
    agent_family: 'review',
    reasoning_effort: 'x-high',
    started_at: now - 120,
    ended_at: now,
    elapsed_seconds: 120,
    tokens_used: 1200,
    cost: 1.2,
    cost_source: 'exact',
    has_usage_by_day: false,
  };
  const live = createLiveAggregateState('UTC');

  applySessionToLiveState(live, session);
  const bootstrap = buildLiveBootstrap(live);
  const repo = bootstrap.repos.total[0];
  const model = bootstrap.models.total[0];

  assert.equal(repo.by_model['gpt-5.4'].tokens, 1200);
  assert.equal(repo.by_family.review.sessions, 1);
  assert.equal(model.by_effort.xhigh.tokens, 1200);
  assert.equal(model.by_effort.xhigh.exact_priced, 1);
});

test('live model summaries preserve max reasoning effort', () => {
  const now = Math.floor(Date.now() / 1000);
  const session = {
    thread_id: 'thread-56',
    root_thread_id: 'thread-56',
    repo_key: 'repo:demo',
    repo_label: 'demo',
    model_name: 'gpt-5.6-sol',
    agent_family: 'review',
    reasoning_effort: 'max',
    started_at: now - 60,
    ended_at: now,
    elapsed_seconds: 60,
    tokens_used: 500,
    cost: 0.5,
    cost_source: 'exact',
    has_usage_by_day: false,
  };
  const live = createLiveAggregateState('UTC');
  const patch = createEmptyLivePatch();

  applySessionToLiveState(live, session, patch);
  const model = buildLiveBootstrap(live).models.total[0];

  assert.equal(model.model_name, 'gpt-5.6-sol');
  assert.equal(model.by_effort.max.tokens, 500);
});
