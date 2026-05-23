import React, { useEffect, useRef, useState } from 'react';
import { OverviewFrame } from './Overview';
import { api } from '../api';
import {
  advanceExportSimulation,
  blendExportFrameState,
  computeFinalFlashStyle,
  computeIntroContentOpacity,
  computeIntroFadeOpacity,
  createExportSimulation,
  snapshotExportSimulation,
} from '../utils/overviewVideoExportTimeline';

export default function OverviewVideoExport({ jobId }) {
  const [renderData, setRenderData] = useState(null);
  const [error, setError] = useState(null);
  const [frameState, setFrameState] = useState(null);
  const [captureReady, setCaptureReady] = useState(false);
  const simulationRef = useRef(null);
  const rafRef = useRef(0);
  const displayFrameRef = useRef(null);
  const lastDisplayNowRef = useRef(0);
  const flashStartSeekMsRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(api.url(`/api/export/${encodeURIComponent(jobId)}/render-data`));
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const payload = await res.json();
        if (!alive) return;
        setRenderData(payload);
        simulationRef.current = createExportSimulation(payload);
        const initialFrame = snapshotExportSimulation(simulationRef.current);
        displayFrameRef.current = initialFrame;
        lastDisplayNowRef.current = 0;
        setFrameState(initialFrame);
        setCaptureReady(false);
        flashStartSeekMsRef.current = null;
      } catch (nextError) {
        if (!alive) return;
        setError(nextError.message || String(nextError));
      }
    })();

    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [jobId]);

  useEffect(() => {
    if (!frameState?.liveData || error) return undefined;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let raf3 = 0;
    let raf4 = 0;
    let readyTimer = 0;

    const waitForFullFrame = () => {
      const statValues = Array.from(document.querySelectorAll('.stat-card .stat-value'));
      const chartCanvases = Array.from(document.querySelectorAll('canvas'));
      const hasStats = statValues.length >= 4 && statValues.every((node) => String(node.textContent || '').trim().length > 0);
      const hasDailySpark = Boolean(document.querySelector('.overview-daily-spark-chart, .overview-daily-spark-empty'));
      const hasCharts = chartCanvases.length >= 3 && hasDailySpark && chartCanvases.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const hasHeatmap = document.querySelectorAll('.heatmap-cell').length >= 300;

      if (!(hasStats && hasCharts && hasHeatmap)) {
        raf4 = requestAnimationFrame(waitForFullFrame);
        return;
      }

      readyTimer = window.setTimeout(() => {
        if (!cancelled) setCaptureReady(true);
      }, 180);
    };

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          raf4 = requestAnimationFrame(waitForFullFrame);
        });
      });
    });
    return () => {
      cancelled = true;
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (raf3) cancelAnimationFrame(raf3);
      if (raf4) cancelAnimationFrame(raf4);
      if (readyTimer) window.clearTimeout(readyTimer);
    };
  }, [error, frameState]);

  useEffect(() => {
    if (!frameState) return;
    if (frameState.phase === 'final_hold') {
      if (flashStartSeekMsRef.current == null) {
        flashStartSeekMsRef.current = frameState.seekMs || 0;
      }
      return;
    }
    flashStartSeekMsRef.current = null;
  }, [frameState?.phase, frameState?.seekMs]);

  useEffect(() => {
    const startPlayback = () => {
      const sim = simulationRef.current;
      if (!sim || sim.started) return;
      sim.started = true;
      sim.startWallClockMs = Date.now();

      const step = () => {
        const activeSim = simulationRef.current;
        if (!activeSim) return;
        const now = Date.now();
        const elapsedMs = Math.min(activeSim.totalDurationMs, now - activeSim.startWallClockMs);
        const rawFrameState = advanceExportSimulation(activeSim, elapsedMs);
        const dt = lastDisplayNowRef.current ? Math.max(1, now - lastDisplayNowRef.current) : 16;
        lastDisplayNowRef.current = now;
        const displayFrame = blendExportFrameState(displayFrameRef.current, rawFrameState, dt, elapsedMs);
        displayFrameRef.current = displayFrame;
        setFrameState(displayFrame);
        if (elapsedMs >= activeSim.totalDurationMs) {
          activeSim.finished = true;
          rafRef.current = 0;
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    };

    window.__CODEXMETER_EXPORT__ = {
      ready: Boolean(renderData && !error && captureReady),
      jobId,
      start() {
        startPlayback();
      },
      get currentTimeMs() {
        return simulationRef.current?.currentSeekMs || 0;
      },
      get finished() {
        return Boolean(simulationRef.current?.finished);
      },
      getDebugState() {
        return simulationRef.current?.debugState || null;
      },
      getDebugTrace() {
        return simulationRef.current?.debugTrace || [];
      },
    };

    return () => {
      delete window.__CODEXMETER_EXPORT__;
    };
  }, [captureReady, error, jobId, renderData]);

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={statusStyle}>Export error: {error}</div>
      </div>
    );
  }

  if (!frameState?.liveData) {
    return (
      <div style={containerStyle}>
        <div style={statusStyle}>CodexMeter exporting…</div>
      </div>
    );
  }

  const activeSim = simulationRef.current;
  const exportDailyTiming = activeSim
    ? {
      startMs: activeSim.startHoldDurationMs,
      endMs: activeSim.finalHoldStartMs,
    }
    : null;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div
          style={{
            ...contentFadeLayerStyle,
            opacity: computeIntroContentOpacity(frameState.seekMs),
          }}
        >
          <OverviewFrame
            presentation={frameState.presentation}
            rawPresentation={frameState.rawPresentation}
            ingestProgress={Math.min(Math.max(frameState.progress?.percent || 0, 0), 1)}
            isIngestActive={Boolean(frameState.progress && !frameState.progress.complete)}
            exportMode={false}
            exportPlayback={true}
            exportPhase={frameState.phase}
            exportSeekMs={frameState.seekMs}
            exportDaily={activeSim?.finalPresentation?.daily || null}
            exportDailyTiming={exportDailyTiming}
          />
          <div style={footerStyle}>
            Made with <span style={footerHeartStyle}>♥</span> by JJ
          </div>
        </div>
        <div
          style={{
            ...introFadeOverlayStyle,
            opacity: computeIntroFadeOpacity(frameState.seekMs),
          }}
        />
        <div
          style={{
            ...flashOverlayStyle,
            ...computeFinalFlashStyle(frameState.seekMs, flashStartSeekMsRef.current),
          }}
        />
      </div>
    </div>
  );
}

const containerStyle = {
  width: '100vw',
  minHeight: '100vh',
  background: '#06080f',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const frameStyle = {
  position: 'relative',
  width: 1080,
  height: 864,
  padding: '24px 28px 20px',
  background: '#06080f',
  overflow: 'hidden',
};

const statusStyle = {
  color: '#8b949e',
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 18,
};

const footerStyle = {
  position: 'absolute',
  right: 18,
  bottom: 10,
  color: 'rgba(139, 148, 158, 0.58)',
  fontSize: 10,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  letterSpacing: '0.02em',
  opacity: 0.62,
  pointerEvents: 'none',
};

const footerHeartStyle = {
  color: 'rgba(244, 63, 94, 0.52)',
};

const flashOverlayStyle = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,255,1) 100%)',
  pointerEvents: 'none',
  zIndex: 20,
  mixBlendMode: 'screen',
};

const introFadeOverlayStyle = {
  position: 'absolute',
  inset: 0,
  background: '#000000',
  pointerEvents: 'none',
  zIndex: 30,
};

const contentFadeLayerStyle = {
  position: 'relative',
  zIndex: 1,
};
