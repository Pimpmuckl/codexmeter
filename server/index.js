import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createIngestState, runIngest } from './ingest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(codexHome, opts = {}) {
  const app = express();
  const state = createIngestState();
  const distDir = path.join(__dirname, '..', 'dist');

  app.use(express.static(distDir));

  app.get('/api/progress', (_req, res) => {
    res.json({
      phase: state.phase,
      total_threads: state.total_threads,
      inventoried: state.inventoried,
      needs_enrichment: state.needs_enrichment,
      enriched: state.enriched,
      current_date_bucket: state.current_date_bucket,
      percent: state.percent,
      complete: state.complete,
      error: state.error,
    });
  });

  const wrap = (key) => (_req, res) => {
    const agg = state.aggregates;
    res.json({
      data: agg ? agg[key] : (key === 'overview' ? {} : []),
      complete: state.complete,
      coverage: agg?.overview?.total?.coverage || { total: 0, enriched: 0, priced: 0, time_valid: 0 },
      generated_at: state.generated_at,
    });
  };

  app.get('/api/overview', wrap('overview'));
  app.get('/api/repos', wrap('repos'));
  app.get('/api/models', wrap('models'));
  app.get('/api/daily', wrap('daily'));
  app.get('/api/heatmap', wrap('heatmap'));
  app.get('/api/families', wrap('families'));

  app.get('/api/sessions', (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    let sessions = state.sessions || [];
    if (q) {
      sessions = sessions.filter(s =>
        (s.repo_label?.toLowerCase().includes(q)) ||
        (s.model_name?.toLowerCase().includes(q)) ||
        (s.agent_role?.toLowerCase().includes(q)) ||
        (s.agent_nickname?.toLowerCase().includes(q)) ||
        (s.title?.toLowerCase().includes(q)) ||
        (s.descendant_models || []).some(v => v?.toLowerCase().includes(q)) ||
        (s.descendant_families || []).some(v => v?.toLowerCase().includes(q)) ||
        (s.descendant_roles || []).some(v => v?.toLowerCase().includes(q)) ||
        (s.descendant_nicknames || []).some(v => v?.toLowerCase().includes(q)) ||
        (s.related_titles || []).some(v => v?.toLowerCase().includes(q))
      );
    }
    res.json({
      data: sessions.map(s => ({
        thread_id: s.thread_id, root_thread_id: s.root_thread_id, repo_label: s.repo_label,
        model_name: s.model_name, reasoning_effort: s.reasoning_effort,
        agent_role: s.agent_role, agent_nickname: s.agent_nickname,
        agent_family: s.agent_family, is_subagent: s.is_subagent,
        started_at: s.started_at, ended_at: s.ended_at,
        elapsed_seconds: s.elapsed_seconds, tokens_used: s.tokens_used,
        cost: s.cost, cost_source: s.cost_source, title: s.title,
        thread_count: s.thread_count, subagent_count: s.subagent_count,
        descendant_models: s.descendant_models,
        descendant_families: s.descendant_families,
        descendant_roles: s.descendant_roles,
        descendant_nicknames: s.descendant_nicknames,
        related_titles: s.related_titles,
      })),
      complete: state.complete,
      coverage: state.aggregates?.overview?.total?.coverage || { total: 0, enriched: 0, priced: 0, time_valid: 0 },
      generated_at: state.generated_at,
    });
  });

  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  runIngest(codexHome, state, opts);
  return app;
}
