import { mergeLiveEvent } from '../live-state.js';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from './overviewPresentation.js';
import { OVERVIEW_INGEST_ANIMATION } from './animationsDefault.js';

export function createExportSimulation(renderData) {
  const bootstrapPayload = renderData.replay?.bootstrap?.payload || {};
  const bootstrapProgress = cloneProgress(bootstrapPayload.progress || { percent: 0, complete: false });
  const bootstrapLiveState = mergeLiveEvent(null, bootstrapPayload, 'bootstrap');
  const events = renderData.replay?.events || [];
  const firstDataIndex = events.findIndex(isReplayDataEvent);
  const firstDataAtMs = firstDataIndex >= 0 ? events[firstDataIndex].at_ms || 0 : 0;
  const keyframes = buildPresentationKeyframes(renderData, bootstrapLiveState, events);
  const initialPresentation = keyframes[0]?.presentation || emptyPresentationTarget();
  const initialProgress = firstDataIndex >= 0
    ? cloneProgress(events[firstDataIndex].payload?.progress || bootstrapProgress)
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
  const sourceStartMs = Math.min(Math.max(firstDataAtMs, 0), sourceDurationMs);
  const effectiveSourceDurationMs = Math.max(1, sourceDurationMs - sourceStartMs);
  const tailSourceFraction = clamp01(renderData.tailSourceFraction ?? 0.035);
  const tailSourceDurationMs = Math.max(1, Math.round(effectiveSourceDurationMs * tailSourceFraction));
  const mainReplaySourceDurationMs = Math.max(0, effectiveSourceDurationMs - tailSourceDurationMs);
  const tailSourceStartMs = Math.max(sourceStartMs, sourceDurationMs - tailSourceDurationMs);
  const replayEasing = renderData.replayEasing || 'cubicInOut';
  const tailEasing = renderData.tailEasing || 'cubicInOut';
  const settledPresentation = buildSettledPresentation(renderData);
  const finalPresentation = settledPresentation || keyframes[keyframes.length - 1]?.presentation || initialPresentation;
  const tailStartPresentation = samplePresentationFromKeyframes(keyframes, tailSourceStartMs);
  const lateReplayDurationMs = Math.min(3600, Math.max(1800, Math.round(replayDurationMs * 0.32)));
  const lateReplayStartMs = Math.max(
    frontloadSettledDurationMs + startHoldDurationMs,
    (frontloadSettledDurationMs + startHoldDurationMs + replayDurationMs) - lateReplayDurationMs
  );
  const lateReplayStartProgress = clamp01(
    (lateReplayStartMs - (frontloadSettledDurationMs + startHoldDurationMs)) / Math.max(replayDurationMs, 1)
  );
  const lateReplaySourceStartMs = Math.round(
    sourceStartMs + (mainReplaySourceDurationMs * applyNamedEasing(replayEasing, lateReplayStartProgress))
  );
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

export function snapshotExportSimulation(sim) {
  return {
    liveData: { ready: true },
    presentation: sim.presentation,
    rawPresentation: sim.presentation,
    progress: sim.progress,
    phase: sim.debugState?.phase || 'replay',
    seekMs: sim.currentSeekMs || 0,
  };
}

export function advanceExportSimulation(sim, requestedSeekMs) {
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

export function mapReplaySeekMs(sim, timelineMs) {
  if (timelineMs <= sim.replayStartMs) return 0;

  const replayElapsedMs = timelineMs - sim.replayStartMs;
  if (replayElapsedMs <= sim.replayDurationMs) {
    const progress = clamp01(replayElapsedMs / Math.max(sim.replayDurationMs, 1));
    return sim.sourceStartMs + (sim.mainReplaySourceDurationMs * applyNamedEasing(sim.replayEasing, progress));
  }

  return sim.sourceDurationMs;
}

export function blendExportFrameState(previousFrame, nextFrame, dt, elapsedMs) {
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

export function computeFinalFlashStyle(seekMs, flashStartSeekMs) {
  const exportConfig = OVERVIEW_INGEST_ANIMATION.videoExport || {};
  const flashDurationMs = Math.max(exportConfig.finalFlashDurationMs ?? 280, 0);
  const flashDelayMs = Math.max(exportConfig.finalFlashDelayMs ?? 0, 0);
  const flashMaxOpacity = Math.max(exportConfig.finalFlashMaxOpacity ?? 0.22, 0);
  if (!flashDurationMs || !flashMaxOpacity) {
    return { opacity: 0, boxShadow: 'none' };
  }
  if (flashStartSeekMs == null) {
    return { opacity: 0, boxShadow: 'none' };
  }
  const flashElapsedMs = seekMs - flashStartSeekMs - flashDelayMs;
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

export function computeIntroFadeOpacity(seekMs) {
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

export function computeIntroContentOpacity(seekMs) {
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

function cloneProgress(progress) {
  return progress ? { ...progress } : null;
}

function buildPresentationKeyframes(renderData, bootstrapLiveState, events) {
  const keyframes = [];
  let liveState = bootstrapLiveState;

  for (const event of events) {
    if (!isReplayDataEvent(event)) continue;
    liveState = mergeLiveEvent(liveState, event.payload, event.event);
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

function buildSettledPresentation(renderData) {
  const settled = renderData.settledEnvelope;
  if (!settled?.overview?.data) return null;

  return buildOverviewPresentationTarget({
    overview: settled.overview,
    heatmap: settled.heatmap || { data: {} },
    daily: settled.daily || { data: [] },
    families: settled.families || { data: { total: [], d7: [], d30: [] } },
    repos: settled.repos || { data: { total: [], d7: [], d30: [] } },
    models: settled.models || { data: { total: [], d7: [], d30: [] } },
    range: 'total',
  });
}

function isReplayDataEvent(event) {
  return event?.payload?.data && (
    event.event === 'patch' ||
    event.event === 'snapshot' ||
    event.event === 'complete'
  );
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

export function applyNamedEasing(name, t) {
  switch (name) {
    case 'trainBrake':
      return applyTrainBrake(t);
    case 'cubicOut':
      return applyCubicOut(t);
    case 'cubicInOut':
      return applyCubicInOut(t);
    case 'linear':
      return clamp01(t);
    case 'cubicIn':
    default:
      return applyCubicIn(t);
  }
}
