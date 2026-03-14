const API_BASE = (import.meta.env.VITE_CODEXMETER_API_URL || '').replace(/\/$/, '');

function apiUrl(endpoint) {
  return API_BASE ? `${API_BASE}${endpoint}` : endpoint;
}

async function fetchJson(endpoint) {
  const res = await fetch(apiUrl(endpoint));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function postJson(endpoint) {
  const res = await fetch(apiUrl(endpoint), { method: 'POST' });
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
};
