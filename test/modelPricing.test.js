import test from 'node:test';
import assert from 'node:assert/strict';
import { initPricing, calculateCostFromUsage, getModelPricing, CATALOG_VERSION } from '../server/cost-catalog.js';
import { normalizeModelName } from '../server/normalize.js';

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
  assert.equal(CATALOG_VERSION, '2026-03-17');
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
  assert.equal(CATALOG_VERSION, '2026-03-17');
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
