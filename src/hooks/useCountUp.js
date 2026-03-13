import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from previous to target value. Super fast (~180ms).
 * Triggers on value change (e.g. initial read-in, range swap).
 */
export function useCountUp(value, duration = 180) {
  const [display, setDisplay] = useState(value ?? 0);
  const prevRef = useRef(value ?? 0);

  useEffect(() => {
    const target = value ?? 0;
    if (target === prevRef.current) return;
    const start = prevRef.current;
    prevRef.current = target;
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      setDisplay(start + (target - start) * eased);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [value, duration]);

  return display;
}
