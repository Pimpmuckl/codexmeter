import React, { memo, useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import ReactEChartsCore from '../utils/echartsReact';
import ExportDailySpark from './ExportDailySpark';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getRepoColor, getFamilyColor, getModelColor, getContrastLabelColor } from '../utils/colors';
import { formatCompactNumber } from '../utils/formatters';
import {
  ECHARTS_OVERVIEW_DAILY,
  ECHARTS_OVERVIEW_BARS,
  ECHARTS_OVERVIEW_DONUTS,
  ECHARTS_OVERVIEW_DONUT_SERIES_ANIMATION,
  OVERVIEW_INGEST_ANIMATION,
  OVERVIEW_PRESENTATION_DURATION_MS,
} from '../utils/animationsDefault';
import { useAnimatedOverviewPresentation } from '../hooks/useAnimatedOverviewPresentation';
import { useDailyStackPresentationTween } from '../hooks/useDailyStackPresentationTween';
import { buildDailyCursorPresentationTarget, buildOverviewPresentationTarget, getZoomSlice } from '../utils/overviewPresentation';
import { debugLive, summarizeDailyData, summarizeHeatmapData } from '../utils/liveDebug';
import { buildDailyStackPresentation } from '../utils/dailyStack';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, CanvasRenderer]);

function fmt(n) {
  return formatCompactNumber(n);
}

