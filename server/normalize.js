const AGENT_FAMILY_MAP = {
  review_plan: 'planning',
  review_github: 'review',
  'memory builder': 'memory',
};

const AGENT_FAMILY_PREFIX_RULES = [
  { prefix: 'review_benchmark_', family: 'review' },
  { prefix: 'review_', family: 'review' },
  { prefix: 'review', family: 'review' },
  { prefix: 'worker', family: 'generic' },
  { prefix: 'explorer', family: 'exploration' },
  { prefix: 'local_explorer', family: 'exploration' },
  { prefix: 'web_explorer', family: 'exploration' },
];

export function normalizeCwd(cwd) {
  if (!cwd) return '';
  let p = cwd;
  p = p.replace(/^\\\\\?\\/, '');
  p = p.replace(/\\/g, '/');
  if (/^[A-Z]:/.test(p)) p = p[0].toLowerCase() + p.slice(1);
  p = p.toLowerCase();
  p = p.replace(/\/+$/, '');
  return p;
}

export function deriveRepoKey(normalizedCwd) {
  const label = deriveRepoLabel(normalizedCwd);
  return label === 'unknown' ? 'unknown' : `repo:${label}`;
}

export function deriveRepoLabel(normalizedCwd) {
  if (!normalizedCwd) return 'unknown';
  const worktreeMatch = normalizedCwd.match(/\.codex\/worktrees\/[^/]+\/([^/]+)/);
  if (worktreeMatch) return collapseWorktreeLabel(worktreeMatch[1]);
  if (normalizedCwd.includes('.codex')) return '.codex';
  const segments = normalizedCwd.split('/').filter(Boolean);
  return collapseWorktreeLabel(segments[segments.length - 1] || 'unknown');
}

function collapseWorktreeLabel(label) {
  return String(label || '')
    .replace(/-wt-[a-z0-9._-]+$/i, '')
    .replace(/-worktree-[a-z0-9._-]+$/i, '')
    .replace(/-worktrees?-[a-z0-9._-]+$/i, '') || 'unknown';
}

export function classifyAgentFamily(agentRole) {
  if (!agentRole) return 'generic';
  if (AGENT_FAMILY_MAP[agentRole]) return AGENT_FAMILY_MAP[agentRole];
  for (const rule of AGENT_FAMILY_PREFIX_RULES) {
    if (agentRole.startsWith(rule.prefix)) return rule.family;
  }
  if (agentRole === 'default' || agentRole === 'awaiter') return 'generic';
  return 'generic';
}

export function isSubagent(agentRole) {
  return agentRole != null && agentRole !== 'default';
}

const MODEL_ALIASES = {
  'codex-mini-latest': 'o4-mini',
  'gpt-5.2': 'gpt-5.2-codex',
  'gpt-5 mini': 'gpt-5-mini',
  'gpt-5.4-mini': 'gpt-5-mini',
  'gpt-5.4 mini': 'gpt-5-mini',
  'gpt-5 nano': 'gpt-5.4-nano',
  'gpt-5-nano': 'gpt-5.4-nano',
  'gpt-5.4 nano': 'gpt-5.4-nano',
};

export function normalizeModelName(rawModel) {
  if (!rawModel) return null;
  const lower = rawModel.toLowerCase().trim();
  return MODEL_ALIASES[lower] || lower;
}
