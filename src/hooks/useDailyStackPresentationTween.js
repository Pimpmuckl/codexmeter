import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { emptyDailyLike, interpolateDaily } from '../utils/overviewPresentation';
import { OVERVIEW_PRESENTATION_DURATION_MS } from '../utils/animationsDefault';

function dailyStackDistance(a, b) {
  const am = new Map((a?.series || []).map((s) => [s.key, s]));
  let max = 0;
  for (const s of b?.series || []) {
    const cur = am.get(s.key);
    for (let i = 0; i < (s.data?.length || 0); i += 1) {
      max = Math.max(max, Math.abs((cur?.data?.[i] || 0) - (s.data[i] || 0)));
    }
  }
  return max;
}

function maxAbsInDaily(d) {
  let m = 0;
  for (const s of d?.series || []) {
    for (const v of s.data || []) m = Math.max(m, Math.abs(v || 0));
  }
  return m;
}

/** Exponential smooth toward targetDaily; scaleResetKey change re-seeds from zeros (layout-synced to avoid one bad paint). */
export function useDailyStackPresentationTween(targetDaily, enabled, scaleResetKey = '') {
  const [animated, setAnimated] = useState(targetDaily);
  const currentRef = useRef(targetDaily);
  const targetRef = useRef(targetDaily);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  const committedKeyRef = useRef(scaleResetKey);
  const prevEnabledRef = useRef(enabled);
  const pendingKey = enabled && committedKeyRef.current !== scaleResetKey;

  useLayoutEffect(() => {
    targetRef.current = targetDaily;
    const turnedOn = !prevEnabledRef.current && enabled;
    prevEnabledRef.current = enabled;

    if (!enabled) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      lastFrameRef.current = 0;
      currentRef.current = targetDaily;
      committedKeyRef.current = scaleResetKey;
      return;
    }

    const keyMismatch = committedKeyRef.current !== scaleResetKey;
    if (keyMismatch) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      lastFrameRef.current = 0;
      const z = emptyDailyLike(targetDaily);
      currentRef.current = z;
      setAnimated(z);
      committedKeyRef.current = scaleResetKey;
      return;
    }

    if (turnedOn) {
      currentRef.current = targetDaily;
      setAnimated(targetDaily);
    }
  }, [targetDaily, enabled, scaleResetKey]);

  useEffect(() => {
    targetRef.current = targetDaily;
    if (!enabled) return undefined;

    const dur = OVERVIEW_PRESENTATION_DURATION_MS;
    const step = (now) => {
      const latest = targetRef.current;
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dt = Math.max(1, now - lastFrameRef.current);
      lastFrameRef.current = now;
      const alpha = 1 - Math.exp(-dt / Math.max(dur, 1));
      const next = interpolateDaily(currentRef.current, latest, alpha);
      currentRef.current = next;
      setAnimated(next);
      const scale = Math.max(1, maxAbsInDaily(latest));
      if (dailyStackDistance(next, latest) <= scale * 0.002 || alpha >= 0.999) {
        currentRef.current = latest;
        setAnimated(latest);
        frameRef.current = 0;
        lastFrameRef.current = 0;
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };

    if (!frameRef.current) {
      lastFrameRef.current = 0;
      frameRef.current = requestAnimationFrame(step);
    }
    return undefined;
  }, [targetDaily, enabled, scaleResetKey]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    lastFrameRef.current = 0;
  }, []);

  if (!enabled) return targetDaily;
  if (pendingKey) return emptyDailyLike(targetDaily);
  return animated;
}
