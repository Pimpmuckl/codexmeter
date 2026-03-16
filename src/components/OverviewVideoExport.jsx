import React, { useEffect, useRef, useState } from 'react';
import { OverviewFrame } from './Overview';
import { api } from '../api';
import {
  mergeLiveEvent,
} from '../live-state';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from '../utils/overviewPresentation';
import { OVERVIEW_INGEST_ANIMATION } from '../utils/animationsDefault';

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
      const hasCharts = chartCanvases.length >= 4 && chartCanvases.every((node) => {
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
  const frontloadSettledDurationMs = 0;
  const replayDurationMs = Math.max(renderData.replayDurationMs || renderData.replay?.duration_ms || 1, 1);
  const tailDurationMs = Math.max(renderData.tailDurationMs || 0, 0);
  const finalHoldDurationMs = Math.max(renderData.finalHoldDurationMs || 0, 0);
  const totalDurationMs = Math.max(
    renderData.durationMs || (startHoldDurationMs + replayDurationMs + tailDurationMs + finalHoldDurationMs) || 1,
    1
  );
  const sourceDurationMs = Math.max(renderData.replay?.duration_ms || 0, 0);
  const sourceStartMs = Math.min(Math.max(firstPatchAtMs, 0), sourceDurationMs);
  const effectiveSourceDurationMs = Math.max(1, sourceDurationMs - sourceStartMs);
  const tailSourceFraction = clamp01(renderData.tailSourceFraction ?? 0.035);
  const tailSourceDurationMs = Math.max(1, Math.round(effectiveSourceDurationMs * tailSourceFraction));
  const mainReplaySourceDurationMs = Math.max(0, effectiveSourceDurationMs - tailSourceDurationMs);
  const tailSourceStartMs = Math.max(sourceStartMs, sourceDurationMs - tailSourceDurationMs);
  const replayEasing = renderData.replayEasing || 'cubicInOut';
  const tailEasing = renderData.tailEasing || 'cubicInOut';
  const finalPresentation = keyframes[keyframes.length - 1]?.presentation || initialPresentation;
  const tailStartPresentation = samplePresentationFromKeyframes(keyframes, tailSourceStartMs);
  const lateReplayDurationMs = Math.min(3600, Math.max(1800, Math.round(replayDurationMs * 0.32)));
  const lateReplayStartMs = Math.max(
    frontloadSettledDurationMs + startHoldDurationMs,
    (frontloadSettledDurationMs + startHoldDurationMs + replayDurationMs) - lateReplayDurationMs
  );
  const lateReplayStartProgress = clamp01(
    (lateReplayStartMs - (frontloadSettledDurationMs + startHoldDurationMs)) / Math.max(replayDurationMs, 1)
  );
  const lateReplaySourceStartMs = Math.round(sourceStartMs + (mainReplaySourceDurationMs * applyCubicIn(lateReplayStartProgress)));
  const lateReplayStartPresentation = samplePresentationFromKeyframes(keyframes, lateReplaySourceStartMs);
  const lateReplayFrames = buildSmoothedTransitionFrames({
    keyframes,
    startSourceMs: lateReplaySourceStartMs,
    endSourceMs: tailSourceStartMs,
    startPresentation: lateReplayStartPresentation,
    endPresentation: tailStartPresentation,
    durationMs: lateReplayDurationMs,
    startSmoothing: 0.05,
    endSmoothing: 0.14,
  });
  const tailFrames = buildSmoothedTailFrames({
    keyframes,
    tailSourceStartMs,
    sourceDurationMs,
    tailStartPresentation,
    finalPresentation,
    tailDurationMs,
  });

  return {
    renderData,
    totalDurationMs,
    frontloadSettledDurationMs,
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
    lateReplayStartMs,
    lateReplayDurationMs,
    lateReplaySourceStartMs,
    tailStartMs: startHoldDurationMs + replayDurationMs,
    finalHoldStartMs: startHoldDurationMs + replayDurationMs + tailDurationMs,
    currentSeekMs: 0,
    started: false,
    finished: false,
    startWallClockMs: 0,
    initialPresentation,
    presentation: initialPresentation,
    keyframes,
    keyframeIndex: 0,
    lateReplayFrames,
    tailStartPresentation,
    tailFrames,
    finalPresentation,
    progress: initialProgress || { ...bootstrapProgress, percent: 0, complete: false },
    bootstrapProgress,
    replayEasing,
    tailEasing,
    debugState: null,
    debugTrace: [],
  };
}

function snapshotExportSimulation(sim) {
  return {
    liveData: { ready: true },
    presentation: sim.presentation,
    rawPresentation: sim.presentation,
    progress: sim.progress,
    phase: sim.debugState?.phase || 'replay',
    seekMs: sim.currentSeekMs || 0,
  };
}

function advanceExportSimulation(sim, requestedSeekMs) {
  const targetSeekMs = Math.min(Math.max(Number(requestedSeekMs) || 0, 0), sim.totalDurationMs);
  sim.currentSeekMs = targetSeekMs;
  let phase = 'replay';
  let sourceMs = 0;
  let tailProgress = null;

  if (targetSeekMs < sim.startHoldDurationMs) {
    phase = 'start_hold';
    sim.presentation = sim.initialPresentation || emptyPresentationTarget();
  } else if (targetSeekMs < sim.tailStartMs) {
    if (targetSeekMs < sim.lateReplayStartMs) {
      sourceMs = mapReplaySeekMs(sim, targetSeekMs);
      sim.presentation = samplePresentationAtSource(sim, sourceMs);
    } else {
      const lateReplayProgress = clamp01((targetSeekMs - sim.lateReplayStartMs) / Math.max(sim.lateReplayDurationMs, 1));
      sourceMs = lerpNumber(sim.lateReplaySourceStartMs, sim.tailSourceStartMs, lateReplayProgress);
      sim.presentation = sampleMotionTrack(sim.lateReplayFrames, applyCubicInOut(lateReplayProgress));
    }
  } else if (targetSeekMs < sim.finalHoldStartMs) {
    phase = 'tail';
    tailProgress = clamp01((targetSeekMs - sim.tailStartMs) / Math.max(sim.tailDurationMs, 1));
    sim.presentation = sampleMotionTrack(sim.tailFrames, applyNamedEasing(sim.tailEasing, tailProgress));
  } else {
    phase = 'final_hold';
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

  const debugState = {
    frame: sim.debugTrace.length,
    seekMs: targetSeekMs,
    phase,
    sourceMs,
    tailProgress,
    progress: sim.progress?.percent ?? 0,
    complete: Boolean(sim.progress?.complete),
    signature: buildPresentationSignature(sim.presentation),
  };
  sim.debugState = debugState;
  sim.debugTrace.push(debugState);

  return snapshotExportSimulation(sim);
}

function mapReplaySeekMs(sim, timelineMs) {
  if (timelineMs <= sim.replayStartMs) return 0;

  const replayElapsedMs = timelineMs - sim.replayStartMs;
  if (replayElapsedMs <= sim.replayDurationMs) {
    const progress = clamp01(replayElapsedMs / Math.max(sim.replayDurationMs, 1));
    return sim.sourceStartMs + (sim.mainReplaySourceDurationMs * applyCubicIn(progress));
  }

  return sim.sourceDurationMs;
}

function cloneProgress(progress) {
  return progress ? { ...progress } : null;
}

function blendExportFrameState(previousFrame, nextFrame, dt, elapsedMs) {
  if (!previousFrame) return nextFrame;
  const exportConfig = OVERVIEW_INGEST_ANIMATION.videoExport || {};
  const displayTweenStartMs = exportConfig.displayTweenStartMs ?? 200;
  if (elapsedMs < displayTweenStartMs) return nextFrame;

  const overallDurationMs = (
    (exportConfig.startHoldDurationMs ?? 0) +
    (exportConfig.replayDurationMs ?? 0) +
    (exportConfig.tailDurationMs ?? 0) +
    (exportConfig.finalHoldDurationMs ?? 0)
  ) || 19000;
  const lateWindowMs = exportConfig.displayTweenLateWindowMs ?? 2200;
  const lateWindowStartMs = overallDurationMs - lateWindowMs;
  const lateWindowT = clamp01((elapsedMs - lateWindowStartMs) / Math.max(lateWindowMs, 1));
  const tweenMs = Math.round(
    lerpNumber(
      exportConfig.displayTweenBaseMs ?? 240,
      exportConfig.displayTweenLateMs ?? 420,
      applyCubicOut(lateWindowT)
    )
  );
  const alpha = applyCubicOut(1 - Math.exp(-dt / Math.max(tweenMs, 1)));
  const prevProgress = previousFrame.progress || {};
  const nextProgress = nextFrame.progress || {};

  return {
    liveData: nextFrame.liveData,
    presentation: interpolateOverviewPresentation(previousFrame.presentation, nextFrame.presentation, alpha),
    rawPresentation: nextFrame.rawPresentation || nextFrame.presentation,
    progress: {
      ...nextProgress,
      percent: lerpNumber(prevProgress.percent || 0, nextProgress.percent || 0, alpha),
      complete: nextProgress.complete,
    },
    phase: nextFrame.phase,
    seekMs: nextFrame.seekMs || 0,
  };
}

function computeFinalFlashStyle(seekMs, flashStartSeekMs) {
  const exportConfig = OVERVIEW_INGEST_ANIMATION.videoExport || {};
  const flashDurationMs = Math.max(exportConfig.finalFlashDurationMs ?? 280, 0);
  const flashMaxOpacity = Math.max(exportConfig.finalFlashMaxOpacity ?? 0.22, 0);
  if (!flashDurationMs || !flashMaxOpacity) {
    return { opacity: 0, boxShadow: 'none' };
  }
  if (flashStartSeekMs == null) {
    return { opacity: 0, boxShadow: 'none' };
  }
  const flashElapsedMs = seekMs - flashStartSeekMs;
  if (flashElapsedMs < 0 || flashElapsedMs > flashDurationMs) {
    return { opacity: 0, boxShadow: 'none' };
  }

  const t = clamp01(flashElapsedMs / flashDurationMs);
  const opacity = flashMaxOpacity * (1 - applyCubicOut(t));
  const bloomOpacity = Math.min(1, opacity * 0.7);
  return {
    opacity,
    boxShadow: `0 0 120px 50px rgba(255, 255, 255, ${bloomOpacity}) inset`,
  };
}

function computeIntroFadeOpacity(seekMs) {
  const exportConfig = OVERVIEW_INGEST_ANIMATION.videoExport || {};
  if (!exportConfig.introFadeEnabled) return 0;
  const startOpacity = Math.max(0, Math.min(1, exportConfig.introFadeStartOpacity ?? 0.2));
  const delayMs = Math.max(0, exportConfig.introFadeDelayMs ?? 0);
  const durationMs = Math.max(0, exportConfig.introFadeDurationMs ?? 900);
  if (!startOpacity) return 0;
  if (seekMs <= delayMs) return startOpacity;
  if (!durationMs) return 0;
  const t = clamp01((seekMs - delayMs) / durationMs);
  const eased = applyNamedEasing(exportConfig.introFadeEasing || 'cubicOut', t);
  return startOpacity * (1 - eased);
}

function computeIntroContentOpacity(seekMs) {
  const exportConfig = OVERVIEW_INGEST_ANIMATION.videoExport || {};
  if (!exportConfig.introFadeEnabled) return 1;
  const startOpacity = Math.max(0, Math.min(1, exportConfig.introContentStartOpacity ?? 0.35));
  const delayMs = Math.max(0, exportConfig.introFadeDelayMs ?? 0);
  const durationMs = Math.max(0, exportConfig.introFadeDurationMs ?? 900);
  if (seekMs <= delayMs) return startOpacity;
  if (!durationMs) return 1;
  const t = clamp01((seekMs - delayMs) / durationMs);
  const eased = applyNamedEasing(exportConfig.introFadeEasing || 'cubicOut', t);
  return lerpNumber(startOpacity, 1, eased);
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

  if (!keyframes.length) {
    keyframes.push({ at_ms: 0, presentation: emptyPresentationTarget() });
  }

  return keyframes;
}

function samplePresentationAtSource(sim, sourceMs) {
  return samplePresentationFromKeyframes(sim.keyframes, sourceMs, sim);
}

function sampleMotionTrack(frames, progress) {
  if (!frames?.length) return emptyPresentationTarget();
  if (progress <= frames[0].u) return frames[0].presentation;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const from = frames[i];
    const to = frames[i + 1];
    if (progress <= to.u) {
      const localT = clamp01((progress - from.u) / Math.max(to.u - from.u, 1e-6));
      return interpolateOverviewPresentation(from.presentation, to.presentation, localT);
    }
  }

  return frames[frames.length - 1].presentation;
}

function buildSmoothedTailFrames({ keyframes, tailSourceStartMs, sourceDurationMs, tailStartPresentation, finalPresentation, tailDurationMs }) {
  return buildSmoothedTransitionFrames({
    keyframes,
    startSourceMs: tailSourceStartMs,
    endSourceMs: sourceDurationMs,
    startPresentation: tailStartPresentation,
    endPresentation: finalPresentation,
    durationMs: tailDurationMs,
    startSmoothing: 0.08,
    endSmoothing: 0.2,
    bidirectional: true,
  });
}

function buildSmoothedTransitionFrames({
  keyframes,
  startSourceMs,
  endSourceMs,
  startPresentation,
  endPresentation,
  durationMs,
  startSmoothing,
  endSmoothing,
  bidirectional = false,
}) {
  const checkpointCount = Math.max(36, Math.min(96, Math.round(durationMs / 80)));
  const rawFrames = [{ u: 0, presentation: startPresentation }];

  for (let i = 1; i < checkpointCount - 1; i += 1) {
    const u = i / (checkpointCount - 1);
    const sourceMs = lerpNumber(startSourceMs, endSourceMs, u);
    rawFrames.push({ u, presentation: samplePresentationFromKeyframes(keyframes, sourceMs) });
  }

  rawFrames.push({ u: 1, presentation: endPresentation });

  const forwardFrames = [{ u: 0, presentation: startPresentation }];
  let previousForward = startPresentation;
  for (let i = 1; i < rawFrames.length - 1; i += 1) {
    const frame = rawFrames[i];
    const smoothing = lerpNumber(startSmoothing, endSmoothing, frame.u);
    previousForward = interpolateOverviewPresentation(previousForward, frame.presentation, smoothing);
    forwardFrames.push({ u: frame.u, presentation: previousForward });
  }
  forwardFrames.push({ u: 1, presentation: endPresentation });

  if (!bidirectional) {
    return forwardFrames;
  }

  const backwardFrames = new Array(rawFrames.length);
  backwardFrames[rawFrames.length - 1] = { u: 1, presentation: endPresentation };
  let previousBackward = endPresentation;
  for (let i = rawFrames.length - 2; i > 0; i -= 1) {
    const frame = rawFrames[i];
    const smoothing = lerpNumber(endSmoothing, startSmoothing, 1 - frame.u);
    previousBackward = interpolateOverviewPresentation(previousBackward, frame.presentation, smoothing);
    backwardFrames[i] = { u: frame.u, presentation: previousBackward };
  }
  backwardFrames[0] = { u: 0, presentation: startPresentation };

  return rawFrames.map((frame, index) => {
    if (index === 0) return { u: 0, presentation: startPresentation };
    if (index === rawFrames.length - 1) return { u: 1, presentation: endPresentation };
    return {
      u: frame.u,
      presentation: interpolateOverviewPresentation(
        forwardFrames[index].presentation,
        backwardFrames[index].presentation,
        applyCubicInOut(frame.u)
      ),
    };
  });
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

function buildPresentationSignature(presentation) {
  if (!presentation) return null;
  const stats = presentation.stats || {};
  const daily = presentation.daily || { dates: [], series: [] };
  const repos = Array.isArray(presentation.topRepos) ? presentation.topRepos : [];
  const models = Array.isArray(presentation.topModels) ? presentation.topModels : [];
  const lastDailyIndex = Math.max(0, (daily.dates?.length || 0) - 1);
  const lastDailyDate = daily.dates?.[lastDailyIndex] || null;
  const lastDailyTotal = (daily.series || []).reduce((sum, series) => sum + (Number(series?.data?.[lastDailyIndex]) || 0), 0);
  const topRepo = repos[0] || null;
  const topModel = models[0] || null;
  return {
    totalTokens: Math.round(Number(stats.tokens) || 0),
    totalCost: Number((Number(stats.cost) || 0).toFixed(4)),
    totalSessions: Math.round(Number(stats.sessions) || 0),
    dailyPoints: daily.dates?.length || 0,
    lastDailyDate,
    lastDailyTotal: Math.round(lastDailyTotal),
    topRepo: topRepo?.label || null,
    topRepoValue: Math.round(Number(topRepo?.tokens) || 0),
    topModel: topModel?.label || null,
    topModelValue: Math.round(Number(topModel?.tokens) || 0),
  };
}

function applyCubicIn(t) {
  const x = clamp01(t);
  return x * x * x;
}

function applyCubicInOut(t) {
  const x = clamp01(t);
  if (x < 0.5) return 4 * x * x * x;
  return 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function applyCubicOut(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function applyTrainBrake(t) {
  const x = clamp01(t);
  const anchors = [
    [0, 0],
    [0.12, 0.03],
    [0.24, 0.09],
    [0.4, 0.22],
    [0.58, 0.42],
    [0.74, 0.62],
    [0.86, 0.77],
    [0.93, 0.86],
    [0.975, 0.93],
    [0.992, 0.975],
    [1, 1],
  ];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [fromT, fromValue] = anchors[i];
    const [toT, toValue] = anchors[i + 1];
    if (x <= toT) {
      const segmentT = clamp01((x - fromT) / Math.max(toT - fromT, 1e-6));
      return lerpNumber(fromValue, toValue, applyCubicInOut(segmentT));
    }
  }

  return 1;
}

function applyNamedEasing(name, t) {
  switch (name) {
    case 'trainBrake':
      return applyTrainBrake(t);
    case 'cubicOut':
      return applyCubicOut(t);
    case 'cubicIn':
    default:
      return applyCubicIn(t);
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
