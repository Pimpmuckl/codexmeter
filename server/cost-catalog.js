import { fetchPricing } from './pricing-fetch.js';

// Pricing map: populated by initPricing() from online lookup with local fallback
let PRICING = null;

const PRICE_CHANGE_DATE = '2026-07-30';
const PREVIOUS_PRICING = {
  'gpt-5.6-terra': { input: 2.50, output: 15.00, cached_input: 0.25, cache_write: 3.125 },
  'gpt-5.6-luna': { input: 1.00, output: 6.00, cached_input: 0.10, cache_write: 1.25 },
};

/** Initialize pricing from online source; falls back to local catalog on timeout/failure. Call before cost calculations. */
export async function initPricing() {
  PRICING = await fetchPricing();
  return PRICING;
}

function getPricing() {
  if (!PRICING) throw new Error('Cost catalog not initialized. Call initPricing() before cost calculations.');
  return PRICING;
}

function getPricingEntry(modelName, pricingDate) {
  if (pricingDate && pricingDate < PRICE_CHANGE_DATE && PREVIOUS_PRICING[modelName]) {
    return PREVIOUS_PRICING[modelName];
  }
  return getPricing()[modelName];
}

// Codex sessions: ~75% input (mostly cached), ~25% output
// With ~95% prompt cache hit rate (from Codex Monitor)
const INPUT_FRACTION = 0.75;
const OUTPUT_FRACTION = 0.25;
const CACHE_HIT_RATE = 0.95;

export function getCacheAwareRate(modelName, pricingDate = null) {
  if (!modelName) return null;
  const entry = getPricingEntry(modelName, pricingDate);
  if (!entry) return null;

  const effectiveInputRate =
    (1 - CACHE_HIT_RATE) * entry.input +
    CACHE_HIT_RATE * entry.cached_input;

  return INPUT_FRACTION * effectiveInputRate + OUTPUT_FRACTION * entry.output;
}

export function calculateCostFromUsage(modelName, usage, pricingDate = null) {
  if (!modelName || !usage) return null;
  const entry = getPricingEntry(modelName, pricingDate);
  if (!entry) return null;

  const inputTokens = usage.input_tokens || 0;
  const cachedInputTokens = usage.cached_input_tokens || 0;
  const cacheWriteInputTokens = usage.cache_write_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens - cacheWriteInputTokens, 0);
  const cacheWriteRate = entry.cache_write ?? entry.input;

  return (
    (uncachedInputTokens * entry.input) +
    (cachedInputTokens * entry.cached_input) +
    (cacheWriteInputTokens * cacheWriteRate) +
    (outputTokens * entry.output)
  ) / 1_000_000;
}

function estimateCostFromTotalTokens(modelName, tokensUsed, pricingDate) {
  const rate = getCacheAwareRate(modelName, pricingDate);
  if (rate === null) return null;
  return (tokensUsed / 1_000_000) * rate;
}

export function priceSession(modelName, {
  totalTokens = 0,
  usageBuckets = null,
  usageByDay = null,
  pricingDate = null,
} = {}) {
  const dailyUsage = Object.entries(usageByDay || {});
  if (dailyUsage.length) {
    let cost = 0;
    for (const [day, usage] of dailyUsage) {
      const dailyCost = calculateCostFromUsage(modelName, usage, day);
      if (dailyCost === null) return { cost: null, source: 'unpriced' };
      cost += dailyCost;
    }
    return { cost, source: 'exact' };
  }

  const exactCost = calculateCostFromUsage(modelName, usageBuckets, pricingDate);
  if (exactCost !== null) {
    return { cost: exactCost, source: 'exact' };
  }

  const heuristicCost = estimateCostFromTotalTokens(modelName, totalTokens, pricingDate);
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

export const CATALOG_VERSION = '2026-07-30';
export const CACHE_ASSUMPTIONS = {
  input_fraction: INPUT_FRACTION,
  output_fraction: OUTPUT_FRACTION,
  cache_hit_rate: CACHE_HIT_RATE,
};
