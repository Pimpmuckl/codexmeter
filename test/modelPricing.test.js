import test from 'node:test';
import assert from 'node:assert/strict';
import { initPricing, calculateCostFromUsage, getModelPricing, CATALOG_VERSION } from '../server/cost-catalog.js';
import { normalizeModelName } from '../server/normalize.js';

test('gpt-5.4 mini aliases normalize and price consistently', async () => {
  await initPricing();

  assert.equal(normalizeModelName('gpt-5.4-mini'), 'gpt-5.4-mini');
  assert.equal(normalizeModelName('gpt-5.4 mini'), 'gpt-5.4-mini');
  assert.equal(normalizeModelName('gpt-5-mini'), 'gpt-5.4-mini');
  assert.equal(normalizeModelName('gpt-5 mini'), 'gpt-5.4-mini');

  assert.deepEqual(getModelPricing('gpt-5.4-mini'), {
    input: 0.75,
    output: 4.5,
    cached_input: 0.075,
  });
  assert.deepEqual(getModelPricing('gpt-5-mini'), {
    input: 0.75,
    output: 4.5,
    cached_input: 0.075,
  });

  const cost = calculateCostFromUsage('gpt-5.4-mini', {
    input_tokens: 1_000_000,
    cached_input_tokens: 600_000,
    output_tokens: 200_000,
  });

  assert.equal(cost, 1.245);
  assert.equal(CATALOG_VERSION, '2026-03-17');
});
