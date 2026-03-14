import { fetchPricing } from './pricing-fetch.js';

// Pricing map: populated by initPricing() from online lookup with local fallback
let PRICING = null;

/** Initialize pricing from online source; falls back to local catalog on timeout/failure. Call before cost calculations. */
export async function initPricing() {
  PRICING = await fetchPricing();
  return PRICING;
}

function getPricing() {
  if (!PRICING) throw new Error('Cost catalog not initialized. Call initPricing() before cost calculations.');
  return PRICING;
}

// Codex sessions: ~75% input (mostly cached), ~25% output
// With ~95% prompt cache hit rate (from Codex Monitor)
const INPUT_FRACTION = 0.75;
const OUTPUT_FRACTION = 0.25;
const CACHE_HIT_RATE = 0.95;

export function getCacheAwareRate(modelName) {
  if (!modelName) return null;
  const entry = getPricing()[modelName];
  if (!entry) return null;

  const effectiveInputRate =
    (1 - CACHE_HIT_RATE) * entry.input +
    CACHE_HIT_RATE * entry.cached_input;

  return INPUT_FRACTION * effectiveInputRate + OUTPUT_FRACTION * entry.output;
}

export function calculateCostFromUsage(modelName, usage) {
  if (!modelName || !usage) return null;
  const entry = getPricing()[modelName];
  if (!entry) return null;

  const inputTokens = usage.input_tokens || 0;
  const cachedInputTokens = usage.cached_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);

  return (
    (uncachedInputTokens * entry.input) +
    (cachedInputTokens * entry.cached_input) +
    (outputTokens * entry.output)
  ) / 1_000_000;
}

function estimateCostFromTotalTokens(modelName, tokensUsed) {
  const rate = getCacheAwareRate(modelName);
  if (rate === null) return null;
  return (tokensUsed / 1_000_000) * rate;
}

export function priceSession(modelName, { totalTokens = 0, usageBuckets = null } = {}) {
  const exactCost = calculateCostFromUsage(modelName, usageBuckets);
  if (exactCost !== null) {
    return { cost: exactCost, source: 'exact' };
  }

  const heuristicCost = estimateCostFromTotalTokens(modelName, totalTokens);
  if (heuristicCost !== null) {
    return { cost: heuristicCost, source: 'heuristic' };
  }

  return { cost: null, source: 'unpriced' };
}

export function isModelPriced(modelName) {
  return modelName != null && getPricing()[modelName] != null;
}

export function getModelPricing(modelName) {
  return getPricing()[modelName] || null;
}

export const CATALOG_VERSION = '2026-03-13';
export const CACHE_ASSUMPTIONS = {
  input_fraction: INPUT_FRACTION,
  output_fraction: OUTPUT_FRACTION,
  cache_hit_rate: CACHE_HIT_RATE,
};
