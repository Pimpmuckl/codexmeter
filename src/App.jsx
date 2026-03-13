import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import Overview from './components/Overview';
import Repos from './components/Repos';
import Models from './components/Models';
import DailyUsage from './components/DailyUsage';
import Sessions from './components/Sessions';

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
};

export default function App() {
  const [progress, setProgress] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [range, setRange] = useState('total');
  const [chartMode, setChartMode] = useState('default');
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

        if (p.percent > 0.1) {
          await fetchAll();
        }

        if (p.percent > 0.1 && showOverlay && !fadingOut) {
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

  const ov = data?.overview?.data;
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
                <select className="chart-mode-select" value={chartMode} onChange={(e) => setChartMode(e.target.value)}>
                  <option value="default">Default charts</option>
                  <option value="bar">Bar charts</option>
                  <option value="donut">Donut charts</option>
                </select>
              </>
            )}
          </div>
          </div>
        </nav>

        <div className="main-content">
          {tab === 'Overview' && <Overview data={data.overview} heatmap={data.heatmap} families={data.families} repos={data.repos} models={data.models} range={range} />}
          {tab === 'Repos' && <Repos data={data.repos} chartMode={chartMode} />}
          {tab === 'Models' && <Models data={data.models} chartMode={chartMode} />}
          {tab === 'Daily' && <DailyUsage data={data.daily} range={range} chartMode={chartMode} />}
          {tab === 'Sessions' && <Sessions data={data.sessions} />}
        </div>
        <div className="app-footer">Made with <span className="loading-heart">♥</span> by JJ</div>
      </div>
    </div>
  );
}
