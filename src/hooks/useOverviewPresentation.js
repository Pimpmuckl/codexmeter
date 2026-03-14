import { useEffect, useRef, useState } from 'react';
import { OVERVIEW_PRESENTATION_INTERVAL_MS } from '../utils/echartsDefaults';

export function useOverviewPresentation(target, { enabled, intervalMs = OVERVIEW_PRESENTATION_INTERVAL_MS } = {}) {
  const [displayed, setDisplayed] = useState(() => target || null);
  const displayedRef = useRef(displayed);
  const latestRef = useRef(displayed);
  const timerRef = useRef(0);

  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    latestRef.current = target || null;

    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
      if (displayedRef.current !== latestRef.current) {
        displayedRef.current = latestRef.current;
        setDisplayed(latestRef.current);
      }
      return undefined;
    }

    if (!displayedRef.current && latestRef.current) {
      displayedRef.current = latestRef.current;
      setDisplayed(latestRef.current);
      return undefined;
    }

    if (timerRef.current) return undefined;

    const scheduleTick = () => {
      timerRef.current = setTimeout(() => {
        timerRef.current = 0;
        if (!enabled) return;

        const latest = latestRef.current;
        if (latest !== displayedRef.current) {
          displayedRef.current = latest;
          setDisplayed(latest);
        }

        if (latestRef.current !== displayedRef.current) {
          scheduleTick();
        }
      }, intervalMs);
    };

    scheduleTick();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
    };
  }, [enabled, intervalMs, target]);

  return displayed;
}
