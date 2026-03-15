import React, { useEffect, useRef, useState } from 'react';
import Overview from './Overview';
import { api } from '../api';
import {
  createEmptyLiveClientState,
  buildLiveDataEnvelope,
  buildLiveStateFromSettled,
  mergeLiveEvent,
} from '../live-state';

export default function OverviewVideoExport({ jobId }) {
  const [renderData, setRenderData] = useState(null);
  const [error, setError] = useState(null);
  const [frameState, setFrameState] = useState(null);
  const simulationRef = useRef(null);
  const rafRef = useRef(0);

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
        setFrameState(snapshotExportSimulation(simulationRef.current));
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
    const startPlayback = () => {
      const sim = simulationRef.current;
      if (!sim || sim.started) return;
      sim.started = true;
      sim.startWallClockMs = 0;

      const step = (now) => {
        const activeSim = simulationRef.current;
        if (!activeSim) return;
        if (!activeSim.startWallClockMs) activeSim.startWallClockMs = now;
        const elapsedMs = Math.min(activeSim.totalDurationMs, now - activeSim.startWallClockMs);
        setFrameState(advanceExportSimulation(activeSim, elapsedMs));
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
      ready: Boolean(renderData && !error),
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
    };

    return () => {
      delete window.__CODEXMETER_EXPORT__;
    };
  }, [error, jobId, renderData]);

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

  return (
    <div style={containerStyle}>
      <div
        style={{
          ...frameStyle,
          opacity: frameState.introOpacity,
          transform: `translateY(${Math.round((1 - frameState.introOpacity) * 10)}px)`,
        }}
      >
        <Overview
          data={frameState.liveData.overview}
          heatmap={frameState.liveData.heatmap}
          daily={frameState.liveData.daily}
          families={frameState.liveData.families}
          repos={frameState.liveData.repos}
          models={frameState.liveData.models}
          range="total"
          ingestProgress={Math.min(Math.max(frameState.progress?.percent || 0, 0), 1)}
          isIngestActive={Boolean(frameState.progress && !frameState.progress.complete)}
        />
      </div>
    </div>
  );
}

function createExportSimulation(renderData) {
  const bootstrapPayload = renderData.replay?.bootstrap?.payload || {};
  const bootstrapProgress = cloneProgress(bootstrapPayload.progress || { percent: 0, complete: false });
  const bootstrapLiveState = mergeLiveEvent(null, bootstrapPayload, 'bootstrap');
  const emptyLiveState = createEmptyLiveClientState();
  const finalLiveState = renderData.settledEnvelope
    ? buildLiveStateFromSettled(renderData.settledEnvelope, bootstrapPayload.ingest_id, Number.MAX_SAFE_INTEGER)
    : bootstrapLiveState;

  const introDurationMs = Math.max(renderData.introDurationMs || 0, 0);
  const replayDurationMs = Math.max(renderData.replayDurationMs || renderData.replay?.duration_ms || 1, 1);
  const tailDurationMs = Math.max(renderData.tailDurationMs || 0, 0);
  const totalDurationMs = Math.max(renderData.durationMs || (introDurationMs + replayDurationMs + tailDurationMs) || 1, 1);
  const tailReplayFraction = clamp01(renderData.tailReplayFraction ?? 0.72);
  const tailReplayDurationMs = Math.round(tailDurationMs * tailReplayFraction);
  const tailSettleDurationMs = Math.max(0, tailDurationMs - tailReplayDurationMs);
  const sourceDurationMs = Math.max(renderData.replay?.duration_ms || 0, 0);
  const totalReplayPlaybackDurationMs = Math.max(1, replayDurationMs + tailReplayDurationMs);
  const mainReplaySourceDurationMs = Math.round(sourceDurationMs * (replayDurationMs / totalReplayPlaybackDurationMs));

  return {
    renderData,
    totalDurationMs,
    introDurationMs,
    replayDurationMs,
    tailDurationMs,
    tailReplayDurationMs,
    tailSettleDurationMs,
    sourceDurationMs,
    mainReplaySourceDurationMs,
    tailReplayStartMs: introDurationMs + replayDurationMs,
    tailSettleStartMs: introDurationMs + replayDurationMs + tailReplayDurationMs,
    currentSeekMs: 0,
    eventIndex: 0,
    bootstrapped: introDurationMs <= 0,
    settledApplied: false,
    started: false,
    finished: false,
    startWallClockMs: 0,
    liveState: introDurationMs <= 0 ? bootstrapLiveState : emptyLiveState,
    bootstrapLiveState,
    finalLiveState,
    progress: introDurationMs <= 0 ? bootstrapProgress : { ...bootstrapProgress, percent: 0, complete: false },
    bootstrapProgress,
  };
}

