import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { OverviewFrame } from './Overview';
import { api } from '../api';
import { buildLiveDataEnvelope, mergeLiveEvent } from '../live-state';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from '../utils/overviewPresentation';
import {
  resolveOverviewPresentationDuration,
  resolveOverviewPresentationEasing,
  isOverviewTailActive,
} from '../utils/animationsDefault';

export default function OverviewVideoExport({ jobId }) {
  const [renderData, setRenderData] = useState(null);
  const [error, setError] = useState(null);
  const [frameState, setFrameState] = useState(null);
  const simulationRef = useRef(null);

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
    };
  }, [jobId]);

  useEffect(() => {
    window.__CODEXMETER_EXPORT__ = {
      ready: Boolean(renderData && !error),
      jobId,
      seek(ms) {
        if (!simulationRef.current) return;
        flushSync(() => {
          setFrameState(advanceExportSimulation(simulationRef.current, ms));
        });
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

  if (!frameState?.presentation) {
    return (
      <div style={containerStyle}>
        <div style={statusStyle}>Preparing export…</div>
      </div>
    );
  }

  const progress = frameState.progress;

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <OverviewFrame
          presentation={frameState.presentation}
          ingestProgress={Math.min(Math.max(progress?.percent || 0, 0), 1)}
          isIngestActive={Boolean(progress && !progress.complete)}
        />
      </div>
    </div>
  );
}

function buildPresentationTarget(liveState) {
  const envelope = buildLiveDataEnvelope(liveState);
  return buildOverviewPresentationTarget({
    overview: envelope.overview,
    heatmap: envelope.heatmap,
    daily: envelope.daily,
    families: envelope.families,
    repos: envelope.repos,
    models: envelope.models,
    range: 'total',
  });
}

function buildPresentationTargetFromEnvelope(envelope) {
  return buildOverviewPresentationTarget({
    overview: envelope?.overview,
    heatmap: envelope?.heatmap,
    daily: envelope?.daily,
    families: envelope?.families,
    repos: envelope?.repos,
    models: envelope?.models,
    range: 'total',
  });
}

function applyPresentationEasing(t, easing) {
  const x = Math.min(Math.max(t, 0), 1);
  if (easing === 'cubicOut') {
    return 1 - Math.pow(1 - x, 3);
  }
  return x;
}

function clamp01(value) {
  return Math.min(Math.max(value || 0, 0), 1);
}

function lerpNumber(from, to, t) {
  return from + (to - from) * t;
}

function cloneProgress(progress) {
  return progress ? { ...progress } : null;
}

function createExportSimulation(renderData) {
  const progress = cloneProgress(renderData.replay.bootstrap.payload.progress || null);
  const liveState = mergeLiveEvent(null, renderData.replay.bootstrap.payload, 'bootstrap');
  const initialTarget = buildPresentationTarget(liveState);
  const emptyTarget = buildOverviewPresentationTarget({ range: 'total' });
  const finalTarget = renderData.settledEnvelope
    ? buildPresentationTargetFromEnvelope(renderData.settledEnvelope)
    : initialTarget;
  const introDurationMs = Math.max(renderData.introDurationMs || 0, 0);
  const replayDurationMs = Math.max(renderData.replayDurationMs || renderData.replay.duration_ms || 1, 1);
  const tailDurationMs = Math.max(renderData.tailDurationMs || 0, 0);
  const totalDurationMs = Math.max(renderData.durationMs || (introDurationMs + replayDurationMs + tailDurationMs) || 1, 1);
  const tailReplayFraction = clamp01(renderData.tailReplayFraction ?? 0.72);
  const tailReplayDurationMs = Math.round(tailDurationMs * tailReplayFraction);
  const tailSettleDurationMs = Math.max(0, tailDurationMs - tailReplayDurationMs);
  const totalReplayPlaybackDurationMs = Math.max(1, replayDurationMs + tailReplayDurationMs);
  const sourceDurationMs = Math.max(renderData.replay.duration_ms || 0, 0);
  const mainReplaySourceDurationMs = Math.round(sourceDurationMs * (replayDurationMs / totalReplayPlaybackDurationMs));
  const progressStart = cloneProgress(progress);
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
    stepMs: 1000 / Math.max(1, renderData.fps || 60),
    currentSeekMs: 0,
    currentReplaySeekMs: 0,
    eventIndex: 0,
    progress,
    progressStart,
    liveState,
    initialTarget,
    emptyTarget,
    target: initialTarget,
    finalTarget,
    presentation: introDurationMs > 0 ? emptyTarget : initialTarget,
    tweenMode: 'smooth',
    tweenStartMs: 0,
    tweenFrom: introDurationMs > 0 ? emptyTarget : initialTarget,
    tweenTarget: initialTarget,
    finalSettleStarted: false,
    finalSettleFrom: initialTarget,
  };
}

function snapshotExportSimulation(sim) {
  return {
    presentation: sim.presentation,
    progress: sim.progress,
  };
}

function resetExportSimulation(sim) {
  const fresh = createExportSimulation(sim.renderData);
  Object.assign(sim, fresh);
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
    return Math.round(
      lerpNumber(sim.mainReplaySourceDurationMs, sim.sourceDurationMs, tailProgress)
    );
  }

  return sim.sourceDurationMs;
}

