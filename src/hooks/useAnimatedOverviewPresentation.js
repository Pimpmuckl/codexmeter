import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from '../utils/overviewPresentation';
import {
  OVERVIEW_PRESENTATION_DURATION_MS,
  resolveOverviewPresentationDuration,
  resolveOverviewPresentationEasing,
  isOverviewTailActive,
} from '../utils/animationsDefault';

export function useAnimatedOverviewPresentation(
  inputs,
  {
    duration = OVERVIEW_PRESENTATION_DURATION_MS,
    onSettledChange,
    ingestProgress = 0,
    isIngestActive = false,
    clockNowMs = null,
  } = {}
) {
  const target = useMemo(
    () => buildOverviewPresentationTarget(inputs),
    [inputs.overview, inputs.heatmap, inputs.daily, inputs.families, inputs.repos, inputs.models, inputs.range]
  );

  const [animated, setAnimated] = useState(target);
  const currentRef = useRef(target);
  const targetRef = useRef(target);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const animatedRef = useRef(animated);
  const settledRef = useRef(true);
  const onSettledChangeRef = useRef(onSettledChange);
  const tweenStartRef = useRef(0);
  const tweenFromRef = useRef(target);
  const tweenTargetRef = useRef(target);
  const tweenModeRef = useRef('smooth');

  useEffect(() => {
    onSettledChangeRef.current = onSettledChange;
  }, [onSettledChange]);

  const emitSettled = (nextSettled) => {
    if (settledRef.current === nextSettled) return;
    settledRef.current = nextSettled;
    onSettledChangeRef.current?.(nextSettled);
  };

  useEffect(() => {
    animatedRef.current = animated;
  }, [animated]);

  const applyImmediateTarget = (nextTarget) => {
    currentRef.current = nextTarget;
    targetRef.current = nextTarget;
    animatedRef.current = nextTarget;
    setAnimated(nextTarget);
    emitSettled(true);
    lastFrameRef.current = 0;
    tweenStartRef.current = 0;
    tweenFromRef.current = nextTarget;
    tweenTargetRef.current = nextTarget;
  };

  const prepareTargetTransition = (nextTarget) => {
    targetRef.current = nextTarget;
    emitSettled(false);
    const nextTailActive = isOverviewTailActive(ingestProgress, isIngestActive);
    const nextMode = nextTailActive ? 'tail' : 'smooth';
    if (tweenModeRef.current !== nextMode) {
      tweenModeRef.current = nextMode;
      tweenStartRef.current = 0;
    }
    if (nextMode === 'tail') {
      tweenFromRef.current = currentRef.current;
      tweenTargetRef.current = nextTarget;
      tweenStartRef.current = 0;
    }
  };

  const stepAnimator = (now, latestTarget) => {
    if (now < lastFrameRef.current) {
      lastFrameRef.current = 0;
      tweenStartRef.current = 0;
      tweenFromRef.current = currentRef.current;
      tweenTargetRef.current = latestTarget;
    }
    if (!lastFrameRef.current) lastFrameRef.current = now;
    const dt = Math.max(1, now - lastFrameRef.current);
    lastFrameRef.current = now;
    const effectiveDuration = resolveOverviewPresentationDuration(ingestProgress, isIngestActive) || duration;

    const current = currentRef.current;
    const tailActive = isOverviewTailActive(ingestProgress, isIngestActive);
    const nextModeInner = tailActive ? 'tail' : 'smooth';
    if (tweenModeRef.current !== nextModeInner) {
      tweenModeRef.current = nextModeInner;
      tweenStartRef.current = 0;
    }

    let next;
    let settled;

    if (nextModeInner === 'tail') {
      if (tweenTargetRef.current !== latestTarget) {
        tweenFromRef.current = current;
        tweenTargetRef.current = latestTarget;
        tweenStartRef.current = now;
      }
      if (!tweenStartRef.current) tweenStartRef.current = now;
      const elapsed = Math.max(0, now - tweenStartRef.current);
      const rawT = Math.min(1, elapsed / Math.max(effectiveDuration, 1));
      const easedT = applyPresentationEasing(
        rawT,
        resolveOverviewPresentationEasing(ingestProgress, isIngestActive)
      );
      next = interpolateOverviewPresentation(tweenFromRef.current, tweenTargetRef.current, easedT);
      settled = rawT >= 1 || presentationDistance(next, latestTarget) <= 0.002;
    } else {
      const alphaBase = 1 - Math.exp(-dt / Math.max(effectiveDuration, 1));
      const alpha = applyPresentationEasing(
        alphaBase,
        resolveOverviewPresentationEasing(ingestProgress, isIngestActive)
      );
      next = interpolateOverviewPresentation(current, latestTarget, alpha);
      settled = alpha >= 0.999 || presentationDistance(next, latestTarget) <= 0.002;
    }

    currentRef.current = next;
    if (settled) {
      currentRef.current = latestTarget;
      animatedRef.current = latestTarget;
      setAnimated(latestTarget);
      emitSettled(true);
      tweenStartRef.current = 0;
      tweenFromRef.current = latestTarget;
      tweenTargetRef.current = latestTarget;
      return latestTarget;
    }

    animatedRef.current = next;
    setAnimated(next);
    return next;
  };

  useLayoutEffect(() => {
    if (clockNowMs == null) return undefined;
    if (duration <= 0) {
      applyImmediateTarget(target);
      return undefined;
    }
    prepareTargetTransition(target);
    stepAnimator(clockNowMs, target);
    return undefined;
  }, [target, duration, ingestProgress, isIngestActive, clockNowMs]);

  useEffect(() => {
    if (clockNowMs != null) return undefined;
    targetRef.current = target;
    if (duration <= 0) {
      applyImmediateTarget(target);
      return undefined;
    }
    prepareTargetTransition(target);
    if (frameRef.current) return undefined;
    const step = (now) => {
      const next = stepAnimator(now, targetRef.current);
      if (next === targetRef.current && settledRef.current) {
        frameRef.current = 0;
        lastFrameRef.current = 0;
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return undefined;
  }, [target, duration, ingestProgress, isIngestActive, clockNowMs]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    lastFrameRef.current = 0;
  }, []);

  return animated;
}

function applyPresentationEasing(t, easing) {
  const x = Math.min(Math.max(t, 0), 1);
  if (easing === 'cubicOut') {
    return 1 - Math.pow(1 - x, 3);
  }
  return x;
}

function presentationDistance(current, target) {
  if (!current || !target) return 0;

  const statDiff = Math.max(
    Math.abs((current.stats?.tokens || 0) - (target.stats?.tokens || 0)),
    Math.abs((current.stats?.elapsed || 0) - (target.stats?.elapsed || 0)),
    Math.abs((current.stats?.cost || 0) - (target.stats?.cost || 0)),
    Math.abs((current.stats?.sessions || 0) - (target.stats?.sessions || 0))
  );

  const repoDiff = maxRowDelta(current.topRepos, target.topRepos);
  const familyDiff = maxRowDelta(current.topFamilies, target.topFamilies);
  const modelDiff = maxRowDelta(current.topModels, target.topModels);
  const dailyDiff = maxDailyDelta(current.daily, target.daily);

  return Math.max(statDiff, repoDiff, familyDiff, modelDiff, dailyDiff) / Math.max(1, target.stats?.tokens || 1);
}

function maxRowDelta(currentRows = [], targetRows = []) {
  const map = new Map(currentRows.map((row) => [row.key, row.tokens || 0]));
  let max = 0;
  for (const row of targetRows) {
    max = Math.max(max, Math.abs((map.get(row.key) || 0) - (row.tokens || 0)));
  }
  return max;
}

function maxDailyDelta(currentDaily, targetDaily) {
  const currentSeries = new Map((currentDaily?.series || []).map((series) => [series.key, series]));
  let max = 0;
  for (const series of targetDaily?.series || []) {
    const current = currentSeries.get(series.key);
    for (let i = 0; i < series.data.length; i += 1) {
      max = Math.max(max, Math.abs((current?.data?.[i] || 0) - (series.data[i] || 0)));
    }
  }
  return max;
}
