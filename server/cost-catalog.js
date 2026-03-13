// Real OpenAI API pricing as of March 2026
// Cached input tokens get 90% discount on most models
const PRICING = {
  'gpt-5.4':           { input: 2.50,  output: 15.00, cached_input: 0.25 },
  'gpt-5.3-codex':     { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.3-codex-spark': { input: 2.00, output: 10.00, cached_input: 0.20 },
  'gpt-5.2-codex':     { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.2':           { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.1-codex-mini':{ input: 0.25,  output:  2.00, cached_input: 0.025 },
  'gpt-4.1':           { input: 2.00,  output:  8.00, cached_input: 0.50 },
  'gpt-4.1-mini':      { input: 0.40,  output:  1.60, cached_input: 0.10 },
  'gpt-4.1-nano':      { input: 0.10,  output:  0.40, cached_input: 0.025 },
  'o3':                { input: 2.00,  output:  8.00, cached_input: 0.50 },
  'o3-mini':           { input: 1.10,  output:  4.40, cached_input: 0.275 },
  'o4-mini':           { input: 1.10,  output:  4.40, cached_input: 0.275 },
  'gpt-4o':            { input: 2.50,  output: 10.00, cached_input: 1.25 },
  'gpt-4o-mini':       { input: 0.15,  output:  0.60, cached_input: 0.075 },
};

// Codex sessions: ~75% input (mostly cached), ~25% output
// With ~95% prompt cache hit rate (from Codex Monitor)
const INPUT_FRACTION = 0.75;
const OUTPUT_FRACTION = 0.25;
const CACHE_HIT_RATE = 0.95;

export function getCacheAwareRate(modelName) {
  if (!modelName) return null;
  const entry = PRICING[modelName];
  if (!entry) return null;

  const effectiveInputRate =
    (1 - CACHE_HIT_RATE) * entry.input +
    CACHE_HIT_RATE * entry.cached_input;

  return INPUT_FRACTION * effectiveInputRate + OUTPUT_FRACTION * entry.output;
}

export function estimateCost(modelName, tokensUsed) {
  const rate = getCacheAwareRate(modelName);
  if (rate === null) return null;
  return (tokensUsed / 1_000_000) * rate;
}

export function isModelPriced(modelName) {
  return modelName != null && PRICING[modelName] != null;
}

export function getModelPricing(modelName) {
  return PRICING[modelName] || null;
}

export const CATALOG_VERSION = '2026-03-13';
export const CACHE_ASSUMPTIONS = {
  input_fraction: INPUT_FRACTION,
  output_fraction: OUTPUT_FRACTION,
  cache_hit_rate: CACHE_HIT_RATE,
};
