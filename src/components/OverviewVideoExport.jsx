import React, { useEffect, useRef, useState } from 'react';
import { OverviewFrame } from './Overview';
import { api } from '../api';
import {
  mergeLiveEvent,
} from '../live-state';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from '../utils/overviewPresentation';

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
      sim.startWallClockMs = Date.now();

      const step = () => {
        const activeSim = simulationRef.current;
        if (!activeSim) return;
        const elapsedMs = Math.min(activeSim.totalDurationMs, Date.now() - activeSim.startWallClockMs);
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
      <div style={frameStyle}>
        <OverviewFrame
          presentation={frameState.presentation}
          ingestProgress={Math.min(Math.max(frameState.progress?.percent || 0, 0), 1)}
          isIngestActive={Boolean(frameState.progress && !frameState.progress.complete)}
          exportMode={false}
        />
      </div>
    </div>
  );
}

function createExportSimulation(renderData) {
  const bootstrapPayload = renderData.replay?.bootstrap?.payload || {};
  const bootstrapProgress = cloneProgress(bootstrapPayload.progress || { percent: 0, complete: false });
  const bootstrapLiveState = mergeLiveEvent(null, bootstrapPayload, 'bootstrap');
  const events = renderData.replay?.events || [];
  const firstPatchIndex = events.findIndex((event) => event.event === 'patch');
  const firstPatchAtMs = firstPatchIndex >= 0 ? events[firstPatchIndex].at_ms || 0 : 0;
  const keyframes = buildPresentationKeyframes(renderData, bootstrapLiveState, events);
  const initialPresentation = keyframes[0]?.presentation || emptyPresentationTarget();
  const initialProgress = firstPatchIndex >= 0
    ? cloneProgress(events[firstPatchIndex].payload?.progress || bootstrapProgress)
    : cloneProgress(bootstrapProgress);

  const startHoldDurationMs = Math.max(renderData.startHoldDurationMs || 0, 0);
  const replayDurationMs = Math.max(renderData.replayDurationMs || renderData.replay?.duration_ms || 1, 1);
  const tailDurationMs = Math.max(renderData.tailDurationMs || 0, 0);
  const finalHoldDurationMs = Math.max(renderData.finalHoldDurationMs || 0, 0);
  const totalDurationMs = Math.max(
    renderData.durationMs || (startHoldDurationMs + replayDurationMs + tailDurationMs + finalHoldDurationMs) || 1,
    1
  );
  const tailSourceFraction = clamp01(renderData.tailSourceFraction ?? 0.035);
  const sourceDurationMs = Math.max(renderData.replay?.duration_ms || 0, 0);
  const sourceStartMs = Math.min(Math.max(firstPatchAtMs, 0), sourceDurationMs);
  const effectiveSourceDurationMs = Math.max(1, sourceDurationMs - sourceStartMs);
  const tailSourceDurationMs = Math.max(1, Math.round(effectiveSourceDurationMs * tailSourceFraction));
  const mainReplaySourceDurationMs = Math.max(0, effectiveSourceDurationMs - tailSourceDurationMs);
  const tailSourceStartMs = Math.max(sourceStartMs, sourceDurationMs - tailSourceDurationMs);
  const replayEasing = renderData.replayEasing || 'cubicInOut';
  const tailEasing = renderData.tailEasing || 'cubicInOut';
  const finalPresentation = keyframes[keyframes.length - 1]?.presentation || initialPresentation;
  const tailStartPresentation = samplePresentationFromKeyframes(keyframes, tailSourceStartMs);

  return {
    renderData,
    totalDurationMs,
    startHoldDurationMs,
    replayDurationMs,
    tailDurationMs,
    finalHoldDurationMs,
    sourceDurationMs,
    sourceStartMs,
    effectiveSourceDurationMs,
    tailSourceDurationMs,
    tailSourceStartMs,
    mainReplaySourceDurationMs,
    replayStartMs: startHoldDurationMs,
    tailStartMs: startHoldDurationMs + replayDurationMs,
    finalHoldStartMs: startHoldDurationMs + replayDurationMs + tailDurationMs,
    currentSeekMs: 0,
    started: false,
    finished: false,
    startWallClockMs: 0,
    presentation: initialPresentation,
    keyframes,
    keyframeIndex: 0,
    tailStartPresentation,
    finalPresentation,
    progress: initialProgress || { ...bootstrapProgress, percent: 0, complete: false },
    bootstrapProgress,
    replayEasing,
    tailEasing,
  };
}

function snapshotExportSimulation(sim) {
  return {
    liveData: { ready: true },
    presentation: sim.presentation,
    progress: sim.progress,
  };
}

