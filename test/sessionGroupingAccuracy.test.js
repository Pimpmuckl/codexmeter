import test from 'node:test';
import assert from 'node:assert/strict';
import { assignRootThreadIds } from '../server/ingest.js';
import { buildAggregates, buildSessionView } from '../server/aggregator.js';
import { createDayKeyFormatter } from '../server/day-key.js';

const toDayKey = createDayKeyFormatter('Europe/Berlin');

function makeSession(overrides = {}) {
  return {
    thread_id: 'thread',
    parent_thread_id: null,
    root_thread_id: null,
    source_raw: 'cli',
    repo_key: 'repo:demo',
    repo_label: 'demo',
    started_at: 0,
    ended_at: 1,
    elapsed_seconds: 60,
    tokens_used: 100,
    model_provider: 'openai',
    model_name: 'gpt-5.4',
    reasoning_effort: 'medium',
    usage_total: { total_tokens: 100 },
    usage_by_day: null,
    has_usage_by_day: false,
    live_sort_ts: null,
    active_by_day: null,
    agent_role: 'assistant',
    agent_nickname: null,
    agent_family: 'generic',
    is_subagent: false,
    cost: 1,
    cost_source: 'exact',
    materialized: true,
    title: 'Demo task',
    cli_version: '0.119.0',
    ...overrides,
  };
}

test('same-day descendants inherit the same root thread id', () => {
  const sessions = [
    makeSession({
      thread_id: 'root',
      started_at: Date.parse('2026-03-05T09:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T10:00:00Z') / 1000,
    }),
    makeSession({
      thread_id: 'child-a',
      parent_thread_id: 'root',
      started_at: Date.parse('2026-03-05T12:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T12:30:00Z') / 1000,
    }),
    makeSession({
      thread_id: 'child-b',
      parent_thread_id: 'child-a',
      started_at: Date.parse('2026-03-05T15:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T15:30:00Z') / 1000,
    }),
  ];

  assignRootThreadIds(sessions, toDayKey);

  assert.deepEqual(
    sessions.map((session) => [session.thread_id, session.root_thread_id]),
    [
      ['root', 'root'],
      ['child-a', 'root'],
      ['child-b', 'root'],
    ]
  );
});

test('cross-day descendants start a new root thread id', () => {
  const sessions = [
    makeSession({
      thread_id: 'root',
      started_at: Date.parse('2026-03-05T20:30:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T21:30:00Z') / 1000,
    }),
    makeSession({
      thread_id: 'same-day-child',
      parent_thread_id: 'root',
      started_at: Date.parse('2026-03-05T21:45:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T21:50:00Z') / 1000,
    }),
    makeSession({
      thread_id: 'next-day-child',
      parent_thread_id: 'same-day-child',
      started_at: Date.parse('2026-03-05T23:10:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T23:40:00Z') / 1000,
    }),
    makeSession({
      thread_id: 'next-day-grandchild',
      parent_thread_id: 'next-day-child',
      started_at: Date.parse('2026-03-06T00:10:00Z') / 1000,
      ended_at: Date.parse('2026-03-06T00:40:00Z') / 1000,
    }),
  ];

  assignRootThreadIds(sessions, toDayKey);

  assert.deepEqual(
    sessions.map((session) => [session.thread_id, session.root_thread_id]),
    [
      ['root', 'root'],
      ['same-day-child', 'root'],
      ['next-day-child', 'next-day-child'],
      ['next-day-grandchild', 'next-day-child'],
    ]
  );
});

test('same-day grouping collapses multi-agent work while splitting the next day into a separate visible session', () => {
  const sessions = [
    makeSession({
      thread_id: 'root',
      started_at: Date.parse('2026-03-05T09:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T10:00:00Z') / 1000,
      tokens_used: 500,
      title: 'Main task',
    }),
    makeSession({
      thread_id: 'review-a',
      parent_thread_id: 'root',
      started_at: Date.parse('2026-03-05T11:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T11:30:00Z') / 1000,
      tokens_used: 700,
      agent_role: 'review',
      agent_family: 'review',
      title: 'Review task',
    }),
    makeSession({
      thread_id: 'review-b',
      parent_thread_id: 'review-a',
      started_at: Date.parse('2026-03-06T09:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-06T09:30:00Z') / 1000,
      tokens_used: 900,
      agent_role: 'review',
      agent_family: 'review',
      title: 'Next day review task',
    }),
  ];

  assignRootThreadIds(sessions, toDayKey);
  const grouped = buildSessionView(sessions);

  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((session) => ({
      thread_id: session.thread_id,
      root_thread_id: session.root_thread_id,
      thread_count: session.thread_count,
      tokens_used: session.tokens_used,
    })),
    [
      {
        thread_id: 'review-b',
        root_thread_id: 'review-b',
        thread_count: 1,
        tokens_used: 900,
      },
      {
        thread_id: 'root',
        root_thread_id: 'root',
        thread_count: 2,
        tokens_used: 1200,
      },
    ]
  );
});

test('mixed grouped sessions summarize visible metadata as mixed instead of projecting the root values', () => {
  const sessions = [
    makeSession({
      thread_id: 'root',
      started_at: Date.parse('2026-03-05T09:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T10:00:00Z') / 1000,
      model_name: 'gpt-5.3-codex',
      reasoning_effort: 'xhigh',
      agent_role: 'worker_fast',
      agent_family: 'generic',
    }),
    makeSession({
      thread_id: 'review-child',
      parent_thread_id: 'root',
      started_at: Date.parse('2026-03-05T11:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T11:30:00Z') / 1000,
      model_name: 'gpt-5.4',
      reasoning_effort: 'medium',
      agent_role: 'review_brief',
      agent_family: 'review',
      title: 'Review task',
    }),
  ];

  assignRootThreadIds(sessions, toDayKey);
  const grouped = buildSessionView(sessions);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].agent_family, 'mixed');
  assert.equal(grouped[0].model_name, 'mixed');
  assert.equal(grouped[0].reasoning_effort, 'mixed');
  assert.equal(grouped[0].agent_role, 'mixed');
});

test('aggregates can omit unknown model buckets without dropping session totals', () => {
  const sessions = [
    makeSession({
      thread_id: 'known',
      started_at: Date.parse('2026-03-05T09:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T09:30:00Z') / 1000,
      model_name: 'gpt-5.4',
      tokens_used: 100,
      cost: 1,
    }),
    makeSession({
      thread_id: 'unknown-model',
      started_at: Date.parse('2026-03-05T10:00:00Z') / 1000,
      ended_at: Date.parse('2026-03-05T10:30:00Z') / 1000,
      model_name: null,
      tokens_used: 200,
      cost: null,
      cost_source: 'unavailable',
    }),
  ];

  const aggregates = buildAggregates(sessions, 'Europe/Berlin', null, {
    includeUnknownModels: false,
  });
  const day = aggregates.daily.find((entry) => entry.date === '2026-03-05');
  const repo = aggregates.repos.total.find((entry) => entry.repo_label === 'demo');

  assert.equal(aggregates.overview.total.total_tokens, 300);
  assert.deepEqual(aggregates.models.total.map((entry) => entry.model_name), ['gpt-5.4']);
  assert.equal(day.tokens, 300);
  assert.equal(day.by_model.unknown, undefined);
  assert.equal(day.by_model['gpt-5.4'].tokens, 100);
  assert.equal(repo.tokens, 300);
  assert.equal(repo.by_model.unknown, undefined);
  assert.equal(repo.by_model['gpt-5.4'].tokens, 100);
});
