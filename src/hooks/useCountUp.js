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
