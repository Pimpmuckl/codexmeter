// Deterministic hash-based colors for consistency across runs
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const REPO_PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7',
  '#84cc16', '#e879f9', '#22d3ee', '#fb923c', '#34d399',
  '#c084fc', '#fbbf24', '#2dd4bf', '#f472b6', '#a3e635',
];

// Curated colors for common models (consistent across machines)
const MODEL_COLORS = {
  'gpt-5.4':              '#f472b6',
  'gpt-5.3-codex':        '#f59e0b',
  'gpt-5.3-codex-spark':  '#fbbf24',
  'gpt-5.2-codex':        '#6366f1',
  'gpt-5.2':              '#818cf8',
  'gpt-5.1-codex-mini':   '#a78bfa',
  'gpt-4.1':              '#06b6d4',
  'gpt-4.1-mini':         '#14b8a6',
  'gpt-4.1-nano':         '#2dd4bf',
  'o3':                   '#a855f7',
  'o3-mini':              '#c084fc',
  'o4-mini':              '#e879f9',
  'gpt-4o':               '#ec4899',
  'gpt-4o-mini':          '#22d3ee',
  'gpt-4-turbo':          '#ef4444',
  'gpt-4':                '#f97316',
  'gpt-3.5-turbo':        '#84cc16',
  'unknown':              '#475569',
};

const FAMILY_COLORS = {
  review:      '#06b6d4',
  exploration: '#f97316',
  planning:    '#eab308',
  memory:      '#ec4899',
  generic:     '#64748b',
};

const EFFORT_COLORS = {
  low:       '#10b981',
  medium:    '#06b6d4',
  high:      '#f59e0b',
  xhigh:     '#a855f7',
  'x-high':  '#a855f7',
  unknown:   '#64748b',
};

/** Canonical effort key for consistent color mapping across models */
export function normalizeEffortKey(effort) {
  if (!effort) return 'unknown';
  const k = String(effort).toLowerCase().trim().replace(/-/g, '');
  if (k === 'low') return 'low';
  if (k === 'medium') return 'medium';
  if (k === 'high') return 'high';
  if (k === 'xhigh') return 'xhigh';
  if (k === 'unknown') return 'unknown';
  return k;
}

export function getRepoColor(repoLabel) {
  const idx = hashStr(repoLabel) % REPO_PALETTE.length;
  return REPO_PALETTE[idx];
}

/** Returns white or dark color for readable text on the given background hex */
export function getContrastLabelColor(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return '#ffffff';
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#1f2937' : '#ffffff';
}

/** HSL to hex; h in [0,360), s and l in [0,100] */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

export function getModelColor(modelName) {
  if (MODEL_COLORS[modelName]) return MODEL_COLORS[modelName];
  const h = hashStr(modelName) % 300;
  return hslToHex(h, 72, 62);
}

export function getFamilyColor(family) {
  return FAMILY_COLORS[family] || '#64748b';
}

export function getEffortColor(effort) {
  const key = normalizeEffortKey(effort);
  return EFFORT_COLORS[key] ?? '#64748b';
}

export function getModelColorMap(modelNames) {
  const map = {};
  for (const m of modelNames) map[m] = getModelColor(m);
  return map;
}
