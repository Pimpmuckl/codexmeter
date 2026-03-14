const API_BASE = (import.meta.env.VITE_CODEXMETER_API_URL || '').replace(/\/$/, '');

function apiUrl(endpoint) {
  return API_BASE ? `${API_BASE}${endpoint}` : endpoint;
}

async function fetchJson(endpoint) {
  const res = await fetch(apiUrl(endpoint));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function postJson(endpoint, body = null, extraOptions = {}) {
  const baseHeaders = body ? { 'Content-Type': 'application/json' } : undefined;
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    ...extraOptions,
    headers: {
      ...(baseHeaders || {}),
      ...(extraOptions.headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  url: apiUrl,
  progress: () => fetchJson('/api/progress'),
  overview: () => fetchJson('/api/overview'),
  repos: () => fetchJson('/api/repos'),
  models: () => fetchJson('/api/models'),
  daily: () => fetchJson('/api/daily'),
  sessions: (q = '') => fetchJson(`/api/sessions${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  heatmap: () => fetchJson('/api/heatmap'),
  families: () => fetchJson('/api/families'),
  live: () => new EventSource(apiUrl('/api/live')),
  rerun: () => postJson('/api/rerun'),
  startOverviewVideoExport: () => postJson('/api/export/overview-video', null, {
    headers: {
      'x-codexmeter-client-base': window.location.origin,
    },
  }),
  exportStatus: (jobId) => fetchJson(`/api/export/${encodeURIComponent(jobId)}/status`),
  activeExport: () => fetchJson('/api/export/active'),
  exportRenderData: (jobId) => fetchJson(`/api/export/${encodeURIComponent(jobId)}/render-data`),
};
