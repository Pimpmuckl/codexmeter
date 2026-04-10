import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAggregates, buildSessionView } from '../server/aggregator.js';
import { classifyAgentFamily, deriveAgentRole, isReviewLauncherSession } from '../server/normalize.js';
import { filterVisibleSessions, pickVisibleDateBucket, selectEnrichmentCandidates } from '../server/ingest.js';

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

test('default sentinel still allows review-role inference', () => {
  const agentRole = deriveAgentRole('default', 'cli', REVIEW_TITLE);
  assert.equal(agentRole, 'review');
  assert.equal(classifyAgentFamily(agentRole), 'review');
});

test('broader review task titles still classify as review', () => {
  const titles = [
    'Brief review for commit range abc123..def456 in /home/jonat/code/demo.',
    'Independent brief review of current HEAD of codex/demo in /home/jonat/code/demo.',
    'Tight-scope integration review for /home/jonat/code/demo current diff.',
    'PR-scope review for /home/jonat/code/demo on branch feat/demo.',
    'Implementation-review preflight for /home/jonat/code/demo.',
  ];

  for (const title of titles) {
    const agentRole = deriveAgentRole(null, 'cli', title);
    assert.equal(agentRole, 'review');
    assert.equal(classifyAgentFamily(agentRole), 'review');
  }
});

test('review exec and cli launcher sessions are suppressed while real review sessions remain', () => {
  const launcher = {
    source_raw: 'exec',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };
  const cliLauncher = {
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };
  const realReview = {
    rollout_path: 'C:/tmp/review.jsonl',
    materialized: false,
    source_raw: '{"subagent":"review"}',
    title: REVIEW_TITLE,
    model_name: 'gpt-5.4',
    usage_total: { total_tokens: 1000 },
    has_usage_by_day: true,
    tokens_used: 1000,
  };

  assert.equal(isReviewLauncherSession(launcher), true);
  assert.equal(isReviewLauncherSession(cliLauncher), true);
  assert.equal(isReviewLauncherSession(realReview), false);
});

test('codex-cli launcher source still counts as a launcher stub', () => {
  const launcher = {
    source_raw: 'codex-cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    elapsed_seconds: null,
    active_by_day: null,
    tokens_used: 0,
  };

  assert.equal(isReviewLauncherSession(launcher), true);
});

test('pre-enrichment rollout-backed review rows are not hidden as launchers', () => {
  const pendingReview = {
    rollout_path: 'C:/tmp/review.jsonl',
    materialized: false,
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };

  assert.equal(isReviewLauncherSession(pendingReview), false);
});

test('materialized zero-token review rows with elapsed activity are suppressed as launcher stubs', () => {
  const timedReview = {
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    elapsed_seconds: 120,
    active_by_day: { '2026-04-10': 120 },
    tokens_used: 0,
  };

  assert.equal(isReviewLauncherSession(timedReview), true);
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

test('review launcher stubs are excluded from bootstrap/live-visible sessions', () => {
  const launcher = {
    thread_id: 'launcher',
    source_raw: 'exec',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };
  const realReview = {
    thread_id: 'review-child',
    source_raw: '{"subagent":"review"}',
    title: REVIEW_TITLE,
    model_name: 'gpt-5.4',
    usage_total: { total_tokens: 1000 },
    has_usage_by_day: true,
    tokens_used: 1000,
  };

  const visible = filterVisibleSessions([launcher, realReview]);

  assert.deepEqual(visible.map((session) => session.thread_id), ['review-child']);
});

test('timed zero-token review launcher rows are excluded from bootstrap/live-visible sessions', () => {
  const launcher = {
    thread_id: 'launcher',
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    elapsed_seconds: 120,
    active_by_day: { '2026-04-10': 120 },
    tokens_used: 0,
  };
  const realReview = {
    thread_id: 'review-child',
    source_raw: '{"subagent":"review"}',
    title: REVIEW_TITLE,
    model_name: 'gpt-5.4',
    usage_total: { total_tokens: 1000 },
    has_usage_by_day: true,
    tokens_used: 1000,
  };

  const visible = filterVisibleSessions([launcher, realReview]);

  assert.deepEqual(visible.map((session) => session.thread_id), ['review-child']);
});

test('progress bucket ignores hidden launcher rows', () => {
  const hiddenBuffered = { thread_id: 'launcher', live_sort_day: '2026-04-09' };
  const visibleReady = { thread_id: 'review-child', live_sort_day: '2026-04-10' };

  const bucket = pickVisibleDateBucket(
    filterVisibleSessions([{ ...hiddenBuffered, source_raw: 'cli', title: REVIEW_TITLE, model_name: null, usage_total: null, has_usage_by_day: false, tokens_used: 0 }]),
    filterVisibleSessions([{ ...visibleReady, source_raw: '{"subagent":"review"}', title: REVIEW_TITLE, model_name: 'gpt-5.4', usage_total: { total_tokens: 1000 }, has_usage_by_day: true, tokens_used: 1000 }])
  );

  assert.equal(bucket, '2026-04-10');
});

test('hidden launcher roots still anchor the grouped session view', () => {
  const launcher = {
    thread_id: 'launcher',
    root_thread_id: 'launcher',
    parent_thread_id: null,
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
    repo_key: 'repo:demo',
    repo_label: 'demo',
    started_at: 1,
    ended_at: 2,
    elapsed_seconds: 0,
    active_by_day: null,
    agent_role: 'default',
    agent_nickname: null,
    agent_family: 'generic',
    reasoning_effort: null,
    model_provider: 'openai',
    cost: null,
    cost_source: 'unavailable',
    is_subagent: false,
    materialized: true,
    cli_version: '0.118.0',
  };
  const child = {
    ...launcher,
    thread_id: 'review-child',
    root_thread_id: 'launcher',
    parent_thread_id: 'launcher',
    source_raw: '{"subagent":"review"}',
    model_name: 'gpt-5.4',
    usage_total: { total_tokens: 1000 },
    has_usage_by_day: true,
    tokens_used: 1000,
    elapsed_seconds: 60,
    active_by_day: { '2026-04-10': 60 },
    agent_role: 'review',
    agent_family: 'review',
    is_subagent: true,
    cost: 1,
    cost_source: 'exact',
  };

  const visible = filterVisibleSessions([launcher, child]);
  const grouped = buildSessionView(visible, [launcher, child]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].thread_id, 'launcher');
  assert.equal(grouped[0].root_thread_id, 'launcher');
  assert.equal(grouped[0].subagent_count, 1);
  assert.equal(grouped[0].title, REVIEW_TITLE);
  assert.equal(grouped[0].agent_family, 'review');
  assert.equal(grouped[0].model_name, 'gpt-5.4');
});

test('enrichment candidates keep rollout-backed review rows before visibility filtering', () => {
  const pendingReview = {
    thread_id: 'pending-review',
    rollout_path: 'C:/tmp/review.jsonl',
    started_at: 2,
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };
  const launcher = {
    thread_id: 'launcher',
    rollout_path: null,
    started_at: 1,
    source_raw: 'cli',
    title: REVIEW_TITLE,
    model_name: null,
    usage_total: null,
    has_usage_by_day: false,
    tokens_used: 0,
  };

  const candidates = selectEnrichmentCandidates([pendingReview, launcher]);

  assert.deepEqual(candidates.map((session) => session.thread_id), ['pending-review']);
});
