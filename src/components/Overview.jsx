import React, { useState } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getRepoColor, getFamilyColor, getModelColor } from '../utils/colors';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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

const COUNT_DURATION = 180;

export default function Overview({ data, heatmap, families, repos, models, range = 'total' }) {
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
  const timeValid = useCountUp(cov.time_valid ?? 0, COUNT_DURATION);

  const reposForRange = Array.isArray(repos?.data) ? repos.data : repos?.data?.[range] || repos?.data?.total || [];
  const familiesForRange = Array.isArray(families?.data) ? families.data : families?.data?.[range] || families?.data?.total || [];
  const modelsForRange = Array.isArray(models?.data) ? models.data : models?.data?.[range] || models?.data?.total || [];

  const topRepos = reposForRange.slice(0, 6);
  const topFamilies = familiesForRange;
  const topModels = modelsForRange.slice(0, 6);

  if (!ov) return null;

  const repoOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: params => params?.length ? `${params[0].axisValue}: ${fmt(params[0].value)} tokens` : '',
    },
    grid: { left: 130, right: 20, top: 5, bottom: 5 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: [...topRepos].reverse().map(r => r.repo_label),
      axisLabel: {
        color: '#8b949e',
        fontSize: 11,
        formatter: (value) => wrapRepoLabel(value),
      },
      axisTick: { show: false }, axisLine: { show: false },
    },
    series: [{
      type: 'bar',
      data: [...topRepos].reverse().map(r => ({
        value: r.tokens,
        itemStyle: { color: getRepoColor(r.repo_label), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 14,
    }],
  };

  const familyOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: topFamilies.map(f => ({
        name: f.family,
        value: f.tokens,
        itemStyle: { color: getFamilyColor(f.family) },
      })),
    }],
  };

  const modelOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`,
    },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '50%'],
      label: { show: true, color: '#8b949e', fontSize: 11, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: topModels.map(m => ({
        name: m.model_name,
        value: m.tokens,
        itemStyle: { color: getModelColor(m.model_name) },
      })),
    }],
  };

  return (
    <div className="animate-in">
      <div className="stat-row">
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

      <Heatmap heatmapData={heatmap} />

      <div className="grid-3">
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Top Repos</div>
          {topRepos.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={repoOption} style={{ height: 180 }} theme="dark" />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work Type</div>
          {topFamilies.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={familyOption} style={{ height: 180 }} theme="dark" />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models</div>
          {topModels.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={modelOption} style={{ height: 180 }} theme="dark" />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
      </div>

      <div className="coverage-subtle">
        <span style={{ fontWeight: 500 }}>Coverage:</span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--accent)' }} />
          <span className="coverage-nums">{Math.round(enriched)}/{threadRows}</span>
          {' '}enriched thread rows
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--green)' }} />
          <span className="coverage-nums">{Math.round(priced)}/{threadRows}</span>
          {' '}priced thread rows
        </span>
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
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--cyan)' }} />
          <span className="coverage-nums">{Math.round(timeValid)}/{threadRows}</span>
          {' '}timed thread rows
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--orange)' }} />
          <span className="coverage-nums coverage-nums-single">{Math.round(sessions)}</span>
          {' '}root sessions
        </span>
      </div>
    </div>
  );
}
