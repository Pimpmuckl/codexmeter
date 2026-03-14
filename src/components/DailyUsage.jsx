import React, { useState, useRef, useMemo, useEffect } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor, getFamilyColor, getRepoColor } from '../utils/colors';
import { ECHARTS_ANIMATION } from '../utils/echartsDefaults';
import { buildBreakdownRows, buildDistributionOption } from './subcharts';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
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
  { key: 'family', label: 'By Family' },
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

function DayDetail({ day, chartMode }) {
  const modelRows = useMemo(() => buildBreakdownRows(day.by_model), [day.by_model]);
  const repoRows = useMemo(() => buildBreakdownRows(day.by_repo), [day.by_repo]);

  const modelOption = buildDistributionOption({
    title: 'Models for day',
    rows: modelRows,
    valueKey: 'tokens',
    colorForKey: getModelColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const repoOption = buildDistributionOption({
    title: 'Repos for day',
    rows: repoRows,
    valueKey: 'tokens',
    colorForKey: getRepoColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  return (
    <div className="model-detail-wrap">
      <div className="model-detail-charts">
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Repos for day</div>
          <ReactEChartsCore echarts={echarts} option={repoOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} />
        </div>
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models for day</div>
          <ReactEChartsCore echarts={echarts} option={modelOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} />
        </div>
      </div>
    </div>
  );
}

export default function DailyUsage({ data, range = 'total', chartMode = 'default' }) {
  const [metric, setMetric] = useState('tokens');
  const [split, setSplit] = useState('model');
  const [selectedDate, setSelectedDate] = useState(null);
  const chartRef = useRef(null);

  if (!data?.data?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;

  const daily = data.data;
  const dates = daily.map((d) => d.date);
  const curMetric = METRICS.find((m) => m.key === metric);
  const zoomStart = useMemo(() => getZoomStart(range, dates.length), [range, dates.length]);

  useEffect(() => {
    if (!selectedDate && daily[0]) setSelectedDate(daily[daily.length - 1]?.date || daily[0]?.date);
  }, [daily, selectedDate]);

  const groups = useMemo(() => {
    const set = new Set();
    for (const d of daily) {
      const src = split === 'model' ? d.by_model : (d.by_family || {});
      for (const k of Object.keys(src)) set.add(k);
    }
    return [...set];
  }, [daily, split]);

  const series = groups.map((g) => ({
    name: g,
    type: 'bar',
    stack: 'total',
    data: daily.map((d) => {
      const src = split === 'model' ? d.by_model : (d.by_family || {});
      const v = src[g];
      if (!v) return 0;
      return metric === 'elapsed_seconds' ? v.elapsed_seconds || 0 : metric === 'cost' ? v.cost || 0 : v.tokens || 0;
    }),
    itemStyle: { color: split === 'model' ? getModelColor(g) : getFamilyColor(g) },
    barMaxWidth: 14,
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      confine: true,
      formatter: (params) => {
        let html = `<b>${params[0].axisValue}</b><br/>`;
        let total = 0;
        const sorted = [...params].filter((p) => p.value > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
        for (const p of sorted) {
          html += `${p.marker} ${p.seriesName}: ${curMetric.fn(p.value)}<br/>`;
          total += p.value;
        }
        html += `<b>Total: ${curMetric.fn(total)}</b>`;
        return html;
      },
    },
    legend: { data: groups, textStyle: { color: '#8b949e', fontSize: 10 }, top: 0, itemWidth: 10, itemHeight: 10 },
    grid: { left: 70, right: 20, top: 35, bottom: 55 },
    dataZoom: [{
      type: 'slider',
      start: zoomStart,
      end: 100,
      borderColor: '#30363d',
      fillerColor: 'rgba(99, 102, 241, 0.08)',
      handleStyle: { color: '#6366f1' },
      textStyle: { color: '#484f58' },
    }],
    xAxis: { type: 'category', data: dates, axisLabel: { color: '#484f58', fontSize: 10, rotate: 45 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#30363d' } } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => curMetric.fn(v), color: '#484f58' }, splitLine: { lineStyle: { color: '#21262d' } } },
    series,
    ...ECHARTS_ANIMATION,
  };

  const selectedDay = daily.find((d) => d.date === selectedDate) || null;

  return (
    <div className="animate-in">
      <div className="section-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className="section-title">Daily Usage</span>
          <span className="chart-badge">approximate allocation</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div className="btn-group">
            {METRICS.map((m) => <button key={m.key} className={`btn ${metric === m.key ? 'active' : ''}`} onClick={() => setMetric(m.key)}>{m.label}</button>)}
          </div>
          <div className="btn-group">
            {SPLIT_MODES.map((s) => <button key={s.key} className={`btn ${split === s.key ? 'active' : ''}`} onClick={() => setSplit(s.key)}>{s.label}</button>)}
          </div>
        </div>
      </div>

      <div className="chart-card">
        <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          style={{ height: 400 }}
          theme="dark"
          notMerge={true}
          lazyUpdate={true}
          onEvents={{
            click: (params) => {
              const date = params?.axisValue || params?.name;
              if (date) setSelectedDate(date);
            },
          }}
        />
      </div>

      {selectedDay && (
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.75rem' }}>Day detail: {selectedDay.date}</div>
          <DayDetail day={selectedDay} chartMode={chartMode} />
        </div>
      )}
    </div>
  );
}
