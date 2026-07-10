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

export function deriveRepoKey(normalizedCwd, gitOriginUrl) {
  const label = deriveRepoLabel(normalizedCwd, gitOriginUrl);
  return label === 'unknown' ? 'unknown' : `repo:${label}`;
}

export function deriveRepoLabel(normalizedCwd, gitOriginUrl) {
  if (!normalizedCwd) return 'unknown';
  const originLabel = deriveOriginRepoLabel(gitOriginUrl);
  if (originLabel) return originLabel;
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

function deriveOriginRepoLabel(gitOriginUrl) {
  const clean = String(gitOriginUrl || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return clean.split('/').pop()?.replace(/\.git$/i, '').toLowerCase() || null;
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

export function parseThreadSource(rawSource) {
  if (!rawSource) return null;
  if (typeof rawSource === 'object') return rawSource;
  const text = String(rawSource).trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return { kind: text };
    }
  }
  return { kind: text };
}

export function deriveAgentRole(agentRole, rawSource, title = null) {
  if (agentRole && agentRole !== 'default') return agentRole;
  const source = parseThreadSource(rawSource);
  if (source && typeof source === 'object' && typeof source.subagent === 'string') {
    return source.subagent;
  }
  if (isReviewTaskTitle(title)) return 'review';
  return null;
}

export function isReviewTaskTitle(title) {
  if (typeof title !== 'string') return false;
  const value = title.trim().toLowerCase();
  return (
    value.startsWith('review the code changes against the base branch ') ||
    value.startsWith('you are reviewing a manually supplied diff artifact.') ||
    value.startsWith('brief review for commit range ') ||
    value.startsWith('independent brief review ') ||
    value.startsWith('tight-scope integration review ') ||
    value.startsWith('pr-scope review ') ||
    value.startsWith('independent second-round pr review ') ||
    value.startsWith('second independent pr-scope review ') ||
    value.startsWith('implementation-review preflight ') ||
    value.startsWith('implementation-review postflight ')
  );
}

export function isReviewLauncherSession(session) {
  if (session?.rollout_path && !session?.materialized) return false;
  const source = parseThreadSource(session?.source_raw);
  const sourceKind = source?.kind || (typeof source === 'string' ? source : null);
  return isLauncherSourceKind(sourceKind) &&
    isReviewTaskTitle(session?.title) &&
    !session?.model_name &&
    !session?.usage_total &&
    !session?.has_usage_by_day &&
    !session?.tokens_used;
}

function isLauncherSourceKind(sourceKind) {
  const normalized = String(sourceKind || '').trim().toLowerCase();
  return normalized === 'exec' ||
    normalized === 'cli' ||
    normalized.endsWith('-cli') ||
    normalized.endsWith('_cli');
}

const MODEL_ALIASES = {
  'codex-mini-latest': 'o4-mini',
  'gpt 5.6 sol': 'gpt-5.6-sol',
  'gpt-5.6 sol': 'gpt-5.6-sol',
  'openai/gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt 5.6 terra': 'gpt-5.6-terra',
  'gpt-5.6 terra': 'gpt-5.6-terra',
  'openai/gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt 5.6 luna': 'gpt-5.6-luna',
  'gpt-5.6 luna': 'gpt-5.6-luna',
  'openai/gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt 5.5': 'gpt-5.5',
  'gpt-5.5': 'gpt-5.5',
  'gpt 5 mini': 'gpt-5-mini',
  'gpt-5 mini': 'gpt-5-mini',
  'gpt 5.4 mini': 'gpt-5.4-mini',
  'gpt-5.4 mini': 'gpt-5.4-mini',
  'gpt 5 nano': 'gpt-5-nano',
  'gpt-5 nano': 'gpt-5-nano',
  'gpt 5.4 nano': 'gpt-5.4-nano',
  'gpt-5.4 nano': 'gpt-5.4-nano',
};

const MODEL_HYPHEN_CHARS = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function normalizeModelLookupKey(rawModel) {
  return String(rawModel)
    .normalize('NFKC')
    .replace(MODEL_HYPHEN_CHARS, '-')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeModelName(rawModel) {
  if (!rawModel) return null;
  const lookup = normalizeModelLookupKey(rawModel);
  return MODEL_ALIASES[lookup] || lookup;
}
