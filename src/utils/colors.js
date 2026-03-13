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

const MODEL_COLORS = {
  'gpt-5.4':              '#f472b6',
  'gpt-5.3-codex':        '#f59e0b',
  'gpt-5.3-codex-spark':  '#fbbf24',
  'gpt-5.2-codex':        '#6366f1',
  'gpt-5.2':              '#818cf8',
  'gpt-5.1-codex-mini':   '#a78bfa',
  'unknown':              '#475569',
};

const MODEL_FALLBACK = [
  '#10b981', '#06b6d4', '#ec4899', '#ef4444', '#8b5cf6',
  '#84cc16', '#14b8a6', '#f97316',
];

const FAMILY_COLORS = {
  review:         '#06b6d4',
  implementation: '#22c55e',
  exploration:    '#f97316',
  planning:       '#eab308',
  github_review:  '#a855f7',
  memory:         '#ec4899',
  generic:        '#64748b',
};

export function getRepoColor(repoLabel) {
  const idx = hashStr(repoLabel) % REPO_PALETTE.length;
  return REPO_PALETTE[idx];
}

export function getModelColor(modelName) {
  if (MODEL_COLORS[modelName]) return MODEL_COLORS[modelName];
  const idx = hashStr(modelName) % MODEL_FALLBACK.length;
  return MODEL_FALLBACK[idx];
}

export function getFamilyColor(family) {
  return FAMILY_COLORS[family] || '#64748b';
}

export function getModelColorMap(modelNames) {
  const map = {};
  for (const m of modelNames) map[m] = getModelColor(m);
  return map;
}
