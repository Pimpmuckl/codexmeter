import { useEffect, useMemo, useRef, useState } from 'react';
import { buildOverviewPresentationTarget, interpolateOverviewPresentation } from '../utils/overviewPresentation';
import { OVERVIEW_PRESENTATION_DURATION_MS } from '../utils/echartsDefaults';

export function useAnimatedOverviewPresentation(inputs, duration = OVERVIEW_PRESENTATION_DURATION_MS) {
  const target = useMemo(
    () => buildOverviewPresentationTarget(inputs),
    [inputs.overview, inputs.heatmap, inputs.daily, inputs.families, inputs.repos, inputs.models, inputs.range]
  );

  const [animated, setAnimated] = useState(target);
  const currentRef = useRef(target);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = currentRef.current;
    const to = target;

    if (duration <= 0) {
      currentRef.current = to;
      setAnimated(to);
      return;
    }

    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = interpolateOverviewPresentation(from, to, progress);
      currentRef.current = next;
      setAnimated(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }
      frameRef.current = 0;
      currentRef.current = to;
      setAnimated(to);
    };

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [target, duration]);

  return animated;
}
