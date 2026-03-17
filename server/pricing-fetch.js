// Local pricing catalog for models used in codex-cli/codex app lifetime.
const FALLBACK = {
  'gpt-5.4':             { input: 2.50,  output: 15.00, cached_input: 0.25 },
  'gpt-5-mini':          { input: 0.75,  output:  4.50, cached_input: 0.075},
  'gpt-5.4-nano':        { input: 0.15,  output:  0.60, cached_input: 0.015},
  'gpt-5.3-codex':       { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.3-codex-spark': { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.2-codex':       { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.2':             { input: 2.00,  output: 10.00, cached_input: 0.20 },
  'gpt-5.1-codex-mini':  { input: 0.25,  output:  2.00, cached_input: 0.025},
  'gpt-4.1':             { input: 2.00,  output:  8.00, cached_input: 0.50 },
  'gpt-4.1-mini':        { input: 0.40,  output:  1.60, cached_input: 0.10 },
  'gpt-4.1-nano':        { input: 0.10,  output:  0.40, cached_input: 0.025 },
  'o3':                  { input: 2.00,  output:  8.00, cached_input: 0.50 },
  'o3-mini':             { input: 1.10,  output:  4.40, cached_input: 0.275},
  'o4-mini':             { input: 1.10,  output:  4.40, cached_input: 0.275},
  'gpt-4o':              { input: 2.50,  output: 10.00, cached_input: 1.25 },
  'gpt-4o-mini':         { input: 0.15,  output:  0.60, cached_input: 0.075},
  'gpt-4-turbo':         { input: 10.00, output: 30.00, cached_input: 1.00 },
  'gpt-4':               { input: 30.00, output: 60.00, cached_input: 3.00 },
  'gpt-3.5-turbo':       { input: 0.50,  output:  1.50, cached_input: 0.05 },
};

const PRICING_URL = process.env.CODEXMETER_PRICING_URL || null;

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.input == null || entry.output == null) return null;
  const cached = entry.cached_input ?? entry.cachedInput ?? entry.input * 0.1;
  return { input: entry.input, output: entry.output, cached_input: cached };
}

function normalizePricing(raw) {
  const models = raw?.models && typeof raw.models === 'object' ? raw.models : raw;
  if (!models || typeof models !== 'object') return null;
  const out = {};
  for (const [name, entry] of Object.entries(models)) {
    const norm = normalizeEntry(entry);
    if (norm) out[name] = norm;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function fetchPricing() {
  if (!PRICING_URL) return FALLBACK;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(PRICING_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return FALLBACK;
    const data = await res.json();
    const normalized = normalizePricing(data);
    if (normalized) {
      return { ...FALLBACK, ...normalized };
    }
  } catch {
    // timeout, network error, invalid JSON - use fallback
  }
  return FALLBACK;
}
