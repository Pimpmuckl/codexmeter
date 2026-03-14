import React, { useState, useMemo } from 'react';
import { useCountUp, useCountUpValues } from '../hooks/useCountUp';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getRepoColor, getFamilyColor, getModelColor, getContrastLabelColor } from '../utils/colors';
import { ECHARTS_LABEL_ANIMATION, ECHARTS_OVERVIEW_DAILY, ECHARTS_OVERVIEW_BARS, ECHARTS_OVERVIEW_BARS_COUNT_UP_DURATION, ECHARTS_OVERVIEW_DONUTS } from '../utils/echartsDefaults';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, CanvasRenderer]);

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
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

function getZoomSlice(range, dates) {
  if (!dates?.length) return [];
  if (range === 'd7') return dates.slice(-7);
  if (range === 'd30') return dates.slice(-30);
  return dates;
}

function DailySpark({ daily, range }) {
  const dailyArr = Array.isArray(daily?.data) ? daily.data : (Array.isArray(daily) ? daily : []);
  const sliced = useMemo(() => {
    if (!dailyArr.length) return { dates: [], series: [] };
    const dates = dailyArr.map((d) => d.date);
    const visible = getZoomSlice(range, dates);
    const set = new Set();
    for (const d of dailyArr) {
      for (const k of Object.keys(d.by_model || {})) set.add(k);
    }
    const groups = [...set];
    const series = groups.map((g) => ({
      name: g,
      type: 'bar',
      stack: 'total',
      data: visible.map((date) => {
        const d = dailyArr.find((x) => x.date === date);
        const v = d?.by_model?.[g];
        return v?.tokens || 0;
      }),
      itemStyle: { color: getModelColor(g) },
      barMaxWidth: 12,
    }));
    return { dates: visible, series };
  }, [dailyArr, range]);

  if (!sliced.dates.length) {
    return (
      <div className="overview-daily-spark overview-daily-spark-empty">
        <span className="overview-daily-spark-title">Daily Usage</span>
        <span className="overview-daily-spark-empty-text">No daily data</span>
      </div>
    );
  }

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
    xAxis: { type: 'category', data: sliced.dates, show: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: sliced.series,
  };

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div className="overview-daily-spark-chart">
        <ReactEChartsCore echarts={echarts} option={option} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
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
  const data = heatmapData?.data;
  if (!data || typeof data !== 'object') return null;

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

const COUNT_DURATION = ECHARTS_OVERVIEW_BARS_COUNT_UP_DURATION;

export default function Overview({ data, heatmap, daily, families, repos, models, range = 'total' }) {
  const ov = data?.data;
  const d = ov?.[range] || ov?.total || {};
  const cov = d.coverage || {};
  const threadRows = cov.thread_rows ?? cov.total ?? 0;
  const rootSessions = cov.root_sessions ?? d.total_sessions ?? 0;

  const dr = d.date_range;
  const days = dr?.from != null && dr?.to != null ? Math.max(1, Math.ceil((dr.to - dr.from) / 86400)) : 1;
  const exactPriced = cov.priced_exact ?? 0;
  const fallbackPriced = cov.priced_fallback ?? 0;
  const unpriced = cov.unpriced ?? Math.max(threadRows - (cov.priced ?? 0), 0);

  const tokens = useCountUp(d.total_tokens ?? 0, COUNT_DURATION);
  const elapsed = useCountUp(d.total_elapsed_seconds ?? 0, COUNT_DURATION);
  const cost = useCountUp(d.total_cost ?? 0, COUNT_DURATION);
  const sessions = useCountUp(rootSessions, COUNT_DURATION);
  const enriched = useCountUp(cov.enriched ?? 0, COUNT_DURATION);
  const priced = useCountUp(cov.priced ?? 0, COUNT_DURATION);
  const exactPricedAnim = useCountUp(exactPriced, COUNT_DURATION);
  const fallbackPricedAnim = useCountUp(fallbackPriced, COUNT_DURATION);
  const unpricedAnim = useCountUp(unpriced, COUNT_DURATION);

  const reposForRange = Array.isArray(repos?.data) ? repos.data : repos?.data?.[range] || repos?.data?.total || [];
  const familiesForRange = Array.isArray(families?.data) ? families.data : families?.data?.[range] || families?.data?.total || [];
  const modelsForRange = Array.isArray(models?.data) ? models.data : models?.data?.[range] || models?.data?.total || [];

  const topRepos = reposForRange.slice(0, 6);
  const topFamilies = familiesForRange;
  const topModels = modelsForRange.slice(0, 6);

  const animTokens = useCountUpValues(
    topRepos.map((r) => r.tokens ?? 0),
    ECHARTS_OVERVIEW_BARS_COUNT_UP_DURATION
  );

  if (!ov) return null;

  const reversedRepos = [...topRepos].reverse();
  const maxRepoTokens = Math.max(...topRepos.map(r => r.tokens || 0), 1);
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
      data: reversedRepos.map(r => r.repo_label),
      axisLabel: {
        color: '#8b949e',
        fontSize: 11,
        formatter: (value) => wrapRepoLabel(value),
      },
      axisTick: { show: false }, axisLine: { show: false },
    },
    series: [{
      type: 'bar',
      data: reversedRepos.map(r => {
        const val = r.tokens || 0;
        const pct = val / maxRepoTokens;
        const inside = pct >= 0.25;
        const barColor = getRepoColor(r.repo_label);
        return {
          value: val,
          itemStyle: { color: barColor, borderRadius: [0, 3, 3, 0] },
          label: {
            show: true,
            position: inside ? 'insideRight' : 'right',
            distance: 5,
            offset: [0, 1.5],
            formatter: (p) => {
            const idx = reversedRepos.length - 1 - (p.dataIndex ?? 0);
            return fmt(animTokens[Math.max(0, idx)] ?? 0);
          },
            color: inside ? getContrastLabelColor(barColor) : '#8b949e',
            fontSize: 10,
            ...ECHARTS_LABEL_ANIMATION,
          },
        };
      }),
      barWidth: '80%',
    }],
  };

  const familyTotal = topFamilies.reduce((s, f) => s + (f.tokens || 0), 0);
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
      ...ECHARTS_OVERVIEW_DONUTS,
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}', ...ECHARTS_LABEL_ANIMATION },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: topFamilies.map(f => {
        const pct = familyTotal > 0 ? (f.tokens || 0) / familyTotal : 0;
        const showLabel = pct >= 0.01;
        return {
          name: f.family,
          value: f.tokens,
          itemStyle: { color: getFamilyColor(f.family) },
          label: { show: showLabel, color: getFamilyColor(f.family) },
          labelLine: { show: showLabel },
        };
      }),
    }],
  };

  const modelTotal = topModels.reduce((s, m) => s + (m.tokens || 0), 0);
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
      ...ECHARTS_OVERVIEW_DONUTS,
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}', ...ECHARTS_LABEL_ANIMATION },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: topModels.map(m => {
        const pct = modelTotal > 0 ? (m.tokens || 0) / modelTotal : 0;
        const showLabel = pct >= 0.01;
        return {
          name: m.model_name,
          value: m.tokens,
          itemStyle: { color: getModelColor(m.model_name) },
          label: { show: showLabel, color: getModelColor(m.model_name) },
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
            <div className="stat-value">{fmt(tokens)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmt(tokens / days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Agent Time</div>
            <div className="stat-value">{fmtHours(elapsed)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmtHours(elapsed / days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Est. API Cost</div>
            <div className="stat-value">{fmtCost(cost)}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{fmtCost(cost / days)}</span> per day</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sessions</div>
            <div className="stat-value">{Math.round(sessions).toLocaleString()}</div>
            <div className="stat-per-day"><span className="stat-per-day-value">{(sessions / days).toFixed(1)}</span> per day</div>
          </div>
        </div>
        <DailySpark daily={daily} range={range} />
      </div>

      <Heatmap heatmapData={heatmap} />

      <div className="grid-3">
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Top Repos</div>
          {topRepos.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={repoOption} style={{ height: 180 }} theme="dark" lazyUpdate={true} notMerge={false} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work Type</div>
          {topFamilies.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={familyOption} style={{ height: 180 }} theme="dark" lazyUpdate={true} notMerge={false} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models</div>
          {topModels.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={modelOption} style={{ height: 180 }} theme="dark" lazyUpdate={true} notMerge={false} />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
      </div>

      <div className="coverage-subtle">
        <span style={{ fontWeight: 500 }}>Session coverage:</span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#22c55e' }} />
          <span className="coverage-nums">{Math.round(exactPricedAnim)}</span>
          {' '}exact-priced
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#c084fc' }} />
          <span className="coverage-nums">{Math.round(fallbackPricedAnim)}</span>
          {' '}fallback-priced
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: '#64748b' }} />
          <span className="coverage-nums">{Math.round(unpricedAnim)}</span>
          {' '}unpriced
        </span>
      </div>
    </div>
  );
}
