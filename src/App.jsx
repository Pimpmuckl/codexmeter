import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from './api';
import Overview from './components/Overview';
import Repos from './components/Repos';
import Models from './components/Models';
import DailyUsage from './components/DailyUsage';
import Sessions from './components/Sessions';
import { buildLiveDataEnvelope, mergeLiveEvent } from './live-state';

const TABS = ['Overview', 'Repos', 'Models', 'Daily', 'Sessions'];

const RANGES = [
  { key: 'd7', label: '7d' },
  { key: 'd30', label: '30d' },
  { key: 'total', label: 'All' },
];

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}

const PHASE_LABELS = {
  idle: 'Starting...',
  inventory: 'Reading threads',
  normalizing: 'Normalizing',
  enrichment: 'Enriching rollouts',
  aggregation: 'Building aggregates',
  finalizing: 'Finalizing view',
  complete: 'Complete',
  error: 'Error',
};

export default function App() {
  const [progress, setProgress] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [range, setRange] = useState('total');
  const [data, setData] = useState({});
  const [liveState, setLiveState] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);
  const [ingestFadeOut, setIngestFadeOut] = useState(false);
  const [ingestFadeDone, setIngestFadeDone] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [overviewPresentationSettled, setOverviewPresentationSettled] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [overview, repos, models, daily, sessions, heatmap, families] = await Promise.all([
        api.overview(), api.repos(), api.models(), api.daily(),
        api.sessions(), api.heatmap(), api.families(),
      ]);
      const nextData = { overview, repos, models, daily, sessions, heatmap, families };
      setData(nextData);
      return nextData;
    } catch (err) {
      console.error('Fetch error:', err);
      throw err;
    }
  }, []);

  const handleRerun = useCallback(async () => {
    if (rerunning) return;
    try {
      setRerunning(true);
      setTab('Overview');
      await api.rerun();
      window.location.reload();
    } catch (err) {
      console.error('Rerun error:', err);
      setRerunning(false);
    }
  }, [rerunning]);

  useEffect(() => {
    let alive = true;
    let interval = null;
    let source = null;
    let usingFallback = false;
    let terminalSseState = false;
    let settledFetchStarted = false;
    let queuedEvents = [];
    let frameId = 0;
    let liveStateRef = null;
    let progressRef = null;

    const flushQueuedEvents = () => {
      frameId = 0;
      if (!alive || queuedEvents.length === 0) return;

      let nextLiveState = liveStateRef;
      let nextProgress = progressRef;

      for (const event of queuedEvents) {
        const { payload, mode, progressOnly } = event;
        nextProgress = payload.progress;
        if (!progressOnly) {
          if (nextLiveState && payload.ingest_id === nextLiveState.ingest_id && payload.seq <= nextLiveState.seq) {
            continue;
          }
          nextLiveState = mergeLiveEvent(nextLiveState, payload, mode);
        }
      }

      queuedEvents = [];
      if (nextProgress !== progressRef) {
        progressRef = nextProgress;
        setProgress(nextProgress);
      }
      if (nextLiveState !== liveStateRef) {
        liveStateRef = nextLiveState;
        setLiveState(nextLiveState);
      }
    };

    const enqueueLivePayload = (payload, mode, progressOnly = false) => {
      queuedEvents.push({ payload, mode, progressOnly });
      if (!frameId) {
        frameId = requestAnimationFrame(flushQueuedEvents);
      }
    };

    const ensureSettledDataLoaded = async (nextProgress, ingestId = null) => {
      if (!alive || !nextProgress?.complete || settledFetchStarted) return;
      settledFetchStarted = true;
      await fetchAll();
    };

    const startFallbackPolling = () => {
      if (usingFallback || !alive) return;
      usingFallback = true;

      const poll = async () => {
        try {
          const p = await api.progress();
          if (!alive) return;
          setProgress(p);

          if (p.percent > 0.1) {
            await fetchAll();
          }

          if (p.complete) {
            await fetchAll();
            clearInterval(interval);
            return;
          }

          if (p.error || p.phase === 'error') {
            clearInterval(interval);
          }
        } catch (err) {
          console.error('Polling fallback error:', err);
        }
      };

      poll();
      interval = setInterval(poll, 1200);
    };

    const startLive = () => {
      if (typeof EventSource === 'undefined') {
        startFallbackPolling();
        return;
      }

      source = api.live();

      source.addEventListener('bootstrap', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        enqueueLivePayload(payload, 'bootstrap');
        ensureSettledDataLoaded(payload.progress, payload.ingest_id).catch((err) => {
          console.error('Settled fetch error:', err);
          settledFetchStarted = false;
        });
      });

      source.addEventListener('progress', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        enqueueLivePayload(payload, 'progress', true);
        ensureSettledDataLoaded(payload.progress, payload.ingest_id).catch((err) => {
          console.error('Settled fetch error:', err);
          settledFetchStarted = false;
        });
      });

      source.addEventListener('patch', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        enqueueLivePayload(payload, 'patch');
      });

      source.addEventListener('complete', async (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        terminalSseState = true;
        enqueueLivePayload(payload, 'progress', true);
        await ensureSettledDataLoaded(payload.progress, payload.ingest_id);
        if (!alive) return;
        source?.close();
      });

      source.addEventListener('ingest-error', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        terminalSseState = true;
        enqueueLivePayload(payload, 'progress', true);
        source?.close();
      });

      source.addEventListener('error', (event) => {
        if (!alive) return;
        if (terminalSseState) return;
        console.error('SSE stream error:', event);
        source?.close();
        startFallbackPolling();
      });
    };

    startLive();

    return () => {
      alive = false;
      clearInterval(interval);
      if (frameId) cancelAnimationFrame(frameId);
      source?.close();
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!progress) return;
    if (progress.percent > 0.1 && showOverlay && !fadingOut) {
      setFadingOut(true);
      const timer = setTimeout(() => setShowOverlay(false), 600);
      return () => clearTimeout(timer);
    }
    if (progress.complete && showOverlay && !fadingOut) {
      setFadingOut(true);
      const timer = setTimeout(() => setShowOverlay(false), 600);
      return () => clearTimeout(timer);
    }
  }, [progress, showOverlay, fadingOut]);

  const complete = Boolean(progress?.complete && overviewPresentationSettled);
  const pct = Math.round((progress?.percent || 0) * 100);
  const overviewIngestProgress = Math.min(Math.max(progress?.percent || 0, 0), 1);
  const overviewIngestActive = Boolean(progress && !progress.complete && progress.phase !== 'error');

  useEffect(() => {
    if (!progress?.complete) {
      setOverviewPresentationSettled(false);
    }
  }, [progress?.complete]);

  useEffect(() => {
    if (complete && !ingestFadeOut) setIngestFadeOut(true);
    if (!complete) {
      setIngestFadeOut(false);
      setIngestFadeDone(false);
    }
  }, [complete, ingestFadeOut]);
  useEffect(() => {
    if (!ingestFadeOut) return;
    const t = setTimeout(() => setIngestFadeDone(true), 350);
    return () => clearTimeout(t);
  }, [ingestFadeOut]);

  const liveData = useMemo(() => (
    liveState ? buildLiveDataEnvelope(liveState) : null
  ), [liveState]);
  const overviewData = liveData ? liveData.overview : data.overview;
  const overviewHeatmap = liveData ? liveData.heatmap : data.heatmap;
  const overviewDaily = liveData ? liveData.daily : data.daily;
  const overviewFamilies = liveData ? liveData.families : data.families;
  const overviewRepos = liveData ? liveData.repos : data.repos;
  const overviewModels = liveData ? liveData.models : data.models;

  const ov = overviewData?.data;
  const d = ov?.[range] || ov?.total || {};
  const dateRange = d?.date_range;

  return (
    <div className="app">
      {showOverlay && (
        <div className={`loading-overlay ${fadingOut ? 'fading' : ''}`}>
          <div className="loading-logo">CodexMeter</div>
          <div className="loading-bar-wrap">
            <div className="loading-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="loading-phase">{PHASE_LABELS[progress?.phase] || 'Starting...'}</div>
          {progress?.phase === 'enrichment' && (
            <div className="loading-detail">
              {progress.enriched}/{progress.needs_enrichment} rollouts
              {progress.current_date_bucket && ` — ${progress.current_date_bucket}`}
            </div>
          )}
          {progress?.phase === 'error' && progress?.error && (
            <div className="loading-detail">{progress.error}</div>
          )}
          <div className="loading-footer">Made with <span className="loading-heart">♥</span> by JJ</div>
        </div>
      )}

      <div className={`app-content ${fadingOut || !showOverlay ? 'app-content-revealed' : ''}`}>
        <nav className="navbar">
          <div className="navbar-inner">
          <span className="navbar-brand">CodexMeter</span>
          <div className="navbar-tabs">
            {TABS.map(t => (
              <button
                key={t}
                className={`navbar-tab ${tab === t ? 'active' : ''} ${!(complete && ingestFadeDone) && t !== 'Overview' ? 'navbar-tab-dimmed' : ''}`}
                onClick={() => setTab(t)}
                disabled={!complete && t !== 'Overview'}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="navbar-meta">
            {(!complete || !ingestFadeDone) && (
              <div className={`navbar-ingest-wrap ${ingestFadeOut ? 'navbar-ingest-fade-out' : ''}`}>
                <div className="navbar-progress-wrap">
                  <div className="navbar-progress-bar" style={{ width: `${pct}%` }} />
                </div>
                <span className="incomplete-badge ingesting-badge">ingesting <span className="ingesting-pct">{pct}%</span></span>
              </div>
            )}
            {dateRange && (
              <div className={`navbar-date-wrap ${!complete ? 'navbar-date-wrap-dimmed' : ''}`}>
                <span className="navbar-date" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDate(dateRange.from)} — {fmtDate(dateRange.to)}
                </span>
                <div className="range-toggle">
                  {RANGES.map(r => (
                    <button key={r.key} className={`range-btn ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)} disabled={!complete}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Rerun ingest"
                  title="Rerun ingest"
                  onClick={handleRerun}
                  disabled={rerunning || !complete}
                >
                  ↻
                </button>
              </div>
            )}
          </div>
          </div>
        </nav>

        <div className="main-content">
          {tab === 'Overview' && (
            <Overview
              data={overviewData}
              heatmap={overviewHeatmap}
              daily={overviewDaily}
              families={overviewFamilies}
              repos={overviewRepos}
              models={overviewModels}
              range={range}
              onPresentationSettledChange={setOverviewPresentationSettled}
              ingestProgress={overviewIngestProgress}
              isIngestActive={overviewIngestActive}
            />
          )}
          {tab === 'Repos' && <Repos data={data.repos} />}
          {tab === 'Models' && <Models data={data.models} />}
          {tab === 'Daily' && <DailyUsage data={data.daily} range={range} />}
          {tab === 'Sessions' && <Sessions data={data.sessions} />}
        </div>
        <div className="app-footer">Made with <span className="loading-heart">♥</span> by JJ</div>
      </div>
    </div>
  );
}
