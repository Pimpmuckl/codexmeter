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