function snapshotExportSimulation(sim) {
  return {
    liveData: buildLiveDataEnvelope(sim.liveState),
    progress: sim.progress,
    introOpacity: sim.introDurationMs > 0
      ? applyCubicOut(clamp01(sim.currentSeekMs / Math.max(sim.introDurationMs, 1)))
      : 1,
  };
}

function advanceExportSimulation(sim, requestedSeekMs) {
  const targetSeekMs = Math.min(Math.max(Number(requestedSeekMs) || 0, 0), sim.totalDurationMs);
  sim.currentSeekMs = targetSeekMs;

  if (!sim.bootstrapped && targetSeekMs >= sim.introDurationMs) {
    sim.bootstrapped = true;
    sim.liveState = sim.bootstrapLiveState;
    sim.progress = cloneProgress(sim.bootstrapProgress);
  }

  if (!sim.bootstrapped) {
    const introProgress = clamp01(targetSeekMs / Math.max(sim.introDurationMs, 1));
    sim.progress = {
      ...(sim.bootstrapProgress || {}),
      percent: lerpNumber(0, sim.bootstrapProgress?.percent || 0, applyCubicOut(introProgress)),
      complete: false,
    };
    return snapshotExportSimulation(sim);
  }

  const normalizedReplayMs = mapReplaySeekMs(sim, targetSeekMs);

  while (sim.eventIndex < (sim.renderData.replay.events || []).length) {
    const event = sim.renderData.replay.events[sim.eventIndex];
    if ((event.at_ms || 0) > normalizedReplayMs) break;
    sim.eventIndex += 1;
    sim.progress = cloneProgress(event.payload?.progress || sim.progress);
    if (event.event === 'patch') {
      sim.liveState = mergeLiveEvent(sim.liveState, event.payload, 'patch');
    }
  }

  if (!sim.settledApplied && targetSeekMs >= sim.tailSettleStartMs) {
    sim.settledApplied = true;
    sim.liveState = sim.finalLiveState;
  }

  if (targetSeekMs >= sim.tailSettleStartMs) {
    const settleProgress = clamp01((targetSeekMs - sim.tailSettleStartMs) / Math.max(sim.tailSettleDurationMs || 1, 1));
    const easedSettle = applyCubicOut(settleProgress);
    sim.progress = {
      ...(sim.progress || {}),
      percent: lerpNumber(sim.progress?.percent || 0, 1, easedSettle),
      complete: settleProgress >= 1,
      phase: settleProgress >= 1 ? 'complete' : (sim.progress?.phase || 'finalizing'),
    };
  } else {
    sim.progress = {
      ...(sim.progress || {}),
      complete: false,
    };
  }

  if (targetSeekMs >= sim.totalDurationMs) {
    sim.finished = true;
  }

  return snapshotExportSimulation(sim);
}

function mapReplaySeekMs(sim, timelineMs) {
  if (timelineMs <= sim.introDurationMs) return 0;

  const afterIntroMs = timelineMs - sim.introDurationMs;
  if (afterIntroMs <= sim.replayDurationMs) {
    const progress = clamp01(afterIntroMs / Math.max(sim.replayDurationMs, 1));
    return Math.round(sim.mainReplaySourceDurationMs * progress);
  }

  if (timelineMs <= sim.tailSettleStartMs) {
    const tailProgress = clamp01((timelineMs - sim.tailReplayStartMs) / Math.max(sim.tailReplayDurationMs, 1));
    return Math.round(lerpNumber(sim.mainReplaySourceDurationMs, sim.sourceDurationMs, tailProgress));
  }

  return sim.sourceDurationMs;
}

function cloneProgress(progress) {
  return progress ? { ...progress } : null;
}

function clamp01(value) {
  return Math.min(Math.max(value || 0, 0), 1);
}

function lerpNumber(from, to, t) {
  return from + (to - from) * t;
}

function applyCubicOut(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
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
