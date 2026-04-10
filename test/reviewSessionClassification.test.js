import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregates } from '../server/aggregator.js';
import { classifyAgentFamily, deriveAgentRole, isReviewLauncherSession } from '../server/normalize.js';

const REVIEW_TITLE = "Review the code changes against the base branch 'main'.";

test('subagent review source infers review family without sqlite agent_role', () => {
  const agentRole = deriveAgentRole(null, '{"subagent":"review"}');
  assert.equal(agentRole, 'review');
  assert.equal(classifyAgentFamily(agentRole), 'review');
});

test('review task title falls back to review family when source is plain cli', () => {
  const agentRole = deriveAgentRole(null, 'cli', REVIEW_TITLE);
  assert.equal(agentRole, 'review');
  assert.equal(classifyAgentFamily(agentRole), 'review');
});

test('review exec launcher sessions are suppressed while real review sessions remain', () => {
  const launcher = {
    source_raw: 'exec',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };
  const realReview = {
    source_raw: '{"subagent":"review"}',
    title: REVIEW_TITLE,
    model_name: 'gpt-5.4',
    usage_total: { total_tokens: 1000 },
    has_usage_by_day: true,
    tokens_used: 1000,
  };

  assert.equal(isReviewLauncherSession(launcher), true);
  assert.equal(isReviewLauncherSession(realReview), false);
});

test('review launcher stubs do not pollute family aggregates', () => {
  const sessions = [
    {
      thread_id: 'launcher',
      root_thread_id: 'launcher',
      source_raw: 'exec',
      repo_key: 'repo:demo',
      repo_label: 'demo',
      started_at: 1,
      ended_at: 2,
      elapsed_seconds: null,
      tokens_used: 0,
      model_provider: 'openai',
      model_name: null,
      reasoning_effort: null,
      usage_total: null,
      usage_by_day: null,
      has_usage_by_day: false,
      live_sort_ts: null,
      active_by_day: null,
      agent_role: null,
      agent_nickname: null,
      agent_family: 'generic',
      is_subagent: false,
      parent_thread_id: null,
      cost: null,
      cost_source: 'unavailable',
      materialized: true,
      title: REVIEW_TITLE,
      cli_version: '0.118.0',
    },
    {
      thread_id: 'review-child',
      root_thread_id: 'review-child',
      source_raw: '{"subagent":"review"}',
      repo_key: 'repo:demo',
      repo_label: 'demo',
      started_at: 3,
      ended_at: 4,
      elapsed_seconds: 60,
      tokens_used: 1000,
      model_provider: 'openai',
      model_name: 'gpt-5.4',
      reasoning_effort: 'high',
      usage_total: { total_tokens: 1000 },
      usage_by_day: [{ day: '2026-04-10', tokens: 1000, cost: 1 }],
      has_usage_by_day: true,
      live_sort_ts: null,
      active_by_day: { '2026-04-10': 60 },
      agent_role: 'review',
      agent_nickname: null,
      agent_family: 'review',
      is_subagent: true,
      parent_thread_id: null,
      cost: 1,
      cost_source: 'exact',
      materialized: true,
      title: REVIEW_TITLE,
      cli_version: '0.118.0',
    },
  ].filter((session) => !isReviewLauncherSession(session));

  const aggregates = buildAggregates(sessions, 'Europe/Berlin');

  assert.equal(aggregates.families.total.length, 1);
  assert.equal(aggregates.families.total[0].family, 'review');
  assert.equal(aggregates.families.total[0].tokens, 1000);
});