function fmtCost(n) {
  if (n == null) return '—';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function fmtHours(sec) {
  if (!sec) return '0h';
  return (sec / 3600).toFixed(1) + 'h';
}

function wrapRepoLabel(label, maxLineLength = 16) {
  if (!label) return '';
  const parts = String(label).split(/([-/])/).filter(Boolean);
  const lines = [''];

  for (const part of parts) {
    const current = lines[lines.length - 1];
    if (!current.length || (current + part).length <= maxLineLength) {
      lines[lines.length - 1] = current + part;
      continue;
    }
    if (lines.length === 2) {
      lines[1] += part;
      break;
    }
    lines.push(part);
  }

  return lines.join('\n');
}

function getOverviewDailyBarSizing(count) {
  const safeCount = Math.max(1, count || 1);
  const slotWidth = 300 / safeCount;
  const densityFactor = safeCount > 80 ? 0.68 : safeCount > 45 ? 0.78 : 0.88;
  const barWidth = Math.max(1.25, Math.min(24, slotWidth * densityFactor));
  return { barWidth, barMaxWidth: Math.max(4, Math.min(28, barWidth * 1.2)) };
}

function buildFullDailySparkPresentation(daily) {
  const { dates, series } = buildDailyStackPresentation(daily, { split: 'model', metric: 'tokens' });
  return { dates, series };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function resolveDailyRevealTargetIndex(dates, isIngestActive, ingestProgress = 0) {
  if (!dates?.length) return 0;
  if (!isIngestActive) return dates.length - 1;

  const startIndex = resolveDailyRevealStartIndex(dates, isIngestActive);
  const lastIndex = dates.length - 1;
  const normalizedProgress = clamp01(((ingestProgress || 0) - 0.08) / 0.92);
  const easedProgress = Math.pow(normalizedProgress, 0.82);
  const progressTarget = startIndex + (lastIndex - startIndex) * easedProgress;
  const elasticLookaheadDays = 32;
  return Math.max(startIndex, Math.min(lastIndex, Math.floor(progressTarget + elasticLookaheadDays)));
}

function resolveDailyRevealStartIndex(dates, isIngestActive) {
  if (!dates?.length) return 0;
  if (!isIngestActive) return dates.length - 1;
  return Math.min(dates.length - 1, 6);
}

function resolveEffectiveDailyTargetIndex(rawTargetIndex, cursor, datesLength, isIngestActive) {
  if (!isIngestActive) return rawTargetIndex;
  const lastIndex = Math.max(0, (datesLength || 1) - 1);
  const current = Math.max(0, Math.min(lastIndex, Number.isFinite(cursor) ? cursor : 0));
  if (current >= lastIndex - 0.01) return lastIndex;
  return Math.max(rawTargetIndex, Math.min(lastIndex, current + 1.25));
}

function sliceDailyAtCursor(daily, cursor) {
  if (!daily?.dates?.length) return { dates: [], series: [] };
  const lastIndex = daily.dates.length - 1;
  const clampedCursor = Math.max(0, Math.min(lastIndex, cursor || 0));
  const fullIndex = Math.floor(clampedCursor);
  const nextIndex = Math.min(lastIndex, Math.ceil(clampedCursor));
  const fractional = clampedCursor - fullIndex;
  const visibleCount = Math.max(1, nextIndex + 1);
  const dates = daily.dates.slice(0, visibleCount);
  const series = (daily.series || []).map((sourceSeries) => ({
    ...sourceSeries,
    data: dates.map((_, index) => {
      const value = sourceSeries.data?.[index] || 0;
      if (index <= fullIndex) return value;
      return value * fractional;
    }),
  }));
  return { dates, series };
}

function remapCursorIndexByDate(previousDates, nextDates, cursor) {
  if (!previousDates?.length || !nextDates?.length) {
    return Math.max(0, Math.min(Math.max((nextDates?.length || 1) - 1, 0), cursor || 0));
  }

  const previousLastIndex = previousDates.length - 1;
  const clamped = Math.max(0, Math.min(previousLastIndex, Number.isFinite(cursor) ? cursor : previousLastIndex));
  const floorIndex = Math.floor(clamped);
  const ceilIndex = Math.min(previousLastIndex, Math.ceil(clamped));
  const fraction = clamped - floorIndex;
  const nextIndexByDate = new Map(nextDates.map((date, index) => [date, index]));
  const floorNextIndex = nextIndexByDate.get(previousDates[floorIndex]);

  if (floorNextIndex == null) {
    return Math.max(0, Math.min(nextDates.length - 1, clamped));
  }

  if (ceilIndex === floorIndex) return floorNextIndex;

  const ceilNextIndex = nextIndexByDate.get(previousDates[ceilIndex]);
  if (ceilNextIndex == null) {
    return Math.max(0, Math.min(nextDates.length - 1, floorNextIndex + fraction));
  }

  return floorNextIndex + ((ceilNextIndex - floorNextIndex) * fraction);
}

function filterHeatmapByMaxDate(heatmapData, maxDate) {
  if (!heatmapData || !maxDate) return heatmapData || {};
  return Object.fromEntries(
    Object.entries(heatmapData).filter(([date]) => String(date) <= String(maxDate))
  );
}

function mergeDailyPresentationsByDate(previousDaily, nextDaily) {
  if (!nextDaily?.dates?.length) return previousDaily || { dates: [], series: [] };
  if (!previousDaily?.dates?.length) return nextDaily;

  const dates = [...new Set([...previousDaily.dates, ...nextDaily.dates])].sort();
  const previousDateIndex = new Map(previousDaily.dates.map((date, index) => [date, index]));
  const nextDateIndex = new Map(nextDaily.dates.map((date, index) => [date, index]));
  const seriesOrder = [];
  const previousSeriesByKey = new Map();
  const nextSeriesByKey = new Map();

  for (const series of previousDaily.series || []) {
    previousSeriesByKey.set(series.key, series);
  }
  for (const series of nextDaily.series || []) {
    nextSeriesByKey.set(series.key, series);
    seriesOrder.push(series.key);
  }
  for (const series of previousDaily.series || []) {
    if (!nextSeriesByKey.has(series.key)) seriesOrder.push(series.key);
  }

  const series = seriesOrder.map((key) => {
    const nextSeries = nextSeriesByKey.get(key);
    const previousSeries = previousSeriesByKey.get(key);
    return {
      key,
      label: nextSeries?.label || previousSeries?.label || key,
      data: dates.map((date) => {
        const nextIndex = nextDateIndex.get(date);
        if (nextSeries && nextIndex !== undefined) return nextSeries.data?.[nextIndex] || 0;
        const previousIndex = previousDateIndex.get(date);
        if (previousSeries && previousIndex !== undefined) return previousSeries.data?.[previousIndex] || 0;
        return 0;
      }),
    };
  });

  return { dates, series };
}

function useElasticDailyPresentation(sourceDaily, { ingestProgress = 0, isIngestActive = false } = {}) {
  const stableSourceRef = useRef({ dates: [], series: [] });
  const stableDaily = useMemo(
    () => {
      if (!isIngestActive) {
        stableSourceRef.current = sourceDaily || { dates: [], series: [] };
        return stableSourceRef.current;
      }
      stableSourceRef.current = mergeDailyPresentationsByDate(stableSourceRef.current, sourceDaily);
      return stableSourceRef.current;
    },
    [sourceDaily, isIngestActive]
  );
  const rawTargetIndex = useMemo(
    () => resolveDailyRevealTargetIndex(stableDaily?.dates || [], isIngestActive, ingestProgress),
    [stableDaily?.dates, ingestProgress, isIngestActive]
  );
  const [cursor, setCursor] = useState(() => resolveDailyRevealStartIndex(stableDaily?.dates || [], isIngestActive));
  const targetIndex = resolveEffectiveDailyTargetIndex(rawTargetIndex, cursor, stableDaily?.dates?.length || 0, isIngestActive);
  const waitingForDailyData = Boolean(isIngestActive && (stableDaily?.dates?.length || 0) > 0 && cursor >= (stableDaily.dates.length - 1) - 0.01);
  const [speedDaysPerSecond, setSpeedDaysPerSecond] = useState(0);
  const cursorRef = useRef(cursor);
  const speedRef = useRef(0);
  const datesRef = useRef(stableDaily?.dates || []);
  const frameRef = useRef(0);
  const lastFrameRef = useRef(0);
  cursorRef.current = cursor;

  const commitSpeedDaysPerSecond = (nextSpeed) => {
    const roundedSpeed = Math.round(Math.max(0, nextSpeed || 0) * 10) / 10;
    if (Math.abs(speedRef.current - roundedSpeed) < 0.05) return;
    speedRef.current = roundedSpeed;
    setSpeedDaysPerSecond(roundedSpeed);
  };

  useLayoutEffect(() => {
    const nextDates = stableDaily?.dates || [];
    const previousDates = datesRef.current || [];
    if (previousDates === nextDates) return;
    datesRef.current = nextDates;
    if (!isIngestActive) return;

    const remappedCursor = remapCursorIndexByDate(previousDates, nextDates, cursorRef.current);
    if (Math.abs(remappedCursor - cursorRef.current) < 0.001) return;
    cursorRef.current = remappedCursor;
    setCursor(remappedCursor);
  }, [stableDaily?.dates, isIngestActive]);

  useEffect(() => {
    const datesLength = stableDaily?.dates?.length || 0;
    if (!datesLength) {
      commitSpeedDaysPerSecond(0);
      return undefined;
    }

    if (!isIngestActive) {
      cursorRef.current = targetIndex;
      setCursor(targetIndex);
      commitSpeedDaysPerSecond(0);
      return undefined;
    }

    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    lastFrameRef.current = 0;

    const tick = (now) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const dt = Math.max(1, now - lastFrameRef.current);
      lastFrameRef.current = now;

      const current = cursorRef.current;
      const effectiveTargetIndex = resolveEffectiveDailyTargetIndex(rawTargetIndex, current, datesLength, isIngestActive);
      const distance = effectiveTargetIndex - current;
      if (Math.abs(distance) <= 0.01) {
        cursorRef.current = effectiveTargetIndex;
        setCursor(effectiveTargetIndex);
        commitSpeedDaysPerSecond(0);
        frameRef.current = 0;
        return;
      }

      const lagDays = Math.abs(distance);
      const speedDaysPerSecond = Math.min(4.2, Math.max(0.65, 1.15 + Math.max(0, lagDays - 8) * 0.11));
      commitSpeedDaysPerSecond(speedDaysPerSecond);
      const step = Math.sign(distance) * Math.min(Math.abs(distance), (speedDaysPerSecond * dt) / 1000);
      const next = current + step;
      cursorRef.current = next;
      setCursor(next);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [stableDaily?.dates?.length, rawTargetIndex, isIngestActive]);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
  }, []);

  const daily = useMemo(
    () => sliceDailyAtCursor(stableDaily, cursor),
    [stableDaily, cursor]
  );

  return { daily, cursor, rawTargetIndex, sourceDaily: stableDaily, speedDaysPerSecond, targetIndex, waitingForDailyData };
}

function getSparkZoomWindow(range, count, cursor = null, cursorDriven = false) {
  if (!count) return { startValue: 0, endValue: 0 };
  if (cursorDriven && Number.isFinite(cursor)) {
    let targetDays = count;
    if (range === 'd7') targetDays = 7;
    if (range === 'd30') targetDays = 30;

    const minEnd = range === 'd30' ? 29 : 6;
    const maxEnd = Math.max(count - 1, minEnd);
    const endValue = Math.max(minEnd, Math.min(maxEnd, cursor));
    const visibleDays = range === 'total'
      ? Math.max(7, endValue + 1)
      : Math.max(1, Math.min(targetDays, endValue + 1));

    return {
      startValue: range === 'total' ? 0 : Math.max(0, endValue - visibleDays + 1),
      endValue,
    };
  }

  let targetDays = count;
  if (range === 'd7') targetDays = 7;
  if (range === 'd30') targetDays = 30;
  const visibleDays = Math.max(1, Math.min(targetDays, count));
  return {
    startValue: count - visibleDays,
    endValue: count - 1,
  };
}

function startSparkZoomLerp(from, to, setZoom, rafRef, ms) {
  cancelAnimationFrame(rafRef.current);
  rafRef.current = 0;
  if (Math.abs(from.startValue - to.startValue) < 0.01 && Math.abs(from.endValue - to.endValue) < 0.01) {
    return undefined;
  }
  let t0 = 0;
  const tick = (ts) => {
    if (!t0) t0 = ts;
    const u = Math.min(1, (ts - t0) / ms);
    const w = 1 - (1 - u) ** 3;
    setZoom({
      startValue: from.startValue + (to.startValue - from.startValue) * w,
      endValue: from.endValue + (to.endValue - from.endValue) * w,
    });
    rafRef.current = u < 1 ? requestAnimationFrame(tick) : 0;
  };
  rafRef.current = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };
}

