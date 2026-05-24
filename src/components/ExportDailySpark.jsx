import React, { useMemo } from 'react';
import { getModelColor } from '../utils/colors';
import { buildExportDailySparkFrame } from '../utils/exportDailySparkTimeline';

export default function ExportDailySpark({ daily, seekMs = 0, timing = null }) {
  const frame = useMemo(
    () => buildExportDailySparkFrame(daily, {
      seekMs,
      startMs: timing?.startMs ?? 0,
      endMs: timing?.endMs ?? 1,
    }),
    [daily, seekMs, timing?.startMs, timing?.endMs]
  );

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
  const barWidth = snapHalf(Math.max(2, Math.min(frame.barMaxWidth || frame.barWidth || 2, frame.barWidth || 2)));

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div className="overview-daily-spark-chart">
        <div className="overview-daily-spark-bars" aria-hidden="true">
          {stacks.map((stack) => {
            const centerPct = ((stack.index - frame.xMin) / xSpan) * 100;
            return (
              <div
                key={stack.date}
                className="overview-daily-spark-bar"
                style={{ left: `${centerPct}%`, width: `${barWidth}px` }}
              >
                {stack.segments.map((segment, segmentIndex) => {
                  const isBottom = segmentIndex === 0;
                  const isTop = segmentIndex === stack.segments.length - 1;
                  const showDecoration = barWidth >= 3 && segment.heightPx >= 3;
                  return (
                    <span
                      key={segment.key}
                      className="overview-daily-spark-segment"
                      style={{
                        bottom: `${segment.bottomPct}%`,
                        height: `${segment.heightPct}%`,
                        background: segment.color,
                        borderRadius: showDecoration ? resolveSegmentRadius(isTop, isBottom) : 0,
                        boxShadow: showDecoration && !isBottom ? '0 -1px 0 rgba(6, 8, 15, 0.45)' : undefined,
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
  const yMax = Math.max(1, Number(frame?.yMax) || 1);
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
        bottomPct: (bottom / yMax) * 100,
        heightPct: (value / yMax) * 100,
        heightPx: (value / yMax) * 104,
      });
      bottom += value;
    }

    return { date, index, segments };
  });
}

function resolveSegmentRadius(isTop, isBottom) {
  if (isTop && isBottom) return '2px';
  if (isTop) return '2px 2px 0 0';
  if (isBottom) return '0 0 2px 2px';
  return 0;
}

function snapHalf(value) {
  return Math.round(value * 2) / 2;
}
