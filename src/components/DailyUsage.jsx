import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import ReactEChartsCore from '../utils/echartsReact';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent, GraphicComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor, getFamilyColor, getRepoColor, getContrastLabelColor } from '../utils/colors';
import { formatCompactNumber } from '../utils/formatters';
import { ECHARTS_ANIMATION, ECHARTS_OVERVIEW_DAILY } from '../utils/animationsDefault';
import { useDailyStackPresentationTween } from '../hooks/useDailyStackPresentationTween';
import { buildBreakdownRows, buildDistributionOption } from './subcharts';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent, GraphicComponent, CanvasRenderer]);

function fmt(n) {
  return formatCompactNumber(n);
}
function fmtCost(n) { return n == null || n === 0 ? '$0' : '$' + n.toFixed(2); }
function fmtHours(sec) { return !sec ? '0h' : (sec / 3600).toFixed(1) + 'h'; }

const METRICS = [
  { key: 'tokens', label: 'Tokens', fn: fmt },
  { key: 'elapsed_seconds', label: 'Time', fn: fmtHours },
  { key: 'cost', label: 'Cost', fn: fmtCost },
];

const SPLIT_MODES = [
  { key: 'model', label: 'By Model' },
  { key: 'family', label: 'By Work' },
];

const DISPLAY_MODES = [
  { key: 'absolute', label: 'Absolute' },
  { key: 'relative', label: 'Relative' },
];

function exportChart(ref) {
  if (!ref.current) return;
  const url = ref.current.getEchartsInstance().getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#06080f' });
  Object.assign(document.createElement('a'), { href: url, download: 'codexmeter-daily.png' }).click();
}

function getZoomWindow(range, count) {
  if (!count) return { startValue: 0, endValue: 0 };
  let targetDays = count;
  if (range === 'd7') targetDays = 7;
  if (range === 'd30') targetDays = 30;
  const visibleDays = Math.max(1, Math.min(targetDays, count));
  return {
    startValue: count - visibleDays,
    endValue: count - 1,
  };
}

const DAILY_ZOOM_ANIM_MS = 280;

function parseDataZoomToWindow(params, dates, fallback) {
  const dz = params?.batch?.[0] ?? params;
  const hi = Math.max(0, dates.length - 1);
  let s;
  let e;
  if (dz && typeof dz.startValue === 'number' && typeof dz.endValue === 'number') {
    s = dz.startValue;
    e = dz.endValue;
  } else if (dz && typeof dz.start === 'number' && typeof dz.end === 'number' && dates.length) {
    s = Math.round((dz.start / 100) * hi);
    e = Math.round((dz.end / 100) * hi);
  } else if (dz && typeof dz.startValue === 'string' && typeof dz.endValue === 'string' && dates.length) {
    s = dates.indexOf(dz.startValue);
    e = dates.indexOf(dz.endValue);
    if (s < 0) s = fallback.startValue;
    if (e < 0) e = fallback.endValue;
  } else {
    s = fallback.startValue;
    e = fallback.endValue;
  }
  s = Math.max(0, Math.min(hi, Math.floor(s)));
  e = Math.max(0, Math.min(hi, Math.floor(e)));
  return s > e ? { startValue: e, endValue: s } : { startValue: s, endValue: e };
}

function startDataZoomLerp(from, to, setZoom, rafRef, ms) {
  cancelAnimationFrame(rafRef.current);
  rafRef.current = 0;
  if (Math.round(from.startValue) === Math.round(to.startValue) && Math.round(from.endValue) === Math.round(to.endValue)) {
    return undefined;
  }
  let t0 = 0;
  const tick = (ts) => {
    if (!t0) t0 = ts;
    const u = Math.min(1, (ts - t0) / ms);
    const w = 1 - (1 - u) ** 3;
    setZoom({
      startValue: Math.round(from.startValue + (to.startValue - from.startValue) * w),
      endValue: Math.round(from.endValue + (to.endValue - from.endValue) * w),
    });
    rafRef.current = u < 1 ? requestAnimationFrame(tick) : 0;
  };
  rafRef.current = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };
}

