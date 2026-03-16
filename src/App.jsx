import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from './api';
import Overview from './components/Overview';
import Repos from './components/Repos';
import Models from './components/Models';
import DailyUsage from './components/DailyUsage';
import Sessions from './components/Sessions';
import OverviewVideoExport from './components/OverviewVideoExport';
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

function dayFloor(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return Math.floor(ts / 86400) * 86400;
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
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const exportMode = search?.get('export');
  const exportJobId = search?.get('job');
  if (exportMode === 'overview-video' && exportJobId) {
    return <OverviewVideoExport jobId={exportJobId} />;
  }

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
  const [completionPresentationPending, setCompletionPresentationPending] = useState(false);
  const [exportJob, setExportJob] = useState(null);
  const [startingExport, setStartingExport] = useState(false);
  const [portableDownloadPending, setPortableDownloadPending] = useState(false);
  const [exportSupport, setExportSupport] = useState({ available: true, reason: null, portable_download: null });
  const [displayDateRange, setDisplayDateRange] = useState(null);
  const prevBackendCompleteRef = useRef(false);
  const displayDateAnimationRef = useRef(0);
  const lastAutoDownloadedExportIdRef = useRef(null);

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

  const handleStartOverviewVideoExport = useCallback(async () => {
    if (startingExport || ['queued', 'running'].includes(exportJob?.status)) return;
    try {
      setStartingExport(true);
      const canUsePortableBrowser = !exportSupport?.available && exportSupport?.portable_download?.available;
      let installPortableBrowser = false;
      if (canUsePortableBrowser) {
        const sizeHint = exportSupport.portable_download.approx_size_mb
          ? `about ${exportSupport.portable_download.approx_size_mb} MB`
          : 'a fairly large download';
        const confirmed = window.confirm(
          `No supported browser was found for video export.\n\nCodexMeter can download a single-use portable Chromium bundle (${sizeHint}) for this export only, then delete it afterward.\n\nDo you want to continue?`
        );
        if (!confirmed) return;
        installPortableBrowser = true;
        setPortableDownloadPending(true);
      }
      const job = await api.startOverviewVideoExport(
        installPortableBrowser ? { install_portable_browser: true } : {}
      );
      setExportJob(job);
    } catch (err) {
      console.error('Video export error:', err);
    } finally {
      setStartingExport(false);
    }
  }, [exportJob?.status, exportSupport, startingExport]);

  useEffect(() => {
    if (!portableDownloadPending) return;
    if (!exportJob) return;
    if (exportJob.phase === 'downloading_browser') return;
    if (exportJob.phase === 'rendering' || exportJob.phase === 'encoding' || exportJob.status === 'complete' || exportJob.status === 'failed') {
      setPortableDownloadPending(false);
    }
  }, [exportJob, portableDownloadPending]);

  const handleDownloadOverviewVideo = useCallback(() => {
    if (!exportJob?.id || exportJob.status !== 'complete') return;
    window.location.href = api.url(`/api/export/${encodeURIComponent(exportJob.id)}/file`);
  }, [exportJob]);

  useEffect(() => {
    if (!exportJob?.id || exportJob.status !== 'complete') return;
    if (lastAutoDownloadedExportIdRef.current === exportJob.id) return;
    lastAutoDownloadedExportIdRef.current = exportJob.id;
    window.location.href = api.url(`/api/export/${encodeURIComponent(exportJob.id)}/file`);
  }, [exportJob]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const support = await api.exportSupport();
        if (alive) setExportSupport(support);
      } catch (err) {
        console.error('Export support probe error:', err);
        if (alive) {
          setExportSupport({
            available: false,
            reason: 'Video export availability could not be detected.',
            portable_download: null,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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
        if (source?.readyState === EventSource.CLOSED) {
          console.warn('SSE stream closed; relying on browser reconnect if available:', event);
          return;
        }
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

  const backendComplete = Boolean(progress?.complete);
  const complete = backendComplete;
  const pct = Math.round((progress?.percent || 0) * 100);
  const overviewIngestProgress = Math.min(Math.max(progress?.percent || 0, 0), 1);
  const visibleIngesting = !backendComplete || completionPresentationPending;
  const overviewIngestActive = Boolean(progress && visibleIngesting && progress.phase !== 'error');

  useEffect(() => {
    if (!progress?.complete) {
      setOverviewPresentationSettled(false);
    }
  }, [progress?.complete]);

  useEffect(() => {
    const justCompleted = backendComplete && !prevBackendCompleteRef.current;
    prevBackendCompleteRef.current = backendComplete;

    if (!backendComplete) {
      setCompletionPresentationPending(false);
      return;
    }

    if (justCompleted && !overviewPresentationSettled) {
      setCompletionPresentationPending(true);
      return;
    }

    if (completionPresentationPending && overviewPresentationSettled) {
      setCompletionPresentationPending(false);
    }
  }, [backendComplete, overviewPresentationSettled, completionPresentationPending]);

  useEffect(() => {
    let alive = true;
    let timer = null;

    const poll = async () => {
      try {
        const isSpecificJob = Boolean(exportJob?.id);
        const payload = isSpecificJob
          ? await api.exportStatus(exportJob.id)
          : await api.activeExport();
        if (!alive) return;
        const job = isSpecificJob ? payload : payload.job;
        if (!job) {
          if (!exportJob?.id) setExportJob(null);
          return;
        }
        setExportJob(job);
        if (!['complete', 'failed'].includes(job.status)) {
          timer = setTimeout(poll, 900);
        }
      } catch (err) {
        if (!alive) return;
        console.error('Export status error:', err);
      }
    };

    if (backendComplete) {
      poll();
    }

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [backendComplete, exportJob?.id]);

  useEffect(() => {
    if (!visibleIngesting && !ingestFadeOut) setIngestFadeOut(true);
    if (visibleIngesting) {
      setIngestFadeOut(false);
      setIngestFadeDone(false);
    }
  }, [visibleIngesting, ingestFadeOut]);
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

  useEffect(() => {
    if (displayDateAnimationRef.current) {
      cancelAnimationFrame(displayDateAnimationRef.current);
      displayDateAnimationRef.current = 0;
    }

    if (!dateRange?.from || !dateRange?.to) {
      setDisplayDateRange(null);
      return undefined;
    }

    const nextRange = {
      from: dayFloor(dateRange.from),
      to: dayFloor(dateRange.to),
    };

    setDisplayDateRange((prev) => {
      if (
        !prev ||
        backendComplete ||
        prev.from !== nextRange.from ||
        nextRange.to <= prev.to
      ) {
        return nextRange;
      }

      const start = prev.to;
      const end = nextRange.to;
      const diffDays = Math.max(1, Math.round((end - start) / 86400));
      const durationMs = Math.min(1400, Math.max(320, diffDays * 110));
      const startedAt = performance.now();

      const tick = (now) => {
        const t = Math.min(1, (now - startedAt) / durationMs);
        const interpolated = dayFloor(start + (end - start) * t);
        setDisplayDateRange((current) => {
          if (!current || current.from !== nextRange.from) return current;
          if (interpolated <= current.to) return current;
          return { ...current, to: interpolated };
        });
        if (t < 1) {
          displayDateAnimationRef.current = requestAnimationFrame(tick);
        } else {
          displayDateAnimationRef.current = 0;
          setDisplayDateRange(nextRange);
        }
      };

      displayDateAnimationRef.current = requestAnimationFrame(tick);
      return prev;
    });

    return () => {
      if (displayDateAnimationRef.current) {
        cancelAnimationFrame(displayDateAnimationRef.current);
        displayDateAnimationRef.current = 0;
      }
    };
  }, [backendComplete, dateRange?.from, dateRange?.to]);
  const exportBusy = startingExport || ['queued', 'running'].includes(exportJob?.status);
  const exportNeedsPortableBrowser = !exportSupport?.available && exportSupport?.portable_download?.available;
  const exportDisabledReason = portableDownloadPending
    ? 'Downloading single-use portable Chromium for this export.'
    : exportNeedsPortableBrowser && startingExport
    ? 'Downloading single-use portable Chromium for this export.'
    : exportNeedsPortableBrowser && exportJob?.phase === 'downloading_browser'
      ? 'Downloading single-use portable Chromium for this export.'
    : !exportSupport?.available && !exportNeedsPortableBrowser
    ? (exportSupport.reason || 'Video export requires Chrome, Chromium, or Edge.')
    : exportNeedsPortableBrowser
      ? 'No supported browser found. Click to download a single-use portable Chromium for this export.'
    : !backendComplete
      ? 'Finish ingest to render the replay video.'
      : exportBusy
        ? 'Video export is already running.'
        : 'Render Overview ingest replay video';
  const exportLabel = exportJob?.status === 'complete'
    ? 'Download MP4'
    : portableDownloadPending || exportBusy && (startingExport && exportNeedsPortableBrowser || exportJob?.phase === 'downloading_browser')
      ? `Downloading ${Math.max(1, Math.round((exportJob?.progress || 0.03) * 100))}%`
    : exportBusy
      ? `Rendering ${Math.max(1, Math.round((exportJob?.progress || 0) * 100))}%`
      : 'Render Video';

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
                className={`navbar-tab ${tab === t ? 'active' : ''} ${!(backendComplete && ingestFadeDone) && t !== 'Overview' ? 'navbar-tab-dimmed' : ''}`}
                onClick={() => setTab(t)}
                disabled={!backendComplete && t !== 'Overview'}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="navbar-meta">
            {dateRange && (
              <div className={`navbar-date-wrap ${!backendComplete ? 'navbar-date-wrap-dimmed' : ''}`}>
                <span className="navbar-date" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {fmtDate(displayDateRange?.from || dateRange.from)} — {fmtDate(displayDateRange?.to || dateRange.to)}
                </span>
                <div className="range-toggle">
                  {RANGES.map(r => (
                    <button key={r.key} className={`range-btn ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)} disabled={!backendComplete}>
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
                  disabled={rerunning || !backendComplete}
                >
                  ↻
                </button>
                <button
                  type="button"
                  className={`navbar-tab active export-video-btn ${!exportSupport?.available ? 'range-btn-unsupported' : ''}`}
                  onClick={exportJob?.status === 'complete' ? handleDownloadOverviewVideo : handleStartOverviewVideoExport}
                  disabled={(!exportSupport?.available && !exportNeedsPortableBrowser) || !backendComplete || exportBusy}
                  style={{ minWidth: 110 }}
                  title={exportJob?.status === 'complete' ? 'Download rendered Overview video' : exportDisabledReason}
                >
                  {exportLabel}
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
          {tab === 'Repos' && <Repos data={data.repos} range={range} />}
          {tab === 'Models' && <Models data={data.models} range={range} />}
          {tab === 'Daily' && <DailyUsage data={data.daily} range={range} />}
          {tab === 'Sessions' && <Sessions data={data.sessions} />}
        </div>
        <div className="app-footer">Made with <span className="loading-heart">♥</span> by JJ</div>
      </div>
    </div>
  );
}