function buildOverviewDonutRows(rows, getColor, { hideLabels = false } = {}) {
  return rows.map((row) => {
    const color = getColor(row.key);
    return {
      name: row.label,
      value: row.tokens,
      itemStyle: { color },
      label: { show: !hideLabels, color },
      labelLine: { show: !hideLabels },
    };
  });
}

function scaleMetricRows(rows, scale) {
  return rows.map((row) => ({
    ...row,
    tokens: Math.max(0, (row.tokens || 0) * scale),
  }));
}

function buildOrderedMetricRows(orderRows, valueRows) {
  const valueMap = new Map((valueRows || []).map((row) => [row.key, row]));
  const ordered = [];
  const seen = new Set();
  for (const row of orderRows || []) {
    if (!row?.key || seen.has(row.key)) continue;
    seen.add(row.key);
    const valueRow = valueMap.get(row.key);
    ordered.push({
      key: row.key,
      label: valueRow?.label || row.label,
      tokens: Math.max(0, valueRow?.tokens ?? row.tokens ?? 0),
    });
  }
  for (const row of valueRows || []) {
    if (!row?.key || seen.has(row.key)) continue;
    seen.add(row.key);
    ordered.push({
      key: row.key,
      label: row.label,
      tokens: Math.max(0, row.tokens || 0),
    });
  }
  return ordered;
}

function buildSingleDonutLabelLayout(activeRows) {
  if (activeRows.length !== 1) return null;
  return (params) => {
    const sectorRect = params.rect || { x: 0, y: 0, width: 0, height: 0 };
    const labelRect = params.labelRect || { width: 0, height: 0 };
    const x = sectorRect.x + sectorRect.width + 14;
    const y = sectorRect.y + (sectorRect.height / 2) - (labelRect.height / 2);
    return {
      x,
      y,
      align: 'left',
      verticalAlign: 'middle',
      moveOverlap: 'shiftY',
      hideOverlap: false,
    };
  };
}

