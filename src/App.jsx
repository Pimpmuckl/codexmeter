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
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const PHASE_LABELS = {
  idle: 'Starting...',
  inventory: 'Reading threads',
  normalizing: 'Normalizing',
  enrichment: 'Enriching rollouts',
  aggregation: 'Building aggregates',
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

  const fetchAll = useCallback(async () => {
    try {
      const [overview, repos, models, daily, sessions, heatmap, families] = await Promise.all([
        api.overview(), api.repos(), api.models(), api.daily(),
        api.sessions(), api.heatmap(), api.families(),
      ]);
      setData({ overview, repos, models, daily, sessions, heatmap, families });
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let interval = null;
    let source = null;
    let usingFallback = false;
    let terminalSseState = false;

    const applyLivePayload = (payload, mode) => {
      setProgress(payload.progress);
      setLiveState((prev) => {
        if (prev && payload.ingest_id === prev.ingest_id && payload.seq <= prev.seq) return prev;
        return mergeLiveEvent(prev, payload, mode);
      });
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
            setLiveState(null);
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
        applyLivePayload(payload, 'bootstrap');
      });

      source.addEventListener('progress', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        setProgress(payload.progress);
      });

      source.addEventListener('patch', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        applyLivePayload(payload, 'patch');
      });

      source.addEventListener('complete', async (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        terminalSseState = true;
        applyLivePayload(payload, 'patch');
        await fetchAll();
        if (!alive) return;
        setLiveState(null);
        source?.close();
      });

      source.addEventListener('ingest-error', (event) => {
        if (!alive) return;
        const payload = JSON.parse(event.data);
        terminalSseState = true;
        setProgress(payload.progress);
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

    fetchAll();
    startLive();

    return () => {
      alive = false;
      clearInterval(interval);
      source?.close();
    };
  }, [fetchAll]);

  useEffect(() => {
    if (tab !== 'Sessions' || data?.sessions?.data) return;
    api.sessions().then((sessions) => {
      setData((prev) => ({ ...prev, sessions }));
    }).catch((err) => {
      console.error('Sessions fetch error:', err);
    });
  }, [tab, data?.sessions]);

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

  const complete = progress?.complete;
  const pct = Math.round((progress?.percent || 0) * 100);

  const liveData = useMemo(() => (
    !progress?.complete && liveState ? buildLiveDataEnvelope(liveState, progress) : null
  ), [liveState, progress]);
  const effectiveData = liveData ? { ...data, ...liveData, sessions: data.sessions } : data;

  const ov = effectiveData?.overview?.data;
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
              <button key={t} className={`navbar-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="navbar-meta">
            {!complete && (
              <>
                <div className="navbar-progress-wrap">
                  <div className="navbar-progress-bar" style={{ width: `${pct}%` }} />
                </div>
                <span className="incomplete-badge">ingesting {pct}%</span>
              </>
            )}
            {dateRange && (
              <>
                <span className="navbar-date" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDate(dateRange.from)} — {fmtDate(dateRange.to)}
                </span>
                <div className="range-toggle">
                  {RANGES.map(r => (
                    <button key={r.key} className={`range-btn ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          </div>
        </nav>

        <div className="main-content">
          {tab === 'Overview' && <Overview data={effectiveData.overview} heatmap={effectiveData.heatmap} daily={effectiveData.daily} families={effectiveData.families} repos={effectiveData.repos} models={effectiveData.models} range={range} />}
          {tab === 'Repos' && <Repos data={effectiveData.repos} />}
          {tab === 'Models' && <Models data={effectiveData.models} />}
          {tab === 'Daily' && <DailyUsage data={effectiveData.daily} range={range} />}
          {tab === 'Sessions' && <Sessions data={effectiveData.sessions} />}
        </div>
        <div className="app-footer">Made with <span className="loading-heart">♥</span> by JJ</div>
      </div>
    </div>
  );
}