function getVisibleBarWidth(range, count) {
  if (range === 'd7') return 44;
  if (range === 'd30') return 22;
  if (count <= 14) return 36;
  if (count <= 31) return 18;
  return 14;
}

function getVisibleBarPercent(range, count) {
  if (range === 'd7') return '72%';
  if (range === 'd30') return '54%';
  if (count <= 14) return '64%';
  if (count <= 31) return '48%';
  return '36%';
}

function getDayMetricValue(day, metricKey) {
  if (!day) return 0;
  if (metricKey === 'elapsed_seconds') return day.elapsed_seconds || 0;
  if (metricKey === 'cost') return day.cost || 0;
  return day.tokens || 0;
}

function formatDayDetailTitle(day, metricKey) {
  if (!day) return 'Day detail';
  const metric = METRICS.find((entry) => entry.key === metricKey) || METRICS[0];
  const weekday = new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  const metricValue = metric.fn(getDayMetricValue(day, metricKey));
  return `Day detail: ${weekday} - ${day.date} - ${metric.label}: ${metricValue}`;
}

/** Find the largest rectangle that fits in the band (histogram), return center [x, y] */
function largestRectInBand(heights, prevStack) {
  const n = heights.length;
  if (n === 0) return null;
  const left = new Array(n);
  const right = new Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) {
    while (stack.length && heights[stack[stack.length - 1]] >= heights[i]) stack.pop();
    left[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
  }
  stack.length = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (stack.length && heights[stack[stack.length - 1]] >= heights[i]) stack.pop();
    right[i] = stack.length ? stack[stack.length - 1] : n;
    stack.push(i);
  }
  let maxArea = 0;
  let bestIdx = 0;
  for (let i = 0; i < n; i++) {
    const width = right[i] - left[i] - 1;
    const area = width * heights[i];
    if (area > maxArea) {
      maxArea = area;
      bestIdx = i;
    }
  }
  const centerX = (left[bestIdx] + right[bestIdx]) / 2;
  const centerY = prevStack[bestIdx] + heights[bestIdx] / 2;
  return [centerX, centerY];
}