function DailySpark({
  daily,
  fullDaily = null,
  elasticDaily = null,
  range = 'total',
  isIngestActive = false,
  currentDateBucket = null,
  exportMode = false,
  exportPlayback = false,
  onDayClick,
}) {
  const sourceDaily = fullDaily || daily;
  if (!sourceDaily?.dates?.length) {
    return (
      <div className="overview-daily-spark overview-daily-spark-empty">
        <span className="overview-daily-spark-title">Daily Usage</span>
        <span className="overview-daily-spark-empty-text">No daily data</span>
      </div>
    );
  }

  const resolvedElasticDaily = elasticDaily || {
    daily: sourceDaily,
    cursor: sourceDaily.dates.length - 1,
    rawTargetIndex: sourceDaily.dates.length - 1,
    sourceDaily,
    targetIndex: sourceDaily.dates.length - 1,
  };
  const displayDaily = resolvedElasticDaily.daily;
  const cursorDrivenZoom = !exportMode && !exportPlayback && isIngestActive;
  const cursorZoomWindow = useMemo(
    () => getSparkZoomWindow(range, displayDaily.dates.length, resolvedElasticDaily.cursor, cursorDrivenZoom),
    [range, displayDaily.dates.length, resolvedElasticDaily.cursor, cursorDrivenZoom]
  );
  const [zoomWindow, setZoomWindow] = useState(() => getSparkZoomWindow(range, displayDaily.dates.length));
  const lastCursorZoomWindowRef = useRef(cursorZoomWindow);
  const wasCursorDrivenZoomRef = useRef(cursorDrivenZoom);
  const zoomWindowRef = useRef(zoomWindow);
  const zoomAnimRafRef = useRef(0);
  const animatedDaily = useDailyStackPresentationTween(displayDaily, cursorDrivenZoom, 'overview-daily-spark');
  const activeZoomWindow = cursorDrivenZoom
    ? cursorZoomWindow
    : (wasCursorDrivenZoomRef.current ? lastCursorZoomWindowRef.current : zoomWindow);
  zoomWindowRef.current = activeZoomWindow;

  useEffect(() => {
    if (cursorDrivenZoom) {
      lastCursorZoomWindowRef.current = cursorZoomWindow;
      wasCursorDrivenZoomRef.current = true;
      return undefined;
    }

    const target = getSparkZoomWindow(range, displayDaily.dates.length);
    if (wasCursorDrivenZoomRef.current) {
      zoomWindowRef.current = lastCursorZoomWindowRef.current;
      setZoomWindow(lastCursorZoomWindowRef.current);
      wasCursorDrivenZoomRef.current = false;
    }
    return startSparkZoomLerp(zoomWindowRef.current, target, setZoomWindow, zoomAnimRafRef, 220);
  }, [cursorDrivenZoom, cursorZoomWindow, range, displayDaily.dates.length]);

  useEffect(() => () => {
    cancelAnimationFrame(zoomAnimRafRef.current);
    zoomAnimRafRef.current = 0;
  }, []);

  const { startValue, endValue } = activeZoomWindow;
  const visibleDateCount = Math.max(1, (endValue - startValue + 1) || displayDaily.dates.length);
  const { barWidth, barMaxWidth } = getOverviewDailyBarSizing(visibleDateCount);
  const useContinuousXAxis = cursorDrivenZoom;
  const xMin = Math.max(-0.5, startValue - 0.5);
  const xMax = Math.max(xMin + 1, endValue + 0.5);
  const dateAtIndex = (index) => displayDaily.dates[Math.max(0, Math.min(displayDaily.dates.length - 1, Math.round(index)))];
  const dailyDebugKeyRef = useRef('');

  useEffect(() => {
    const sourceSummary = summarizeDailyData(sourceDaily, currentDateBucket);
    const displaySummary = summarizeDailyData(displayDaily, currentDateBucket);
    const roundedStart = Math.round(startValue);
    const roundedEnd = Math.round(endValue);
    const debugKey = [
      currentDateBucket,
      resolvedElasticDaily.targetIndex,
      sourceSummary.days,
      sourceSummary.lastNonzero,
      sourceSummary.overreachDays,
      displaySummary.days,
      displaySummary.lastNonzero,
      displaySummary.overreachDays,
      roundedStart,
      roundedEnd,
    ].join('|');
    if (debugKey === dailyDebugKeyRef.current) return;
    dailyDebugKeyRef.current = debugKey;
    debugLive('dailySpark.present', {
      currentDateBucket,
      cursor: Number(resolvedElasticDaily.cursor.toFixed(2)),
      targetIndex: resolvedElasticDaily.targetIndex,
      rawTargetIndex: resolvedElasticDaily.rawTargetIndex,
      lagDays: Number((resolvedElasticDaily.targetIndex - resolvedElasticDaily.cursor).toFixed(2)),
      source: sourceSummary,
      presentationSource: summarizeDailyData(resolvedElasticDaily.sourceDaily, currentDateBucket),
      display: displaySummary,
      zoom: {
        startValue: Number(startValue.toFixed(2)),
        endValue: Number(endValue.toFixed(2)),
        visibleDateCount: Number(visibleDateCount.toFixed(2)),
      },
    });
  }, [currentDateBucket, resolvedElasticDaily.cursor, resolvedElasticDaily.targetIndex, sourceDaily, displayDaily, startValue, endValue, visibleDateCount]);

  const option = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DAILY,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      confine: true,
      formatter: (params) => {
        if (!params?.length) return '';
        const axisIndex = Array.isArray(params[0].data) ? params[0].data[0] : params[0].dataIndex;
        let html = `<b>${dateAtIndex(axisIndex)}</b><br/>`;
        let total = 0;
        const sorted = [...params]
          .filter((p) => (Array.isArray(p.value) ? p.value[1] : p.value) > 0)
          .sort((a, b) => ((Array.isArray(b.value) ? b.value[1] : b.value) || 0) - ((Array.isArray(a.value) ? a.value[1] : a.value) || 0));
        for (const p of sorted) {
          const value = Array.isArray(p.value) ? p.value[1] : p.value;
          html += `${p.marker} ${p.seriesName}: ${fmt(value)}<br/>`;
          total += value;
        }
        html += `<b>Total: ${fmt(total)}</b>`;
        return html;
      },
    },
    grid: { left: 4, right: 4, top: 4, bottom: 4 },
    xAxis: useContinuousXAxis
      ? { type: 'value', min: xMin, max: xMax, show: false }
      : {
        type: 'category',
        data: animatedDaily.dates || displayDaily.dates,
        min: Math.max(0, Math.floor(startValue)),
        max: Math.max(0, Math.floor(endValue)),
        show: false,
      },
    yAxis: { type: 'value', show: false, scale: false, min: 0 },
    series: animatedDaily.series.map((series) => ({
      id: `overview-daily-${series.key}`,
      name: series.label,
      type: 'bar',
      stack: 'total',
      data: useContinuousXAxis
        ? series.data.map((value, index) => [index, value])
        : series.data,
      itemStyle: { color: getModelColor(series.key) },
      ...(barWidth ? { barWidth } : {}),
      barMaxWidth,
    })),
  };

  const sparkEvents = onDayClick && !exportMode && !exportPlayback
    ? {
        click: (params) => {
          const axisIndex = Array.isArray(params?.data) ? params.data[0] : params?.dataIndex;
          const date = Number.isFinite(axisIndex) ? dateAtIndex(axisIndex) : (params?.axisValue || params?.name);
          if (date) onDayClick(date);
        },
      }
    : undefined;

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div
        className="overview-daily-spark-chart"
        style={sparkEvents ? { cursor: 'pointer' } : undefined}
      >
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ width: '100%', height: '100%' }}
          theme="dark"
          lazyUpdate={false}
          notMerge={exportMode}
          replaceMerge={['series']}
          onEvents={sparkEvents}
        />
      </div>
    </div>
  );
}

const HEATMAP_METRICS = [
  { key: 'tokens', label: 'Tokens', fmt: fmt },
  { key: 'elapsed', label: 'Time', fmt: v => fmtHours(v) },
  { key: 'cost', label: 'Cost', fmt: fmtCost },
];

