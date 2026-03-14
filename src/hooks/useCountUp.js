import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from previous to target value. Super fast (~180ms).
 * Triggers on value change (e.g. initial read-in, range swap).
 */
export function useCountUp(value, duration = 180) {
  const [display, setDisplay] = useState(value ?? 0);
  const targetRef = useRef(value ?? 0);
  const frameRef = useRef(0);

  useEffect(() => {
    targetRef.current = value ?? 0;
    if (frameRef.current) return;

    const step = () => {
      setDisplay((current) => {
        const target = targetRef.current;
        const delta = target - current;
        if (Math.abs(delta) < 0.5) {
          frameRef.current = 0;
          return target;
        }
        frameRef.current = requestAnimationFrame(step);
        return current + delta * Math.min(1, 16 / Math.max(duration, 16));
      });
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [value, duration]);

  return display;
}

/** Animates multiple numbers from current to target, same logic as useCountUp. Use for bar chart labels. */
export function useCountUpValues(values, duration = 180) {
  const MAX = 6;
  const padded = [...(values || []).slice(0, MAX)];
  while (padded.length < MAX) padded.push(0);
  const targets = padded.map((v) => v ?? 0);

  const [display, setDisplay] = useState(() => targets);
  const targetRef = useRef(targets);
  const frameRef = useRef(0);

  useEffect(() => {
    targetRef.current = targets;
    if (frameRef.current) return;

    const step = () => {
      setDisplay((current) => {
        const target = targetRef.current;
        let done = true;
        const next = current.map((c, i) => {
          const t = target[i] ?? 0;
          const delta = t - c;
          if (Math.abs(delta) >= 0.5) done = false;
          return Math.abs(delta) < 0.5 ? t : c + delta * Math.min(1, 16 / Math.max(duration, 16));
        });
        if (!done) frameRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [targets.join(',')]);

  return display;
}

/** Animates progress from 0 to 1 when key changes. Use for bar chart labels "running up".
 *  Key must be a stable primitive (string/number) - only triggers when it actually changes. */
export function useAnimationProgress(key, duration = 180) {
  const [progress, setProgress] = useState(1);
  const frameRef = useRef(0);

  useEffect(() => {
    setProgress(0);
    const start = performance.now();
    const step = (now) => {
      const elapsed = now - start;
      const next = Math.min(1, elapsed / duration);
      setProgress(next);
      if (next < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [key, duration]);

  return progress;
}
