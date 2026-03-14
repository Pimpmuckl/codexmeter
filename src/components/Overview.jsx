import React, { memo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
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
  OVERVIEW_PRESENTATION_DURATION_MS,
} from '../utils/animationsDefault';
import { useAnimatedOverviewPresentation } from '../hooks/useAnimatedOverviewPresentation';

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
  if (count <= 7) {
    return { barWidth: '72%', barMaxWidth: 28 };
  }
  if (count <= 30) {
    return { barWidth: '54%', barMaxWidth: 18 };
  }
  return { barWidth: null, barMaxWidth: 12 };
}

function DailySpark({ daily }) {
  if (!daily?.dates?.length) {
    return (
      <div className="overview-daily-spark overview-daily-spark-empty">
        <span className="overview-daily-spark-title">Daily Usage</span>
        <span className="overview-daily-spark-empty-text">No daily data</span>
      </div>
    );
  }

  const { barWidth, barMaxWidth } = getOverviewDailyBarSizing(daily.dates.length);

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
        let html = `<b>${params[0].axisValue}</b><br/>`;
        let total = 0;
        const sorted = [...params].filter((p) => p.value > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
        for (const p of sorted) {
          html += `${p.marker} ${p.seriesName}: ${fmt(p.value)}<br/>`;
          total += p.value;
        }
        html += `<b>Total: ${fmt(total)}</b>`;
        return html;
      },
    },
    grid: { left: 4, right: 4, top: 4, bottom: 4 },
    xAxis: { type: 'category', data: daily.dates, show: false },
    yAxis: { type: 'value', show: false, scale: false, min: 0 },
    series: daily.series.map((series) => ({
      name: series.label,
      type: 'bar',
      stack: 'total',
      data: series.data,
      itemStyle: { color: getModelColor(series.key) },
      ...(barWidth ? { barWidth } : {}),
      barMaxWidth,
    })),
  };

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div className="overview-daily-spark-chart">
        <ReactEChartsCore echarts={echarts} option={option} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={false} notMerge={false} />
      </div>
    </div>
  );
}

const HEATMAP_METRICS = [
  { key: 'tokens', label: 'Tokens', fmt: fmt },
  { key: 'elapsed', label: 'Time', fmt: v => fmtHours(v) },
  { key: 'cost', label: 'Cost', fmt: fmtCost },
];

function Heatmap({ heatmapData }) {
  const [metric, setMetric] = useState('tokens');
  const data = heatmapData || {};

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

  function intensity(v) {
    if (v === 0) return 'var(--bg-elevated)';
    const t = Math.min(v / maxVal, 1);
    if (t < 0.15) return 'rgba(99, 102, 241, 0.4)';
    if (t < 0.4) return 'rgba(99, 102, 241, 0.6)';
    if (t < 0.7) return 'rgba(99, 102, 241, 0.85)';
    if (t < 1) return 'rgba(99, 102, 241, 0.95)';
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
              className={`heatmap-cell ${c.val > 0 ? 'active' : ''}`}
              style={{ background: intensity(c.val) }}
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
}) {
  const presentation = useAnimatedOverviewPresentation(
    { overview: data, heatmap, daily, families, repos, models, range },
    {
      duration: OVERVIEW_PRESENTATION_DURATION_MS,
      onSettledChange: onPresentationSettledChange,
      ingestProgress,
      isIngestActive,
    }
  );

  if (!presentation.ready) return null;

  const { stats, topRepos, topFamilies, topModels } = presentation;
  const reversedRepos = [...topRepos.slice(0, 6)].reverse();
  const maxRepoTokens = Math.max(...topRepos.slice(0, 6).map(row => row.tokens || 0), 1);
  const orderedFamilies = [...topFamilies].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const orderedModels = [...topModels.slice(0, 6)].sort((a, b) => String(a.label).localeCompare(String(b.label)));

  const repoOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_BARS,
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
      type: 'bar',
      data: reversedRepos.map((row) => {
        const val = row.tokens || 0;
        const pct = val / maxRepoTokens;
        const inside = pct >= 0.25;
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

  const familyTotal = orderedFamilies.reduce((sum, row) => sum + (row.tokens || 0), 0);
  const familyOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DONUTS,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: true,
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      type: 'pie',
      animation: ECHARTS_OVERVIEW_DONUT_SERIES_ANIMATION,
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: orderedFamilies.map((row) => {
        const pct = familyTotal > 0 ? (row.tokens || 0) / familyTotal : 0;
        const showLabel = pct >= 0.01;
        return {
          name: row.label,
          value: row.tokens,
          itemStyle: { color: getFamilyColor(row.key) },
          label: { show: showLabel, color: getFamilyColor(row.key) },
          labelLine: { show: showLabel },
        };
      }),
    }],
  };

  const modelTotal = orderedModels.reduce((sum, row) => sum + (row.tokens || 0), 0);
  const modelOption = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DONUTS,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: true,
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      type: 'pie',
      animation: ECHARTS_OVERVIEW_DONUT_SERIES_ANIMATION,
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: orderedModels.map((row) => {
        const pct = modelTotal > 0 ? (row.tokens || 0) / modelTotal : 0;
        const showLabel = pct >= 0.01;
        return {
          name: row.label,
          value: row.tokens,
          itemStyle: { color: getModelColor(row.key) },
          label: { show: showLabel, color: getModelColor(row.key) },
          labelLine: { show: showLabel },
        };
      }),
    }],
  };

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
        <DailySpark daily={presentation.daily} />
      </div>

      <Heatmap heatmapData={presentation.heatmap} />

      <div className="grid-3">
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Top Repos</div>
          {topRepos.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={repoOption} style={{ height: 180 }} theme="dark" lazyUpdate={false} notMerge={false} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work Type</div>
          {topFamilies.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={familyOption} style={{ height: 180 }} theme="dark" lazyUpdate={false} notMerge={true} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models</div>
          {topModels.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={modelOption} style={{ height: 180 }} theme="dark" lazyUpdate={false} notMerge={true} />
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
    && prev.isIngestActive === next.isIngestActive;
}

export default memo(Overview, areOverviewPropsEqual);