const HEATMAP_POP_DURATION_MS = OVERVIEW_INGEST_ANIMATION.heatmap?.popDurationMs ?? 380;
const HEATMAP_SETTLE_THRESHOLD = OVERVIEW_INGEST_ANIMATION.heatmap?.settleThreshold ?? 0.998;

function Heatmap({
  heatmapData,
  isIngestActive = false,
  ingestProgress = 0,
  currentDateBucket = null,
  onDayClick,
  interactive = true,
}) {
  const [metric, setMetric] = useState('tokens');
  const [changedKeysUp, setChangedKeysUp] = useState(new Set());
  const [changedKeysDown, setChangedKeysDown] = useState(new Set());
  const prevValuesRef = useRef({});
  const prevMaxValRef = useRef(1);
  const heatmapDebugKeyRef = useRef('');

  const data = heatmapData || {};

  useEffect(() => {
    const summary = summarizeHeatmapData(data, currentDateBucket);
    const debugKey = [
      summary.currentDateBucket,
      summary.nonzeroDays,
      summary.lastNonzero,
      summary.overreachDays,
      summary.totalTokens,
    ].join('|');
    if (debugKey === heatmapDebugKeyRef.current) return;
    heatmapDebugKeyRef.current = debugKey;
    debugLive('heatmap.present', summary);
  }, [data, currentDateBucket]);

  const today = new Date();
  const cells = [];
  const monthLabels = [];

  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    const val = data[key] ? data[key][metric] || 0 : 0;
    cells.push({ key, val, date: d });
    if (d.getDate() === 1) monthLabels.push({ idx: 364 - i, label: d.toLocaleDateString('en-US', { month: 'short' }) });
  }

  const maxVal = Math.max(...cells.map(c => c.val), 1);

  useEffect(() => {
    if (!isIngestActive || ingestProgress >= HEATMAP_SETTLE_THRESHOLD) {
      prevValuesRef.current = {};
      prevMaxValRef.current = 1;
      return;
    }
    const today = new Date();
    const prev = prevValuesRef.current;
    const prevMaxVal = prevMaxValRef.current;
    const up = new Set();
    const down = new Set();
    const tol = Math.max(0.05, Math.min(prevMaxVal, maxVal) * 0.002);
    const intensityDropThreshold = 0.02;
    const intensityRiseThreshold = OVERVIEW_INGEST_ANIMATION.heatmap?.intensityRiseThreshold ?? 0.08;
    const whiteThreshold = OVERVIEW_INGEST_ANIMATION.heatmap?.whiteThreshold ?? 0.88;
    const nearMaxRatio = OVERVIEW_INGEST_ANIMATION.heatmap?.nearMaxRatio ?? 0.985;
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-CA');
      const val = data[key] ? data[key][metric] || 0 : 0;
      const p = prev[key];
      const pVal = p ?? 0;
      const prevT = prevMaxVal > 0 ? pVal / prevMaxVal : 0;
      const currT = maxVal > 0 ? val / maxVal : 0;
      const isNewWinner =
        maxVal > prevMaxVal + tol &&
        val >= maxVal * nearMaxRatio &&
        (pVal < maxVal * nearMaxRatio || pVal === undefined);
      const crossedIntoWhite = currT >= whiteThreshold && prevT < whiteThreshold;
      const valueIncreased = val > pVal + tol;
      const intensityRose = currT > prevT + intensityRiseThreshold;
      if (isNewWinner || crossedIntoWhite || valueIncreased || intensityRose) {
        up.add(key);
      } else if (val < pVal - tol) {
        down.add(key);
      } else if (val > 0 && prevMaxVal > 0 && maxVal > prevMaxVal + tol) {
        if (prevT >= 0.85 && currT < prevT - intensityDropThreshold) down.add(key);
      }
      prev[key] = val;
    }
    prevMaxValRef.current = maxVal;
    if (up.size > 0 || down.size > 0) {
      setChangedKeysUp(up);
      setChangedKeysDown(down);
      const t = setTimeout(() => {
        setChangedKeysUp(new Set());
        setChangedKeysDown(new Set());
      }, HEATMAP_POP_DURATION_MS);
      return () => clearTimeout(t);
    }
  }, [data, metric, isIngestActive, ingestProgress, maxVal]);

  function intensity(v) {
    if (v === 0) return 'var(--bg-elevated)';
    const t = v / maxVal;
    const q = 1 / 4;
    if (t < q) return 'rgba(99, 102, 241, 0.14)';
    if (t < 2 * q) return 'rgba(99, 102, 241, 0.38)';
    if (t < 3 * q) return 'rgba(99, 102, 241, 0.62)';
    if (t < 1) return 'rgba(99, 102, 241, 0.88)';
    return '#fff';
  }

  const firstDay = cells[0]?.date.getDay() || 0;
  const padded = Array(firstDay).fill(null).concat(cells);

  return (
    <div className="heatmap-wrap">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span className="chart-title">Activity</span>
        <div className="btn-group">
          {HEATMAP_METRICS.map(m => (
            <button key={m.key} className={`btn ${metric === m.key ? 'active' : ''}`} onClick={() => setMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="heatmap-grid" style={{ gridTemplateRows: 'repeat(7, 1fr)' }}>
        {padded.map((c, i) => (
          c ? (
            <div
              key={c.key}
              role={onDayClick && interactive ? 'button' : undefined}
              tabIndex={onDayClick && interactive ? 0 : undefined}
              onClick={onDayClick && interactive ? () => onDayClick(c.key) : undefined}
              onKeyDown={onDayClick && interactive ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDayClick(c.key);
                }
              } : undefined}
              className={`heatmap-cell ${c.val > 0 ? 'active' : ''} ${changedKeysUp.has(c.key) ? 'heatmap-cell-pop' : ''} ${changedKeysDown.has(c.key) ? 'heatmap-cell-pop-dim' : ''}`}
              style={{
                background: intensity(c.val),
                cursor: onDayClick && interactive ? 'pointer' : undefined,
              }}
              title={`${c.key}: ${HEATMAP_METRICS.find(m => m.key === metric).fmt(c.val)}`}
            />
          ) : <div key={`pad-${i}`} className="heatmap-cell" style={{ visibility: 'hidden' }} />
        ))}
      </div>
      <div className="heatmap-labels">
        {monthLabels.slice(-12).map((m, i) => <span key={i}>{m.label}</span>)}
      </div>
    </div>
  );
}

export function OverviewFrame({
  presentation,
  rawPresentation = null,
  fullDaily = null,
  sourceDailyRows = null,
  range = 'total',
  ingestProgress = 0,
  isIngestActive = false,
  currentDateBucket = null,
  exportMode = false,
  exportPlayback = false,
  exportPhase = null,
  exportSeekMs = 0,
  exportDaily = null,
  exportDailyTiming = null,
  onDailyDebugStatsChange = null,
  onPresentationDateRangeChange = null,
  onNavigateToDailyDay,
  onNavigateToRepo,
  onNavigateToModel,
}) {
  if (!presentation?.ready) return null;
  const exportChartIntroProgress = exportPlayback
    ? resolveExportChartIntroProgress(exportSeekMs)
    : 1;
  const chartPresentation = exportPlayback && exportPhase === 'replay' && rawPresentation?.ready
    ? rawPresentation
    : presentation;
  const sparkDailyInput = exportPlayback ? (rawPresentation?.daily || presentation.daily) : presentation.daily;
  const sparkSourceDaily = exportPlayback
    ? (sparkDailyInput?.dates?.length ? sparkDailyInput : fullDaily)
    : fullDaily;
  const dailySparkActive = !exportMode && !exportPlayback && isIngestActive;
  const elasticDaily = useElasticDailyPresentation(sparkSourceDaily, {
    ingestProgress,
    isIngestActive: dailySparkActive,
  });
  useEffect(() => {
    onDailyDebugStatsChange?.(
      dailySparkActive
        ? {
          speedDaysPerSecond: elasticDaily.speedDaysPerSecond,
          waitingForDailyData: elasticDaily.waitingForDailyData,
        }
        : null
    );
  }, [dailySparkActive, elasticDaily.speedDaysPerSecond, elasticDaily.waitingForDailyData, onDailyDebugStatsChange]);
  useEffect(() => () => onDailyDebugStatsChange?.(null), [onDailyDebugStatsChange]);
  const elasticDates = elasticDaily.daily?.dates || [];
  const presentationDateBucket = elasticDates[elasticDates.length - 1] || currentDateBucket;
  const presentationRangeDates = getZoomSlice(range, elasticDates);
  const presentationDateRange = {
    from: presentationRangeDates[0] || presentationDateBucket,
    to: presentationRangeDates[presentationRangeDates.length - 1] || presentationDateBucket,
  };
  useEffect(() => {
    onPresentationDateRangeChange?.(dailySparkActive ? presentationDateRange : null);
  }, [dailySparkActive, onPresentationDateRangeChange, presentationDateRange.from, presentationDateRange.to]);
  useEffect(() => () => onPresentationDateRangeChange?.(null), [onPresentationDateRangeChange]);
  const baseHeatmapPresentation = (isIngestActive && rawPresentation?.heatmap)
    ? rawPresentation.heatmap
    : presentation.heatmap;
  const heatmapDateBucket = isIngestActive && !exportPlayback
    ? presentationDateBucket
    : currentDateBucket;
  const heatmapPresentation = isIngestActive && heatmapDateBucket && !exportPlayback
    ? filterHeatmapByMaxDate(baseHeatmapPresentation, heatmapDateBucket)
    : (baseHeatmapPresentation || {});
  const summaryPresentation = useMemo(
    () => (
      dailySparkActive
        ? buildDailyCursorPresentationTarget({
          daily: sourceDailyRows,
          range,
          cursor: elasticDaily.cursor,
          fallback: chartPresentation,
        })
        : chartPresentation
    ),
    [chartPresentation, dailySparkActive, elasticDaily.cursor, range, sourceDailyRows]
  );
  const { stats, topRepos, topFamilies, topModels } = summaryPresentation;
  const chartTopRepos = exportPlayback && exportPhase === 'replay'
    ? scaleMetricRows(
      buildOrderedMetricRows(rawPresentation?.topRepos || chartPresentation.topRepos || [], presentation.topRepos || chartPresentation.topRepos || []),
      exportChartIntroProgress
    )
    : (summaryPresentation.topRepos || []);
  const chartTopFamilies = exportPlayback && exportPhase === 'replay'
    ? scaleMetricRows(
      buildOrderedMetricRows(rawPresentation?.topFamilies || chartPresentation.topFamilies || [], presentation.topFamilies || chartPresentation.topFamilies || []),
      exportChartIntroProgress
    )
    : (summaryPresentation.topFamilies || []);
  const chartTopModels = exportPlayback && exportPhase === 'replay'
    ? scaleMetricRows(
      buildOrderedMetricRows(rawPresentation?.topModels || chartPresentation.topModels || [], presentation.topModels || chartPresentation.topModels || []),
      exportChartIntroProgress
    )
    : (summaryPresentation.topModels || []);
  const reversedRepos = [...chartTopRepos.slice(0, 6)].reverse();
  const maxRepoTokens = Math.max(...chartTopRepos.slice(0, 6).map(row => row.tokens || 0), 1);
  const orderedFamilies = [...chartTopFamilies].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const orderedModels = [...chartTopModels.slice(0, 6)].sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const chartInteractive = !exportMode && !exportPlayback && !isIngestActive;
  const donutRadius = resolveDonutRadius(exportSeekMs, exportPlayback);
  const donutSeriesAnimation = !exportMode && !exportPlayback && ECHARTS_OVERVIEW_DONUT_SERIES_ANIMATION;
  const exportBarsUpdateDuration = exportPlayback
    ? resolveExportChartUpdateDuration(
      exportSeekMs,
      OVERVIEW_INGEST_ANIMATION.videoExport?.barsChartIntroUpdateDurationMs,
      OVERVIEW_INGEST_ANIMATION.videoExport?.barsChartUpdateDurationMs,
      exportPhase === 'tail' || exportPhase === 'final_hold'
        ? OVERVIEW_INGEST_ANIMATION.videoExport?.barsChartTailUpdateDurationMs
        : null
    )
    : 0;
  const repoOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_BARS,
    ...(exportMode ? { animation: false } : {}),
    ...(exportPlayback ? {
      animation: true,
      animationDuration: 0,
      animationDurationUpdate: exportBarsUpdateDuration,
      animationEasingUpdate: 'cubicOut',
    } : {}),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      confine: true,
      formatter: params => params?.length ? `${params[0].axisValue}: ${fmt(params[0].value)} tokens` : '',
    },
    grid: { left: 100, right: 5, top: 5, bottom: 5 },
    xAxis: { type: 'value', show: false, max: maxRepoTokens || 1 },
    yAxis: {
      type: 'category',
      data: reversedRepos.map(row => row.label),
      axisLabel: {
        color: '#8b949e',
        fontSize: 11,
        formatter: (value) => wrapRepoLabel(value),
      },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [{
      id: 'overview-top-repos',
      type: 'bar',
      data: reversedRepos.map((row) => {
        const val = row.tokens || 0;
        const pct = val / maxRepoTokens;
        const inside = pct >= 0.7;
        const barColor = getRepoColor(row.label);
        return {
          value: val,
          itemStyle: { color: barColor, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: inside ? 'insideRight' : 'right',
            distance: 5,
            offset: [0, 1.5],
            formatter: () => fmt(val),
            color: inside ? getContrastLabelColor(barColor) : '#8b949e',
            fontSize: 10,
          },
        };
      }),
      barWidth: '80%',
    }],
  };

  const repoChartEvents = chartInteractive && onNavigateToRepo
    ? {
        click: (params) => {
          if (params?.componentType !== 'series' || params?.dataIndex == null) return;
          const row = reversedRepos[params.dataIndex];
          if (row?.label) onNavigateToRepo(row.label);
        },
      }
    : undefined;

  const familyTotal = orderedFamilies.reduce((sum, row) => sum + (row.tokens || 0), 0);
  const visibleFamilyRows = orderedFamilies.filter((row) => (familyTotal > 0 ? ((row.tokens || 0) / familyTotal) >= 0.01 : false));
  const hideSingleFamilyLabel = exportPlayback && visibleFamilyRows.length === 1;
  const familySingleLabelLayout = buildSingleDonutLabelLayout(visibleFamilyRows);
  const familyOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DONUTS,
    ...(exportMode || exportPlayback ? { animation: false } : {}),
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: true,
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      id: 'overview-work-type',
      type: 'pie',
      animation: donutSeriesAnimation,
      avoidLabelOverlap: !familySingleLabelLayout,
      radius: donutRadius,
      center: ['50%', '50%'],
      label: {
        show: !hideSingleFamilyLabel,
        color: '#8b949e',
        fontSize: 11,
        formatter: '{b}',
        alignTo: 'edge',
        edgeDistance: 5,
        bleedMargin: 5,
        distanceToLabelLine: 5,
      },
      labelLine: { show: !hideSingleFamilyLabel, lineStyle: { color: '#30363d' }, length: 8, length2: 6 },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      ...(!hideSingleFamilyLabel && familySingleLabelLayout ? { labelLayout: familySingleLabelLayout } : {}),
      data: buildOverviewDonutRows(visibleFamilyRows, getFamilyColor, { hideLabels: hideSingleFamilyLabel }),
    }],
  };

  const modelTotal = orderedModels.reduce((sum, row) => sum + (row.tokens || 0), 0);
  const visibleModelRows = orderedModels.filter((row) => (modelTotal > 0 ? ((row.tokens || 0) / modelTotal) >= 0.01 : false));
  const hideSingleModelLabel = exportPlayback && visibleModelRows.length === 1;
  const modelSingleLabelLayout = buildSingleDonutLabelLayout(visibleModelRows);
  const modelOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DONUTS,
    ...(exportMode || exportPlayback ? { animation: false } : {}),
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: true,
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      id: 'overview-models',
      type: 'pie',
      animation: donutSeriesAnimation,
      avoidLabelOverlap: !modelSingleLabelLayout,
      radius: donutRadius,
      center: ['50%', '50%'],
      label: {
        show: !hideSingleModelLabel,
        color: '#8b949e',
        fontSize: 11,
        formatter: '{b}',
        alignTo: 'edge',
        edgeDistance: 5,
        bleedMargin: 5,
        distanceToLabelLine: 5,
      },
      labelLine: { show: !hideSingleModelLabel, lineStyle: { color: '#30363d' }, length: 8, length2: 6 },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      ...(!hideSingleModelLabel && modelSingleLabelLayout ? { labelLayout: modelSingleLabelLayout } : {}),
      data: buildOverviewDonutRows(visibleModelRows, getModelColor, { hideLabels: hideSingleModelLabel }),
    }],
  };

  const modelChartEvents = chartInteractive && onNavigateToModel
    ? {
        click: (params) => {
          if (params?.componentType !== 'series' || params?.dataIndex == null) return;
          const row = visibleModelRows[params.dataIndex];
          const name = row?.label || params?.name;
          if (name) onNavigateToModel(name);
        },
      }
    : undefined;

  return (
    <div className="animate-in">
      <div className="stat-row">
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-label">Tokens</div>
            <div className="stat-value">{fmt(stats.tokens)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmt(stats.tokens / stats.days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Agent Time</div>
            <div className="stat-value">{fmtHours(stats.elapsed)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmtHours(stats.elapsed / stats.days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Est. API Cost</div>
            <div className="stat-value">{fmtCost(stats.cost)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmtCost(stats.cost / stats.days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sessions</div>
            <div className="stat-value">{Math.round(stats.sessions).toLocaleString()}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{(stats.sessions / stats.days).toFixed(1)}</span> per day</div>
          </div>
        </div>
        {exportPlayback ? (
          <ExportDailySpark
            daily={exportDaily || fullDaily || sparkDailyInput}
            seekMs={exportSeekMs}
            timing={exportDailyTiming}
          />
        ) : (
          <DailySpark
            daily={sparkDailyInput}
            fullDaily={fullDaily}
            elasticDaily={elasticDaily}
            range={range}
            isIngestActive={isIngestActive}
            currentDateBucket={currentDateBucket}
            exportMode={exportMode}
            exportPlayback={exportPlayback}
            onDayClick={chartInteractive ? onNavigateToDailyDay : undefined}
          />
        )}
      </div>

      <Heatmap
        heatmapData={heatmapPresentation}
        isIngestActive={isIngestActive}
        ingestProgress={ingestProgress}
        currentDateBucket={heatmapDateBucket}
        onDayClick={chartInteractive ? onNavigateToDailyDay : undefined}
        interactive={chartInteractive}
      />

      <div className="grid-3">
        <div className="chart-card overview-donut-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Top Repos</div>
          {topRepos.length > 0 ? (
            <ReactEChartsCore
              echarts={echarts}
              option={repoOption}
              style={{ height: 180, cursor: repoChartEvents ? 'pointer' : undefined }}
              theme="dark"
              lazyUpdate={false}
              notMerge={exportMode}
              onEvents={repoChartEvents}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card overview-donut-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work Type</div>
          {topFamilies.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={familyOption} style={{ height: 180 }} theme="dark" lazyUpdate={false} notMerge={exportMode} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models</div>
          {topModels.length > 0 ? (
            <ReactEChartsCore
              echarts={echarts}
              option={modelOption}
              style={{ height: 180, cursor: modelChartEvents ? 'pointer' : undefined }}
              theme="dark"
              lazyUpdate={false}
              notMerge={exportMode}
              onEvents={modelChartEvents}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
      </div>

      <div className="coverage-subtle">
        <span style={{ fontWeight: 500 }}>Session coverage:</span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#22c55e' }} />
          <span className="coverage-nums">{Math.round(stats.exactPriced)}</span>
          {' '}exact-priced
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#c084fc' }} />
          <span className="coverage-nums">{Math.round(stats.fallbackPriced)}</span>
          {' '}fallback-priced
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#64748b' }} />
          <span className="coverage-nums">{Math.round(stats.unpriced)}</span>
          {' '}unpriced
        </span>
      </div>
    </div>
  );
}

function Overview({
  data,
  heatmap,
  daily,
  families,
  repos,
  models,
  range = 'total',
  onPresentationSettledChange = null,
  ingestProgress = 0,
  isIngestActive = false,
  currentDateBucket = null,
  clockNowMs = null,
  onDailyDebugStatsChange = null,
  onPresentationDateRangeChange = null,
  onNavigateToDailyDay,
  onNavigateToRepo,
  onNavigateToModel,
}) {
  const presentation = useAnimatedOverviewPresentation(
    { overview: data, heatmap, daily, families, repos, models, range },
    {
      duration: OVERVIEW_PRESENTATION_DURATION_MS,
      onSettledChange: onPresentationSettledChange,
      ingestProgress,
      isIngestActive,
      clockNowMs,
    }
  );
  const rawPresentation = React.useMemo(
    () => buildOverviewPresentationTarget({ overview: data, heatmap, daily, families, repos, models, range }),
    [data, heatmap, daily, families, repos, models, range]
  );
  const fullDaily = React.useMemo(
    () => buildFullDailySparkPresentation(daily),
    [daily]
  );

  return (
    <OverviewFrame
      presentation={presentation}
      rawPresentation={rawPresentation}
      fullDaily={fullDaily}
      sourceDailyRows={daily}
      range={range}
      ingestProgress={ingestProgress}
      isIngestActive={isIngestActive}
      currentDateBucket={currentDateBucket}
      onDailyDebugStatsChange={onDailyDebugStatsChange}
      onPresentationDateRangeChange={onPresentationDateRangeChange}
      onNavigateToDailyDay={onNavigateToDailyDay}
      onNavigateToRepo={onNavigateToRepo}
      onNavigateToModel={onNavigateToModel}
    />
  );
}

function areOverviewPropsEqual(prev, next) {
  return prev.data === next.data
    && prev.heatmap === next.heatmap
    && prev.daily === next.daily
    && prev.families === next.families
    && prev.repos === next.repos
    && prev.models === next.models
    && prev.range === next.range
    && prev.onPresentationSettledChange === next.onPresentationSettledChange
    && prev.ingestProgress === next.ingestProgress
    && prev.isIngestActive === next.isIngestActive
    && prev.currentDateBucket === next.currentDateBucket
    && prev.clockNowMs === next.clockNowMs
    && prev.onDailyDebugStatsChange === next.onDailyDebugStatsChange
    && prev.onPresentationDateRangeChange === next.onPresentationDateRangeChange
    && prev.onNavigateToDailyDay === next.onNavigateToDailyDay
    && prev.onNavigateToRepo === next.onNavigateToRepo
    && prev.onNavigateToModel === next.onNavigateToModel;
}

export default memo(Overview, areOverviewPropsEqual);

function resolveExportChartIntroProgress(seekMs) {
  return resolveExportChartIntroBlend(seekMs);
}

function resolveExportChartUpdateDuration(seekMs, introDurationMs, steadyDurationMs, tailDurationMs = null) {
  if (tailDurationMs != null) return Math.max(0, Math.round(tailDurationMs));

  const steady = Math.max(0, Math.round(steadyDurationMs ?? 0));
  const intro = Math.max(steady, Math.round(introDurationMs ?? steady));
  const blend = resolveExportChartIntroBlend(seekMs);
  return Math.round(intro + ((steady - intro) * blend));
}

function resolveDonutRadius(seekMs, exportPlayback = false) {
  if (!exportPlayback) return ['48%', '72%'];
  const scale = 0.9 + (resolveExportChartIntroBlend(seekMs) * 0.1);
  return [`${roundPercent(48 * scale)}%`, `${roundPercent(72 * scale)}%`];
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function resolveExportChartIntroBlend(seekMs) {
  const introWindowMs = Math.max(OVERVIEW_INGEST_ANIMATION.videoExport?.chartIntroWindowMs ?? 2200, 1);
  const elapsed = Math.max(seekMs || 0, 0);
  const tau = introWindowMs / 3;
  return Math.min(1, 1 - Math.exp(-elapsed / Math.max(tau, 1)));
}
