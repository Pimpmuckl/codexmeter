import test from 'node:test';
import assert from 'node:assert/strict';
import { initPricing, calculateCostFromUsage, getModelPricing, priceSession, CATALOG_VERSION } from '../server/cost-catalog.js';
import { normalizeModelName } from '../server/normalize.js';

test('gpt-5.5 is recognized as a canonical model name with pricing at exactly 2x gpt-5.4', async () => {
  await initPricing();

  assert.equal(normalizeModelName('gpt-5.5'), 'gpt-5.5');

  assert.deepEqual(getModelPricing('gpt-5.5'), {
    input: 5,
    output: 30,
    cached_input: 0.5,
  });
  assert.deepEqual(getModelPricing('gpt-5.4'), {
    input: 2.5,
    output: 15,
    cached_input: 0.25,
  });
  assert.deepEqual(priceSession('gpt-5.5', {
    totalTokens: 1_000_000,
    usageBuckets: {
      input_tokens: 700_000,
      cached_input_tokens: 500_000,
      output_tokens: 150_000,
    },
  }), {
    cost: 5.75,
    source: 'exact',
  });
});

test('gpt-5.6 family pricing tracks cache writes separately', async () => {
  await initPricing();

  assert.equal(normalizeModelName('openai/gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(normalizeModelName('gpt 5.6 terra'), 'gpt-5.6-terra');
  assert.equal(normalizeModelName('gpt-5.6 luna'), 'gpt-5.6-luna');

  assert.deepEqual(getModelPricing('gpt-5.6-sol'), {
    input: 5,
    output: 30,
    cached_input: 0.5,
    cache_write: 6.25,
  });
  assert.deepEqual(getModelPricing('gpt-5.6-terra'), {
    input: 2,
    output: 12,
    cached_input: 0.2,
    cache_write: 2.5,
  });
  assert.deepEqual(getModelPricing('gpt-5.6-luna'), {
    input: 0.2,
    output: 1.2,
    cached_input: 0.02,
    cache_write: 0.25,
  });

  assert.equal(calculateCostFromUsage('gpt-5.6-sol', {
    input_tokens: 1_000_000,
    cached_input_tokens: 300_000,
    cache_write_input_tokens: 200_000,
    output_tokens: 100_000,
  }), 6.9);
  assert.equal(CATALOG_VERSION, '2026-07-30');
});

test('gpt-5.6 Luna and Terra keep their previous prices before July 30', async () => {
  await initPricing();

  const usage = {
    input_tokens: 1_000_000,
    cached_input_tokens: 300_000,
    cache_write_input_tokens: 200_000,
    output_tokens: 100_000,
  };

  assert.equal(calculateCostFromUsage('gpt-5.6-terra', usage, '2026-07-29'), 3.45);
  assert.equal(calculateCostFromUsage('gpt-5.6-terra', usage, '2026-07-30'), 2.76);
  assert.equal(calculateCostFromUsage('gpt-5.6-luna', usage, '2026-07-29'), 1.38);
  assert.equal(calculateCostFromUsage('gpt-5.6-luna', usage, '2026-07-30'), 0.276);
  assert.deepEqual(priceSession('gpt-5.6-terra', {
    usageByDay: {
      '2026-07-29': usage,
      '2026-07-30': usage,
    },
  }), {
    cost: 6.21,
    source: 'exact',
  });
});

test('gpt-5 mini and gpt-5.4 mini remain distinct canonical models with matching pricing', async () => {
  await initPricing();

  assert.equal(normalizeModelName('gpt-5-mini'), 'gpt-5-mini');
  assert.equal(normalizeModelName('gpt-5 mini'), 'gpt-5-mini');
  assert.equal(normalizeModelName('gpt-5.4-mini'), 'gpt-5.4-mini');
  assert.equal(normalizeModelName('gpt-5.4 mini'), 'gpt-5.4-mini');

  assert.deepEqual(getModelPricing('gpt-5-mini'), {
    input: 0.75,
    output: 4.5,
    cached_input: 0.075,
  });
  assert.deepEqual(getModelPricing('gpt-5.4-mini'), {
    input: 0.75,
    output: 4.5,
    cached_input: 0.075,
  });

  const cost = calculateCostFromUsage('gpt-5-mini', {
    input_tokens: 1_000_000,
    cached_input_tokens: 600_000,
    output_tokens: 200_000,
  });
  const cost54 = calculateCostFromUsage('gpt-5.4-mini', {
    input_tokens: 1_000_000,
    cached_input_tokens: 600_000,
    output_tokens: 200_000,
  });

  assert.equal(cost, 1.245);
  assert.equal(cost54, 1.245);
  assert.equal(CATALOG_VERSION, '2026-07-30');
});

test('gpt-5 nano and gpt-5.4 nano remain distinct canonical models with matching pricing', async () => {
  await initPricing();

  assert.equal(normalizeModelName('gpt-5-nano'), 'gpt-5-nano');
  assert.equal(normalizeModelName('gpt-5 nano'), 'gpt-5-nano');
  assert.equal(normalizeModelName('gpt-5.4-nano'), 'gpt-5.4-nano');
  assert.equal(normalizeModelName('gpt-5.4 nano'), 'gpt-5.4-nano');

  assert.deepEqual(getModelPricing('gpt-5-nano'), {
    input: 0.15,
    output: 0.6,
    cached_input: 0.015,
  });

  assert.deepEqual(getModelPricing('gpt-5.4-nano'), {
    input: 0.15,
    output: 0.6,
    cached_input: 0.015,
  });

  const cost = calculateCostFromUsage('gpt-5-nano', {
    input_tokens: 1_000_000,
    cached_input_tokens: 600_000,
    output_tokens: 200_000,
  });
  const cost54 = calculateCostFromUsage('gpt-5.4-nano', {
    input_tokens: 1_000_000,
    cached_input_tokens: 600_000,
    output_tokens: 200_000,
  });

  assert.equal(cost, 0.189);
  assert.equal(cost54, 0.189);
  assert.equal(CATALOG_VERSION, '2026-07-30');
});

test('gpt-5.2 remains distinct from gpt-5.2-codex', async () => {
  await initPricing();

  assert.equal(normalizeModelName('gpt-5.2'), 'gpt-5.2');
  assert.equal(normalizeModelName('gpt-5.2-codex'), 'gpt-5.2-codex');

  assert.deepEqual(getModelPricing('gpt-5.2'), {
    input: 2,
    output: 10,
    cached_input: 0.2,
  });
  assert.deepEqual(getModelPricing('gpt-5.2-codex'), {
    input: 2,
    output: 10,
    cached_input: 0.2,
  });
});
