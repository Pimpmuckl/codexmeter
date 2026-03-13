import React, { useState, useMemo } from 'react';
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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const RANGES = [
  { key: 'd7', label: '7d' },
  { key: 'd30', label: '30d' },
  { key: 'total', label: 'All' },
];

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
    if (t < 0.25) return 'rgba(99, 102, 241, 0.2)';
    if (t < 0.5) return 'rgba(99, 102, 241, 0.4)';
    if (t < 0.75) return 'rgba(99, 102, 241, 0.65)';
    return 'rgba(99, 102, 241, 0.9)';
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
              className="heatmap-cell"
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

export default function Overview({ data, heatmap, families, repos }) {
  const [range, setRange] = useState('d30');

  const ov = data?.data;
  if (!ov) return null;

  const d = ov[range] || ov.total || {};
  const cov = d.coverage || {};
  const threadRows = cov.thread_rows ?? cov.total ?? 0;
  const rootSessions = cov.root_sessions ?? d.total_sessions ?? 0;

  const topRepos = repos?.data?.slice(0, 6) || [];
  const topFamilies = families?.data || [];

  const repoOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 130, right: 20, top: 5, bottom: 5 },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: [...topRepos].reverse().map(r => r.repo_label),
      axisLabel: { color: '#8b949e', fontSize: 11 },
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

  return (
    <div className="animate-in">
      <div className="section-header">
        <span className="section-title">Usage Snapshot</span>
        <div className="range-toggle">
          {RANGES.map(r => (
            <button key={r.key} className={`range-btn ${range === r.key ? 'active' : ''}`} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-label">Tokens</div>
          <div className="stat-value">{fmt(d.total_tokens)}</div>
          <div className="stat-sub">{rootSessions.toLocaleString()} root sessions</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Agent Time</div>
          <div className="stat-value">{fmtHours(d.total_elapsed_seconds)}</div>
          <div className="stat-sub">{cov.time_valid} with timestamps</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Est. API Cost</div>
          <div className="stat-value">{fmtCost(d.total_cost)}</div>
          <div className="stat-sub">
            {cov.priced}/{threadRows} priced thread rows
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Repos</div>
          <div className="stat-value">{d.active_repos}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Models</div>
          <div className="stat-value">{d.active_models}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Date Range</div>
          <div className="stat-value" style={{ fontSize: '1rem' }}>
            {fmtDate(d.date_range?.from)} — {fmtDate(d.date_range?.to)}
          </div>
        </div>
      </div>

      <Heatmap heatmapData={heatmap} />

      <div className="grid-2">
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Top Repos</div>
          {topRepos.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={repoOption} style={{ height: 180 }} theme="dark" />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
        <div className="chart-card">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Agent Families</div>
          {topFamilies.length > 0 ? (
            <ReactEChartsCore echarts={echarts} option={familyOption} style={{ height: 180 }} theme="dark" />
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>No data</div>
          )}
        </div>
      </div>

      <div className="coverage-subtle">
        <span style={{ fontWeight: 500 }}>Coverage:</span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--accent)' }} />
          {cov.enriched}/{threadRows} enriched thread rows
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--green)' }} />
          {cov.priced}/{threadRows} priced thread rows
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--cyan)' }} />
          {cov.time_valid}/{threadRows} timed thread rows
        </span>
        <span className="coverage-item">
          <span className="coverage-dot" style={{ background: 'var(--orange)' }} />
          {rootSessions} root sessions
        </span>
      </div>
    </div>
  );
}
