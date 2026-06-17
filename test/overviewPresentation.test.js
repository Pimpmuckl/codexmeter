import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverviewPresentationTarget,
  resolveDailyRevealStartIndex,
  resolveDailyRevealTargetIndex,
} from '../src/utils/overviewPresentation.js';

test('overview d7 stats use the visible daily rows instead of the broader overlap bucket', () => {
  const presentation = buildOverviewPresentationTarget({
    overview: {
      data: {
        total: {
          total_tokens: 999,
          total_elapsed_seconds: 999,
          total_cost: 999,
          total_sessions: 9,
          coverage: { root_sessions: 9, enriched: 0, priced: 0, priced_exact: 0, priced_fallback: 0, unpriced: 0 },
          date_range: { from: 0, to: 0 },
        },
        d7: {
          total_tokens: 13_300_000_000,
          total_elapsed_seconds: 777_777,
          total_cost: 1234.5,
          total_sessions: 12,
          coverage: { root_sessions: 12, enriched: 0, priced: 0, priced_exact: 0, priced_fallback: 0, unpriced: 0 },
          date_range: { from: 1, to: 8 * 86400 },
        },
      },
    },
    daily: {
      data: [
        { date: '2026-04-01', tokens: 1, elapsed_seconds: 1, cost: 1, by_model: {} },
        { date: '2026-04-02', tokens: 2, elapsed_seconds: 2, cost: 2, by_model: {} },
        { date: '2026-04-03', tokens: 3, elapsed_seconds: 3, cost: 3, by_model: {} },
        { date: '2026-04-04', tokens: 4, elapsed_seconds: 4, cost: 4, by_model: {} },
        { date: '2026-04-05', tokens: 5, elapsed_seconds: 5, cost: 5, by_model: {} },
        { date: '2026-04-06', tokens: 6, elapsed_seconds: 6, cost: 6, by_model: {} },
        { date: '2026-04-07', tokens: 7, elapsed_seconds: 7, cost: 7, by_model: {} },
        { date: '2026-04-08', tokens: 8, elapsed_seconds: 8, cost: 8, by_model: {} },
      ],
    },
    heatmap: { data: {} },
    families: { data: { d7: [], total: [] } },
    repos: { data: { d7: [], total: [] } },
    models: { data: { d7: [], total: [] } },
    range: 'd7',
  });

  assert.equal(presentation.stats.tokens, 35);
  assert.equal(presentation.stats.elapsed, 35);
  assert.equal(presentation.stats.cost, 35);
  assert.equal(presentation.stats.days, 7);
  assert.equal(presentation.stats.sessions, 12);
});

test('overview total stats still use the overview aggregate bucket', () => {
  const presentation = buildOverviewPresentationTarget({
    overview: {
      data: {
        total: {
          total_tokens: 123,
          total_elapsed_seconds: 456,
          total_cost: 7.5,
          total_sessions: 3,
          coverage: { root_sessions: 3, enriched: 0, priced: 0, priced_exact: 0, priced_fallback: 0, unpriced: 0 },
          date_range: { from: 1, to: 3 * 86400 },
        },
      },
    },
    daily: {
      data: [
        { date: '2026-04-01', tokens: 10, elapsed_seconds: 10, cost: 10, by_model: {} },
        { date: '2026-04-02', tokens: 20, elapsed_seconds: 20, cost: 20, by_model: {} },
      ],
    },
    heatmap: { data: {} },
    families: { data: { total: [] } },
    repos: { data: { total: [] } },
    models: { data: { total: [] } },
    range: 'total',
  });

  assert.equal(presentation.stats.tokens, 123);
  assert.equal(presentation.stats.elapsed, 456);
  assert.equal(presentation.stats.cost, 7.5);
  assert.equal(presentation.stats.days, 3);
});

test('ingest daily reveal starts at the first parsed day', () => {
  const dates = [
    '2026-01-01',
    '2026-01-02',
    '2026-01-03',
    '2026-01-04',
  ];

  assert.equal(resolveDailyRevealStartIndex(dates, true), 0);
  assert.equal(resolveDailyRevealTargetIndex(dates, true, 0.08), 3);
  assert.equal(resolveDailyRevealStartIndex(dates, false), 3);
});
