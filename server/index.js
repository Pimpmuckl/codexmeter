import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachLiveSubscriber, createIngestState, detachLiveSubscriber, getLatestReplay, restartIngest, runIngest } from './ingest.js';
import { createJobSummary, createVideoExportManager, getActiveVideoExportJob, getVideoExportJob, getVideoExportSupport, startOverviewVideoExport } from './export-video.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(codexHome, opts = {}) {
  const app = express();
  app.use(express.json());
  const state = createIngestState();
  const exportManager = createVideoExportManager();
  const distDir = path.join(__dirname, '..', 'dist');
  const apiOnly = opts.devApiOnly === true;
  const ingestOpts = { ...opts };

  if (!apiOnly) {
    app.use(express.static(distDir));
  }

  app.get('/api/progress', (_req, res) => {
    res.json({
      phase: state.phase,
      total_threads: state.total_threads,
      inventoried: state.inventoried,
      needs_enrichment: state.needs_enrichment,
      enriched: state.enriched,
      current_date_bucket: state.current_date_bucket,
      percent: state.percent,
      partial_ready: state.partial_ready,
      complete: state.complete,
      error: state.error,
    });
  });

  app.get('/api/live', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    attachLiveSubscriber(state, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ ingest_id: state.ingest_id, seq: state.live_seq })}\n\n`);
      } catch {}
    }, 10000);

    req.on('close', () => {
      clearInterval(heartbeat);
      detachLiveSubscriber(state, res);
      res.end();
    });
  });

  app.post('/api/rerun', (_req, res) => {
    restartIngest(codexHome, state, ingestOpts);
    res.status(202).json({
      ok: true,
      ingest_id: state.ingest_id,
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

  app.post('/api/export/overview-video', async (req, res) => {
    const activeJob = getActiveVideoExportJob(exportManager);
    if (activeJob) {
      res.status(409).json({ error: 'Another export job is already running.' });
      return;
    }
    const replay = getLatestReplay(state);
    if (!replay) {
      res.status(409).json({ error: 'No completed ingest replay is available yet.' });
      return;
    }

    const appBaseUrl = opts.frontendBaseUrl || `${req.protocol}://${req.get('host')}`;
    const settledEnvelope = state.aggregates ? {
      overview: { data: state.aggregates.overview },
      repos: { data: state.aggregates.repos },
      models: { data: state.aggregates.models },
      families: { data: state.aggregates.families },
      daily: { data: state.aggregates.daily },
      heatmap: { data: state.aggregates.heatmap },
    } : null;
    try {
      const job = await startOverviewVideoExport(exportManager, {
        replay,
        settledEnvelope,
        appBaseUrl,
        installPortableBrowser: Boolean(req.body?.install_portable_browser),
      });
      res.status(202).json(createJobSummary(job));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message || String(err) });
    }
  });

  app.get('/api/export/active', (req, res) => {
    const job = getActiveVideoExportJob(exportManager);
    if (!job) {
      res.json({ job: null });
      return;
    }
    res.json({ job: createJobSummary(job) });
  });

  app.get('/api/export/support', async (_req, res) => {
    res.json(await getVideoExportSupport());
  });

  app.get('/api/export/:jobId/status', (req, res) => {
    const job = getVideoExportJob(exportManager, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job not found.' });
      return;
    }
    res.json(createJobSummary(job));
  });

  app.get('/api/export/:jobId/render-data', (req, res) => {
    const job = getVideoExportJob(exportManager, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job not found.' });
      return;
    }
    const payload = exportManager.getRenderPayload(req.params.jobId);
    if (!payload) {
      res.status(404).json({ error: 'Export render data not found.' });
      return;
    }
    res.json(payload);
  });

  app.get('/api/export/:jobId/file', (req, res) => {
    const job = getVideoExportJob(exportManager, req.params.jobId);
    if (!job || job.status !== 'complete' || !job.output_path) {
      res.status(404).json({ error: 'Export file not ready.' });
      return;
    }
    res.download(job.output_path, job.file_name || `codexmeter-overview-${job.id}.mp4`);
  });

  app.get('/api/sessions', (_req, res) => {
    const sessions = state.sessions || [];
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

  if (!apiOnly) {
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('codexmeter dev backend is API-only. Open the Vite dev URL for the UI.');
    });
    app.get('/{*splat}', (_req, res) => {
      res.status(404).type('text/plain').send('codexmeter dev backend is API-only. Open the Vite dev URL for the UI.');
    });
  }

  runIngest(codexHome, state, ingestOpts);
  return app;
}
