import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import ReactEChartsCore from '../utils/echartsReact';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent, GraphicComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor, getFamilyColor, getRepoColor, getContrastLabelColor } from '../utils/colors';
import { formatCompactNumber } from '../utils/formatters';
import { ECHARTS_ANIMATION, ECHARTS_LABEL_ANIMATION } from '../utils/animationsDefault';
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

function getZoomStart(range, count) {
  if (!count) return 0;
  if (range === 'd7') return Math.max(0, 100 - (7 / count) * 100);
  if (range === 'd30') return Math.max(0, 100 - (30 / count) * 100);
  return 0;
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
}) {
  const [zoomWindow, setZoomWindow] = useState({ start: 0, end: 100 });
  const chartRef = useRef(null);
  const dates = daily.map((d) => d.date);
  const curMetric = METRICS.find((m) => m.key === metric);
  const zoomStart = useMemo(() => getZoomStart(range, dates.length), [range, dates.length]);

  useEffect(() => {
    setZoomWindow({ start: zoomStart, end: 100 });
  }, [zoomStart]);

  const visibleDateCount = useMemo(() => {
    if (!dates.length) return 0;
    const startPct = Math.max(0, Math.min(100, zoomWindow.start ?? zoomStart));
    const endPct = Math.max(startPct, Math.min(100, zoomWindow.end ?? 100));
    const startIdx = Math.max(0, Math.floor((startPct / 100) * dates.length));
    const endIdx = Math.min(dates.length - 1, Math.ceil((endPct / 100) * dates.length) - 1);
    return Math.max(1, endIdx - startIdx + 1);
  }, [dates.length, zoomWindow, zoomStart]);

  const visibleBarWidth = useMemo(() => getVisibleBarWidth(range, visibleDateCount), [range, visibleDateCount]);
  const visibleBarPercent = useMemo(() => getVisibleBarPercent(range, visibleDateCount), [range, visibleDateCount]);

  const groups = useMemo(() => {
    const set = new Set();
    for (const d of daily) {
      const src = split === 'model' ? d.by_model : (d.by_family || {});
      for (const k of Object.keys(src)) set.add(k);
    }
    return [...set];
  }, [daily, split]);

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
  const maxDayTotal = useMemo(() => Math.max(...dayTotals, 0), [dayTotals]);

  const isRelative = displayMode === 'relative';
  let cumulativeData = null;
  if (isRelative) {
    const allVals = rawSeriesData.map((s) => {
      const vals = s.values.map((v, j) => (dayTotals[j] > 0 ? (v / dayTotals[j]) * 100 : 0));
      for (let j = 1; j < vals.length; j++) {
        if (dayTotals[j] === 0) vals[j] = vals[j - 1];
      }
      return vals;
    });
    let cum = allVals[0].map(() => 0);
    cumulativeData = allVals.map((vals, i) => {
      const prevStack = [...cum];
      cum = cum.map((c, j) => c + vals[j]);
      return { values: vals, prevStack };
    });
  }
  const series = rawSeriesData.map((s, seriesIdx) => {
    const color = split === 'model' ? getModelColor(s.name) : getFamilyColor(s.name);
    let data;
    if (isRelative) {
      const cd = cumulativeData[seriesIdx];
      data = cd.values;
      const labelColor = getContrastLabelColor(color);
      let labelIdx = 0;
      let maxVal = 0;
      for (let j = 0; j < data.length; j++) {
        if (data[j] > maxVal) {
          maxVal = data[j];
          labelIdx = j;
        }
      }
      const showLabel = maxVal >= 8;
      const centerY = showLabel ? cd.prevStack[labelIdx] + data[labelIdx] / 2 : 0;
      return {
        name: s.name,
        type: 'line',
        stack: 'total',
        smooth: 0.2,
        areaStyle: { opacity: 1 },
        lineStyle: { width: 0 },
        symbol: 'none',
        data,
        itemStyle: { color },
      };
    }
    data = s.values;
    return {
      name: s.name,
      type: 'bar',
      stack: 'total',
      data,
      itemStyle: { color },
      barWidth: visibleBarPercent,
      barMaxWidth: visibleBarWidth,
      barMinWidth: Math.min(10, visibleBarWidth),
    };
  });

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
        const dayIdx = params?.[0]?.dataIndex;
        const total = dayIdx != null ? dayTotals[dayIdx] : 0;
        let prevIdx = dayIdx;
        if (displayMode === 'relative' && total === 0 && dayIdx != null) {
          for (let k = dayIdx - 1; k >= 0; k--) {
            if (dayTotals[k] > 0) {
              prevIdx = k;
              break;
            }
          }
        }
        const displayTotal = displayMode === 'relative' && total === 0 ? (dayTotals[prevIdx] ?? 0) : total;
        let html = `<b>${params[0].axisValue}</b><br/>`;
        const sorted = [...params]
          .filter((p) => p.seriesName !== '__day_click_overlay__' && p.value > 0)
          .sort((a, b) => (b.value || 0) - (a.value || 0));
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
      start: zoomWindow.start,
      end: zoomWindow.end,
      borderColor: '#30363d',
      fillerColor: 'rgba(99, 102, 241, 0.08)',
      handleStyle: { color: '#6366f1' },
      textStyle: { color: '#484f58' },
    }],
    xAxis: { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10, rotate: 45 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: {
      type: 'value',
      min: displayMode === 'relative' ? 0 : undefined,
      max: displayMode === 'relative' ? 100 : undefined,
      axisLabel: {
        formatter: displayMode === 'relative' ? (v) => v + '%' : (v) => curMetric.fn(v),
        color: '#484f58',
      },
      splitLine: { lineStyle: { color: '#21262d' } },
    },
    series: [
      ...series,
      {
        name: '__day_click_overlay__',
        type: 'bar',
        data: dayTotals.map(() => (displayMode === 'relative' ? 100 : maxDayTotal)),
        barWidth: '96%',
        barGap: '-100%',
        itemStyle: { color: 'rgba(0,0,0,0)' },
        emphasis: { disabled: true },
        tooltip: { show: false },
        z: 100,
        animation: false,
      },
    ],
    ...ECHARTS_ANIMATION,
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
        lazyUpdate={true}
        onChartReady={updateGraphicLabels}
        onEvents={{
          click: (params) => {
            const date = params?.axisValue || params?.name;
            if (date) onSelectDate(date);
          },
          datazoom: () => {
            const chart = chartRef.current?.getEchartsInstance();
            const dz = chart?.getOption()?.dataZoom?.[0];
            if (dz) {
              setZoomWindow({
                start: typeof dz.start === 'number' ? dz.start : zoomStart,
                end: typeof dz.end === 'number' ? dz.end : 100,
              });
            }
            requestAnimationFrame(() => updateGraphicLabels());
          },
        }}
      />
    </div>
  );
});

export default function DailyUsage({ data, range = 'total', chartMode = 'default' }) {
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
      />

      {selectedDay && (
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.75rem' }}>Day detail: {selectedDay.date}</div>
          <DayDetail day={selectedDay} chartMode={chartMode} />
        </div>
      )}
    </div>
  );
}