function advanceExportSimulation(sim, requestedSeekMs) {
  const targetSeekMs = Math.min(Math.max(Number(requestedSeekMs) || 0, 0), sim.totalDurationMs);
  sim.currentSeekMs = targetSeekMs;

  if (targetSeekMs < sim.tailStartMs) {
    const normalizedReplayMs = mapReplaySeekMs(sim, targetSeekMs);
    sim.presentation = samplePresentationAtSource(sim, normalizedReplayMs);
  } else if (targetSeekMs < sim.finalHoldStartMs) {
    const tailProgress = clamp01((targetSeekMs - sim.tailStartMs) / Math.max(sim.tailDurationMs, 1));
    sim.presentation = interpolateOverviewPresentation(
      sim.tailStartPresentation,
      sim.finalPresentation,
      applyNamedEasing(sim.tailEasing, tailProgress)
    );
  } else {
    sim.presentation = sim.finalPresentation;
  }

  if (targetSeekMs >= sim.finalHoldStartMs) {
    const holdProgress = clamp01((targetSeekMs - sim.finalHoldStartMs) / Math.max(sim.finalHoldDurationMs || 1, 1));
    sim.progress = {
      ...(sim.progress || {}),
      percent: 1,
      complete: true,
      phase: holdProgress >= 1 ? 'complete' : 'complete',
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
  if (timelineMs <= sim.replayStartMs) return 0;

  const replayElapsedMs = timelineMs - sim.replayStartMs;
  if (replayElapsedMs <= sim.replayDurationMs) {
    const progress = clamp01(replayElapsedMs / Math.max(sim.replayDurationMs, 1));
    return Math.round(sim.sourceStartMs + (sim.mainReplaySourceDurationMs * applyNamedEasing(sim.replayEasing, progress)));
  }

  return sim.sourceDurationMs;
}

function cloneProgress(progress) {
  return progress ? { ...progress } : null;
}

function buildPresentationKeyframes(renderData, bootstrapLiveState, events) {
  const keyframes = [];
  let liveState = bootstrapLiveState;
  let seq = 0;

  for (const event of events) {
    if (event.event !== 'patch') continue;
    seq += 1;
    liveState = mergeLiveEvent(liveState, event.payload, 'patch');
    keyframes.push({
      at_ms: Math.max(0, event.at_ms || 0),
      presentation: buildOverviewPresentationTarget({
        overview: { data: liveState.overview },
        heatmap: { data: liveState.heatmap },
        daily: { data: Object.entries(liveState.daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })) },
        families: { data: liveState.families },
        repos: { data: liveState.repos },
        models: { data: liveState.models },
        range: 'total',
      }),
    });
  }

  if (renderData.settledEnvelope) {
    keyframes.push({
      at_ms: Math.max(renderData.replay?.duration_ms || 0, keyframes[keyframes.length - 1]?.at_ms || 0),
      presentation: buildOverviewPresentationTarget({
        overview: renderData.settledEnvelope.overview,
        heatmap: renderData.settledEnvelope.heatmap,
        daily: renderData.settledEnvelope.daily,
        families: renderData.settledEnvelope.families,
        repos: renderData.settledEnvelope.repos,
        models: renderData.settledEnvelope.models,
        range: 'total',
      }),
    });
  }

  if (!keyframes.length) {
    keyframes.push({ at_ms: 0, presentation: emptyPresentationTarget() });
  }

  return keyframes;
}

function samplePresentationAtSource(sim, sourceMs) {
  return samplePresentationFromKeyframes(sim.keyframes, sourceMs, sim);
}

function samplePresentationFromKeyframes(frames, sourceMs, sim = null) {
  if (!frames.length) return emptyPresentationTarget();
  if (sourceMs <= frames[0].at_ms) return frames[0].presentation;

  let idx = sim?.keyframeIndex || 0;
  while (idx + 1 < frames.length && frames[idx + 1].at_ms <= sourceMs) idx += 1;
  if (sim) sim.keyframeIndex = idx;

  const from = frames[idx];
  const to = frames[Math.min(idx + 1, frames.length - 1)];
  if (!to || to.at_ms <= from.at_ms) return from.presentation;
  const t = clamp01((sourceMs - from.at_ms) / Math.max(to.at_ms - from.at_ms, 1));
  return interpolateOverviewPresentation(from.presentation, to.presentation, t);
}

function emptyPresentationTarget() {
  return buildOverviewPresentationTarget({
    overview: { data: null },
    heatmap: { data: {} },
    daily: { data: [] },
    families: { data: { total: [], d7: [], d30: [] } },
    repos: { data: { total: [], d7: [], d30: [] } },
    models: { data: { total: [], d7: [], d30: [] } },
    range: 'total',
  });
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

function applyCubicInOut(t) {
  const x = clamp01(t);
  if (x < 0.5) return 4 * x * x * x;
  return 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function applyNamedEasing(name, t) {
  switch (name) {
    case 'cubicInOut':
      return applyCubicInOut(t);
    case 'cubicOut':
      return applyCubicOut(t);
    case 'linear':
    default:
      return clamp01(t);
  }
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
