import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import Overview from './components/Overview';
import Repos from './components/Repos';
import Models from './components/Models';
import DailyUsage from './components/DailyUsage';
import Sessions from './components/Sessions';

const TABS = ['Overview', 'Repos', 'Models', 'Daily', 'Sessions'];

const PHASE_LABELS = {
  idle: 'Starting...',
  inventory: 'Reading threads',
  normalizing: 'Normalizing',
  enrichment: 'Enriching rollouts',
  aggregation: 'Building aggregates',
  complete: 'Complete',
};

export default function App() {
  const [progress, setProgress] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [data, setData] = useState({});
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
    let interval;

    async function poll() {
      try {
        const p = await api.progress();
        if (!alive) return;
        setProgress(p);

        if (p.percent > 0.35) {
          await fetchAll();
        }

        if (p.percent > 0.5 && showOverlay && !fadingOut) {
          setFadingOut(true);
          setTimeout(() => { if (alive) setShowOverlay(false); }, 600);
        }

        if (p.complete) {
          await fetchAll();
          clearInterval(interval);
          if (showOverlay) {
            setFadingOut(true);
            setTimeout(() => { if (alive) setShowOverlay(false); }, 600);
          }
        }
      } catch {}
    }

    poll();
    interval = setInterval(poll, 1200);
    return () => { alive = false; clearInterval(interval); };
  }, [fetchAll, showOverlay, fadingOut]);

  const complete = progress?.complete;
  const pct = Math.round((progress?.percent || 0) * 100);

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
        </div>
      )}

      <nav className="navbar">
        <span className="navbar-brand">CodexMeter</span>
        <div className="navbar-tabs">
          {TABS.map(t => (
            <button key={t} className={`navbar-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="navbar-meta">
          {!complete && <span className="incomplete-badge">ingesting {pct}%</span>}
          <span className="navbar-status">{complete ? 'snapshot ready' : ''}</span>
        </div>
      </nav>

      <div className="main-content">
        {tab === 'Overview' && <Overview data={data.overview} heatmap={data.heatmap} families={data.families} repos={data.repos} />}
        {tab === 'Repos' && <Repos data={data.repos} />}
        {tab === 'Models' && <Models data={data.models} />}
        {tab === 'Daily' && <DailyUsage data={data.daily} />}
        {tab === 'Sessions' && <Sessions data={data.sessions} />}
      </div>
    </div>
  );
}