function interpolateProgress(from, to, t) {
  const next = cloneProgress(to) || cloneProgress(from) || { percent: 0, complete: false };
  const fromPercent = from?.percent ?? 0;
  const toPercent = to?.percent ?? fromPercent;
  next.percent = lerpNumber(fromPercent, toPercent, t);
  next.complete = false;
  return next;
}

function advanceExportSimulation(sim, requestedSeekMs) {
  const targetSeekMs = Math.min(Math.max(Number(requestedSeekMs) || 0, 0), sim.totalDurationMs);
  if (targetSeekMs < sim.currentSeekMs) {
    resetExportSimulation(sim);
  }

  for (let t = sim.currentSeekMs + sim.stepMs; t <= targetSeekMs + 0.0001; t += sim.stepMs) {
    if (t <= sim.introDurationMs) {
      const introProgress = clamp01(t / Math.max(sim.introDurationMs, 1));
      const easedIntro = applyPresentationEasing(introProgress, 'cubicOut');
      sim.presentation = interpolateOverviewPresentation(sim.emptyTarget, sim.initialTarget, easedIntro);
      sim.progress = interpolateProgress(
        { percent: 0, complete: false },
        sim.progressStart,
        easedIntro
      );
      continue;
    }

    const normalizedReplayMs = mapReplaySeekMs(sim, t);

    while (sim.eventIndex < (sim.renderData.replay.events || []).length) {
      const event = sim.renderData.replay.events[sim.eventIndex];
      if ((event.at_ms || 0) > normalizedReplayMs) break;
      sim.eventIndex += 1;
      sim.progress = event.payload?.progress || sim.progress;
      if (event.event === 'patch') {
        sim.liveState = mergeLiveEvent(sim.liveState, event.payload, 'patch');
      }
      const nextTarget = buildPresentationTarget(sim.liveState);
      const nextTailActive = isOverviewTailActive(sim.progress?.percent || 0, Boolean(sim.progress && !sim.progress.complete));
      const nextMode = nextTailActive ? 'tail' : 'smooth';
      if (nextMode !== sim.tweenMode) {
        sim.tweenMode = nextMode;
        sim.tweenStartMs = 0;
      }
      if (nextMode === 'tail') {
        sim.tweenFrom = sim.presentation;
        sim.tweenTarget = nextTarget;
        sim.tweenStartMs = t;
      }
      sim.target = nextTarget;
    }

    sim.currentReplaySeekMs = normalizedReplayMs;

    const isTailLanding = t > sim.tailSettleStartMs;
    const ingestActive = true;
    const effectiveDuration = resolveOverviewPresentationDuration(sim.progress?.percent || 0, ingestActive);
    const easing = resolveOverviewPresentationEasing(sim.progress?.percent || 0, ingestActive);
    const tailActive = isOverviewTailActive(sim.progress?.percent || 0, ingestActive);

    if (isTailLanding) {
      if (!sim.finalSettleStarted) {
        sim.finalSettleStarted = true;
        sim.finalSettleFrom = sim.presentation;
      }
      const settleProgress = clamp01((t - sim.tailSettleStartMs) / Math.max(sim.tailSettleDurationMs || 1, 1));
      const easedSettle = applyPresentationEasing(settleProgress, 'cubicOut');
      sim.presentation = interpolateOverviewPresentation(sim.finalSettleFrom, sim.finalTarget, easedSettle);
      sim.progress = {
        ...(sim.progress || {}),
        percent: lerpNumber(sim.progress?.percent || 0, 1, easedSettle),
        complete: settleProgress >= 1,
      };
    } else if (tailActive) {
      if (!sim.tweenStartMs) sim.tweenStartMs = t;
      const rawT = Math.min(1, Math.max(0, (t - sim.tweenStartMs) / Math.max(effectiveDuration, 1)));
      const easedT = applyPresentationEasing(rawT, easing);
      sim.presentation = interpolateOverviewPresentation(sim.tweenFrom, sim.tweenTarget, easedT);
      if (rawT >= 1) {
        sim.presentation = sim.tweenTarget;
        sim.tweenFrom = sim.tweenTarget;
        sim.tweenTarget = sim.target;
      }
    } else {
      const alphaBase = 1 - Math.exp(-(sim.stepMs / Math.max(effectiveDuration, 1)));
      const alpha = applyPresentationEasing(alphaBase, easing);
      sim.presentation = interpolateOverviewPresentation(sim.presentation, sim.target, alpha);
    }
  }

  sim.currentSeekMs = targetSeekMs;
  return snapshotExportSimulation(sim);
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