function DayDetail({ day, chartMode }) {
  const modelRows = useMemo(() => buildBreakdownRows(day.by_model), [day.by_model]);
  const repoRows = useMemo(() => buildBreakdownRows(day.by_repo), [day.by_repo]);
  const workRows = useMemo(() => buildBreakdownRows(day.by_family), [day.by_family]);

  const modelOption = buildDistributionOption({
    title: 'Models',
    rows: modelRows,
    valueKey: 'tokens',
    colorForKey: getModelColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const repoOption = buildDistributionOption({
    title: 'Repos',
    rows: repoRows,
    valueKey: 'tokens',
    colorForKey: getRepoColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const workOption = buildDistributionOption({
    title: 'Work Type',
    rows: workRows,
    valueKey: 'tokens',
    colorForKey: getFamilyColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  return (
    <div className="model-detail-wrap">
      <div className="model-detail-charts">
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Repos</div>
          <ReactEChartsCore echarts={echarts} option={repoOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
        </div>
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models</div>
          <ReactEChartsCore echarts={echarts} option={modelOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
        </div>
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work Type</div>
          <ReactEChartsCore echarts={echarts} option={workOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
        </div>
      </div>
    </div>
  );
}

const DailyMainChart = React.memo(function DailyMainChart({
  daily,
  range,
  metric,
  split,
  displayMode,
  onSelectDate,
  navigateToDayRequest,
  onNavigateToDayConsumed,
}) {
  const [zoomWindow, setZoomWindow] = useState({ startValue: 0, endValue: 0 });
  const chartRef = useRef(null);
  const zoomWindowRef = useRef(zoomWindow);
  zoomWindowRef.current = zoomWindow;
  const zoomAnimRafRef = useRef(0);
  const lastRangeForZoomRef = useRef(null);
  const lastCountForZoomRef = useRef(0);
  const dates = useMemo(() => daily.map((d) => d.date), [daily]);
  const curMetric = METRICS.find((m) => m.key === metric);
  const targetZoomWindow = useMemo(() => getZoomWindow(range, dates.length), [range, dates.length]);

  useEffect(() => {
    if (!dates.length) return undefined;
    const target = getZoomWindow(range, dates.length);
    const cold = lastRangeForZoomRef.current === null;
    const rangeMoved = !cold && lastRangeForZoomRef.current !== range;
    const countMoved = !cold && lastCountForZoomRef.current !== dates.length;
    lastRangeForZoomRef.current = range;
    lastCountForZoomRef.current = dates.length;
    cancelAnimationFrame(zoomAnimRafRef.current);
    zoomAnimRafRef.current = 0;
    if (cold) {
      setZoomWindow(target);
      return undefined;
    }
    if (rangeMoved) {
      return startDataZoomLerp(zoomWindowRef.current, target, setZoomWindow, zoomAnimRafRef, DAILY_ZOOM_ANIM_MS);
    }
    if (countMoved) setZoomWindow(target);
    return undefined;
  }, [range, dates.length]);

  const appliedNavigateIdRef = useRef(null);
  useEffect(() => {
    if (!navigateToDayRequest) {
      appliedNavigateIdRef.current = null;
      return;
    }
    const { id, centerDate } = navigateToDayRequest;
    if (!centerDate || !daily.length) return;
    if (appliedNavigateIdRef.current === id) return;
    const dateList = daily.map((d) => d.date);
    const idx = dateList.indexOf(centerDate);
    if (idx < 0) {
      onNavigateToDayConsumed?.();
      return;
    }
    appliedNavigateIdRef.current = id;
    const startIdx = Math.max(0, idx - 3);
    const endIdx = Math.min(dateList.length - 1, idx + 3);
    cancelAnimationFrame(zoomAnimRafRef.current);
    zoomAnimRafRef.current = 0;
    setZoomWindow({ startValue: startIdx, endValue: endIdx });
    onSelectDate(centerDate);
    onNavigateToDayConsumed?.();
  }, [navigateToDayRequest, daily, onSelectDate, onNavigateToDayConsumed]);

  const visibleDateCount = useMemo(() => {
    if (!dates.length) return 0;
    const startIdx = Math.max(0, Math.min(dates.length - 1, Math.floor(zoomWindow.startValue ?? targetZoomWindow.startValue ?? 0)));
    const endIdx = Math.max(startIdx, Math.min(dates.length - 1, Math.floor(zoomWindow.endValue ?? targetZoomWindow.endValue ?? (dates.length - 1))));
    return Math.max(1, endIdx - startIdx + 1);
  }, [dates.length, zoomWindow, targetZoomWindow]);
  const visibleWindow = useMemo(() => {
    if (!dates.length) return { startIdx: 0, endIdx: -1 };
    const startIdx = Math.max(0, Math.min(dates.length - 1, Math.floor(zoomWindow.startValue ?? targetZoomWindow.startValue ?? 0)));
    const endIdx = Math.max(startIdx, Math.min(dates.length - 1, Math.floor(zoomWindow.endValue ?? targetZoomWindow.endValue ?? (dates.length - 1))));
    return { startIdx, endIdx };
  }, [dates.length, zoomWindow, targetZoomWindow]);

  const visibleBarWidth = useMemo(() => getVisibleBarWidth(range, visibleDateCount), [range, visibleDateCount]);
  const visibleBarPercent = useMemo(() => getVisibleBarPercent(range, visibleDateCount), [range, visibleDateCount]);

  const groups = useMemo(() => {
    const set = new Set();
    const startIdx = Math.max(0, visibleWindow.startIdx);
    const endIdx = Math.min(daily.length - 1, visibleWindow.endIdx);
    for (let i = startIdx; i <= endIdx; i++) {
      const d = daily[i];
      if (!d) continue;
      const src = split === 'model' ? d.by_model : (d.by_family || {});
      for (const [k, v] of Object.entries(src)) {
        if (!v) continue;
        const value = metric === 'elapsed_seconds'
          ? (v.elapsed_seconds || 0)
          : metric === 'cost'
            ? (v.cost || 0)
            : (v.tokens || 0);
        if (value > 0) set.add(k);
      }
    }
    return [...set];
  }, [daily, split, visibleWindow, metric]);

  const rawSeriesData = useMemo(() => groups.map((g) => {
    return {
      name: g,
      values: daily.map((d) => {
        const src = split === 'model' ? d.by_model : (d.by_family || {});
        const v = src[g];
        if (!v) return 0;
        return metric === 'elapsed_seconds' ? v.elapsed_seconds || 0 : metric === 'cost' ? v.cost || 0 : v.tokens || 0;
      }),
    };
  }), [groups, daily, split, metric]);

  const dayTotals = useMemo(() => daily.map((_, j) => {
    let sum = 0;
    for (const s of rawSeriesData) {
      sum += s.values[j] || 0;
    }
    return sum;
  }), [daily, rawSeriesData]);
  const maxVisibleDayTotal = useMemo(() => {
    if (!dayTotals.length || visibleWindow.endIdx < visibleWindow.startIdx) return 0;
    let maxVal = 0;
    for (let i = visibleWindow.startIdx; i <= visibleWindow.endIdx; i++) {
      maxVal = Math.max(maxVal, dayTotals[i] || 0);
    }
    return maxVal;
  }, [dayTotals, visibleWindow]);

  const isRelative = displayMode === 'relative';

  const targetDaily = useMemo(() => ({
    dates,
    series: rawSeriesData.map((s) => ({ key: s.name, label: s.name, data: s.values })),
  }), [dates, rawSeriesData]);

  const presentationScaleKey = `${metric}\0${split}`;
  const animatedDaily = useDailyStackPresentationTween(targetDaily, !isRelative, presentationScaleKey);

  const animatedByKey = useMemo(
    () => new Map((animatedDaily?.series || []).map((s) => [s.key, s])),
    [animatedDaily],
  );

  const tooltipDayTotals = useMemo(() => {
    if (isRelative) return dayTotals;
    const n = dates.length;
    const out = new Array(n).fill(0);
    for (const s of animatedDaily?.series || []) {
      for (let j = 0; j < n; j++) out[j] += s.data[j] || 0;
    }
    return out;
  }, [isRelative, dayTotals, animatedDaily, dates.length]);

  const absoluteYAxisMax = useMemo(() => {
    if (displayMode === 'relative') return 100;
    if (!maxVisibleDayTotal) return undefined;
    return Math.ceil(maxVisibleDayTotal * 1.1);
  }, [displayMode, maxVisibleDayTotal]);

  const cumulativeData = useMemo(() => {
    if (!isRelative) return null;
    if (!rawSeriesData.length) return [];
    const allVals = rawSeriesData.map((s) => {
      const vals = s.values.map((v, j) => (dayTotals[j] > 0 ? (v / dayTotals[j]) * 100 : 0));
      for (let j = 1; j < vals.length; j++) {
        if (dayTotals[j] === 0) vals[j] = vals[j - 1];
      }
      return vals;
    });
    let cum = allVals[0].map(() => 0);
    return allVals.map((vals, i) => {
      const prevStack = [...cum];
      cum = cum.map((c, j) => c + vals[j]);
      return { values: vals, prevStack };
    });
  }, [isRelative, rawSeriesData, dayTotals]);

  const series = useMemo(() => {
    if (isRelative) {
      return groups.map((g, seriesIdx) => {
        const color = split === 'model' ? getModelColor(g) : getFamilyColor(g);
        const s = rawSeriesData[seriesIdx];
        if (!s) return null;
        const cd = cumulativeData[seriesIdx];
        if (!cd) return null;
        return {
          name: g,
          type: 'line',
          stack: 'total',
          smooth: 0.2,
          areaStyle: { opacity: 1 },
          lineStyle: { width: 0 },
          symbol: 'none',
          data: cd.values,
          itemStyle: { color },
        };
      }).filter(Boolean);
    }
    return groups.map((g) => {
      const color = split === 'model' ? getModelColor(g) : getFamilyColor(g);
      const data = animatedByKey.get(g)?.data ?? dates.map(() => 0);
      return {
        name: g,
        type: 'bar',
        stack: 'total',
        data,
        itemStyle: { color },
        barWidth: visibleBarPercent,
        barMaxWidth: visibleBarWidth,
        barMinWidth: Math.min(10, visibleBarWidth),
      };
    });
  }, [
    isRelative,
    groups,
    split,
    cumulativeData,
    rawSeriesData,
    animatedByKey,
    dates,
    visibleBarPercent,
    visibleBarWidth,
  ]);

  const labelSpecs = useMemo(() => {
    if (!isRelative || !cumulativeData) return [];
    return cumulativeData
      .map((cd, seriesIdx) => {
        const s = rawSeriesData[seriesIdx];
        const color = split === 'model' ? getModelColor(s.name) : getFamilyColor(s.name);
        const labelColor = getContrastLabelColor(color);
        const coord = largestRectInBand(cd.values, cd.prevStack);
        if (!coord) return null;
        const maxVal = Math.max(...cd.values);
        if (maxVal < 8) return null;
        return { name: s.name, labelColor, coord };
      })
      .filter(Boolean);
  }, [isRelative, cumulativeData, rawSeriesData, split]);

  const updateGraphicLabels = useCallback(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current.getEchartsInstance();
    if (!isRelative || labelSpecs.length === 0) {
      chart.setOption({ graphic: { elements: [] } }, { notMerge: false });
      return;
    }
    const labels = labelSpecs.map((spec) => {
      const [x, y] = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, spec.coord);
      return {
        type: 'text',
        left: x,
        top: y,
        style: {
          text: spec.name,
          fill: spec.labelColor,
          fontSize: 10,
          fontWeight: 500,
          textAlign: 'center',
          textVerticalAlign: 'middle',
        },
        z: 10,
        silent: true,
      };
    });
    chart.setOption({ graphic: { elements: labels } }, { notMerge: false });
  }, [isRelative, labelSpecs]);

  useEffect(() => {
    const t = setTimeout(updateGraphicLabels, 150);
    return () => clearTimeout(t);
  }, [isRelative, labelSpecs, updateGraphicLabels]);

  useEffect(() => {
    const onResize = () => updateGraphicLabels();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateGraphicLabels]);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: isRelative ? 'line' : 'shadow' },
      appendToBody: true,
      confine: true,
      formatter: (params) => {
        if (!params?.length) return '';
        const dayIdx = params[0]?.dataIndex;
        const totalsForTip = tooltipDayTotals;
        const total = dayIdx != null ? totalsForTip[dayIdx] : 0;
        let prevIdx = dayIdx;
        if (displayMode === 'relative' && total === 0 && dayIdx != null) {
          for (let k = dayIdx - 1; k >= 0; k--) {
            if (totalsForTip[k] > 0) {
              prevIdx = k;
              break;
            }
          }
        }
        const displayTotal = displayMode === 'relative' && total === 0 ? (totalsForTip[prevIdx] ?? 0) : total;
        let html = `<b>${params[0]?.axisValue ?? ''}</b><br/>`;
        const sorted = [...params].filter((p) => p.value > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
        for (const p of sorted) {
          const rawVal = displayMode === 'relative'
            ? (rawSeriesData.find((s) => s.name === p.seriesName)?.values[prevIdx] ?? 0)
            : p.value;
          if (displayMode === 'relative') {
            html += `${p.marker} ${p.seriesName}: ${p.value.toFixed(1)}% (${curMetric.fn(rawVal)})<br/>`;
          } else {
            html += `${p.marker} ${p.seriesName}: ${curMetric.fn(p.value)}<br/>`;
          }
        }
        html += displayMode === 'relative'
          ? `<b>Total: 100% (${curMetric.fn(displayTotal)})</b>`
          : `<b>Total: ${curMetric.fn(total)}</b>`;
        return html;
      },
    },
    legend: { data: groups, textStyle: { color: '#8b949e', fontSize: 10 }, top: 0, itemWidth: 10, itemHeight: 10 },
    grid: { left: 70, right: 20, top: 35, bottom: 55 },
    dataZoom: [{
      type: 'slider',
      startValue: zoomWindow.startValue,
      endValue: zoomWindow.endValue,
      borderColor: '#30363d',
      fillerColor: 'rgba(99, 102, 241, 0.08)',
      handleStyle: { color: '#6366f1' },
      textStyle: { color: '#484f58' },
    }],
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: displayMode !== 'relative',
      axisLabel: { color: '#484f58', fontSize: 10, rotate: 45 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#30363d' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: displayMode === 'relative' ? 100 : absoluteYAxisMax,
      scale: false,
      axisLabel: {
        formatter: displayMode === 'relative' ? (v) => v + '%' : (v) => curMetric.fn(v),
        color: '#484f58',
      },
      splitLine: { lineStyle: { color: '#21262d' } },
    },
    series,
    ...(isRelative ? ECHARTS_ANIMATION : ECHARTS_OVERVIEW_DAILY),
  };

  return (
    <div className="chart-card">
      <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
      <ReactEChartsCore
        ref={chartRef}
        echarts={echarts}
        option={option}
        style={{ height: 400 }}
        theme="dark"
        notMerge={false}
        replaceMerge={['series', 'legend', 'graphic']}
        lazyUpdate={false}
        onChartReady={updateGraphicLabels}
        onEvents={{
          click: (params) => {
            const date = params?.axisValue || params?.name;
            if (date) onSelectDate(date);
          },
          datazoom: (params) => {
            setZoomWindow(parseDataZoomToWindow(params, dates, zoomWindowRef.current));
            requestAnimationFrame(() => updateGraphicLabels());
          },
        }}
      />
    </div>
  );
});

export default function DailyUsage({
  data,
  range = 'total',
  chartMode = 'default',
  navigateToDayRequest = null,
  onNavigateToDayConsumed,
}) {
  const [metric, setMetric] = useState('tokens');
  const [split, setSplit] = useState('model');
  const [displayMode, setDisplayMode] = useState('absolute');
  const [selectedDate, setSelectedDate] = useState(null);

  if (!data?.data?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;

  const daily = data.data;

  useEffect(() => {
    if (!selectedDate && daily[0]) setSelectedDate(daily[daily.length - 1]?.date || daily[0]?.date);
  }, [daily, selectedDate]);

  const handleSelectDate = useCallback((date) => {
    if (date) setSelectedDate(date);
  }, []);

  const selectedDay = daily.find((d) => d.date === selectedDate) || null;

  return (
    <div className="animate-in">
      <div className="section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="section-title">Daily Usage</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="btn-group">
            {METRICS.map((m) => <button key={m.key} className={`btn ${metric === m.key ? 'active' : ''}`} onClick={() => setMetric(m.key)}>{m.label}</button>)}
          </div>
          <div className="btn-group">
            {SPLIT_MODES.map((s) => <button key={s.key} className={`btn ${split === s.key ? 'active' : ''}`} onClick={() => setSplit(s.key)}>{s.label}</button>)}
          </div>
          <div className="btn-group">
            {DISPLAY_MODES.map((d) => <button key={d.key} className={`btn ${displayMode === d.key ? 'active' : ''}`} onClick={() => setDisplayMode(d.key)}>{d.label}</button>)}
          </div>
        </div>
      </div>

      <DailyMainChart
        daily={daily}
        range={range}
        metric={metric}
        split={split}
        displayMode={displayMode}
        onSelectDate={handleSelectDate}
        navigateToDayRequest={navigateToDayRequest}
        onNavigateToDayConsumed={onNavigateToDayConsumed}
      />

      {selectedDay && (
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.75rem' }}>
            {formatDayDetailTitle(selectedDay, metric)}
          </div>
          <DayDetail day={selectedDay} chartMode={chartMode} />
        </div>
      )}
    </div>
  );
}
