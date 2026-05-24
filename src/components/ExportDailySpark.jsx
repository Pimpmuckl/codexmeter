import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getModelColor } from '../utils/colors';
import { buildExportDailySparkFrame } from '../utils/exportDailySparkTimeline';

export default function ExportDailySpark({ daily, seekMs = 0, timing = null }) {
  const barsRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 304, height: 104 });
  const frame = useMemo(
    () => buildExportDailySparkFrame(daily, {
      seekMs,
      startMs: timing?.startMs ?? 0,
      endMs: timing?.endMs ?? 1,
    }),
    [daily, seekMs, timing?.startMs, timing?.endMs]
  );

  useLayoutEffect(() => {
    const node = barsRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setChartSize((current) => {
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        return current.width === width && current.height === height
          ? current
          : { width, height };
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!daily?.dates?.length) {
    return (
      <div className="overview-daily-spark overview-daily-spark-empty">
        <span className="overview-daily-spark-title">Daily Usage</span>
        <span className="overview-daily-spark-empty-text">No daily data</span>
      </div>
    );
  }

  const stacks = buildExportStacks(frame);
  const xSpan = Math.max(1, frame.xMax - frame.xMin);
  const widthSlots = Math.max(1, Math.ceil(xSpan));
  const barWidth = snapHalf(Math.max(2, Math.min(24, (chartSize.width / widthSlots) * 0.72)));

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div className="overview-daily-spark-chart">
        <div ref={barsRef} className="overview-daily-spark-bars" aria-hidden="true">
          {stacks.map((stack) => {
            const centerPx = snapHalf(((stack.index - frame.xMin) / xSpan) * chartSize.width);
            const leftPx = snapHalf(centerPx - (barWidth / 2));
            const segmentBoxes = resolveSegmentBoxes(stack.segments, frame.yMax, chartSize.height);
            return (
              <div
                key={stack.date}
                className="overview-daily-spark-bar"
                style={{ left: 0, transform: `translate3d(${leftPx}px, 0, 0)`, width: `${barWidth}px` }}
              >
                {segmentBoxes.map(({ segment, bottomPx, heightPx }, segmentIndex) => {
                  const isBottom = segmentIndex === 0;
                  const isTop = segmentIndex === segmentBoxes.length - 1;
                  const showDecoration = barWidth >= 3 && heightPx >= 3;
                  const borderRadius = showDecoration
                    ? resolveSegmentRadius({ isTop, isBottom, segmentCount: segmentBoxes.length })
                    : 0;
                  return (
                    <span
                      key={segment.key}
                      className="overview-daily-spark-segment"
                      style={{
                        bottom: `${bottomPx}px`,
                        height: `${heightPx}px`,
                        background: segment.color,
                        borderRadius,
                        boxShadow: showDecoration && isTop && !isBottom ? '0 -1px 0 rgba(6, 8, 15, 0.45)' : undefined,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function buildExportStacks(frame) {
  return (frame?.dates || []).map((date, dateIndex) => {
    const firstPoint = frame.series?.[0]?.data?.[dateIndex];
    const index = Array.isArray(firstPoint) ? firstPoint[0] : dateIndex;
    let bottom = 0;
    const segments = [];

    for (const series of frame.series || []) {
      const point = series.data?.[dateIndex];
      const value = Math.max(0, Number(Array.isArray(point) ? point[1] : point) || 0);
      if (value <= 0) continue;
      segments.push({
        key: series.key,
        color: getModelColor(series.key),
        bottom,
        value,
      });
      bottom += value;
    }

    return { date, index, segments };
  });
}

function resolveSegmentBoxes(segments, yMax, chartHeight) {
  const scale = Math.max(1, chartHeight) / Math.max(1, Number(yMax) || 1);
  let bottomPx = 0;
  const boxes = [];

  for (const segment of segments || []) {
    const rawHeight = Math.max(0, segment.value * scale);
    if (rawHeight < 0.5) continue;
    const heightPx = snapHalf(Math.max(0.5, rawHeight));
    boxes.push({ segment, bottomPx, heightPx });
    bottomPx = snapHalf(bottomPx + heightPx);
  }

  return boxes;
}

function resolveSegmentRadius({ isTop, isBottom, segmentCount }) {
  if (isTop && isBottom) return '2px';
  if (segmentCount > 1 && !isTop) return 0;
  if (isTop) return '2px 2px 0 0';
  return 0;
}

function snapHalf(value) {
  return Math.round(value * 2) / 2;
}
