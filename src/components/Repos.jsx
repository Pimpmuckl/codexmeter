import React, { useState, useMemo, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getRepoColor, getFamilyColor, getModelColor } from '../utils/colors';
import { ECHARTS_ANIMATION, ECHARTS_LABEL_ANIMATION } from '../utils/echartsDefaults';
import { buildBreakdownRows, buildDistributionOption } from './subcharts';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, TitleComponent, CanvasRenderer]);

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n) {
  if (n == null || n === 0) return '—';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

const FAMILY_FILTERS = ['all', 'review', 'exploration', 'planning', 'memory', 'generic'];
const FAMILY_ORDER = ['review', 'exploration', 'planning', 'memory', 'generic'];

function exportChart(ref) {
  if (!ref.current) return;
  const url = ref.current.getEchartsInstance().getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#06080f' });
  Object.assign(document.createElement('a'), { href: url, download: 'codexmeter-repos.png' }).click();
}

function getReposData(data) {
  const d = data?.data;
  return Array.isArray(d) ? d : d?.total || [];
}

function RepoDetailCharts({ repo, chartMode }) {
  const [showDetails, setShowDetails] = useState(false);
  const modelRows = useMemo(() => buildBreakdownRows(repo.by_model), [repo.by_model]);
  const familyRows = useMemo(() => buildBreakdownRows(repo.by_family), [repo.by_family]);

  const modelOption = buildDistributionOption({
    title: 'Models in repo',
    rows: modelRows,
    valueKey: 'tokens',
    colorForKey: getModelColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const familyOption = buildDistributionOption({
    title: 'Work type in repo',
    rows: familyRows,
    valueKey: 'tokens',
    colorForKey: getFamilyColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const summaryRows = [
    ...modelRows.slice(0, 4).map((row) => ({ ...row, scope: 'model' })),
    ...familyRows.slice(0, 4).map((row) => ({ ...row, scope: 'family' })),
  ];

  return (
    <div className="model-detail-wrap">
      <div className="model-detail-charts">
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Models in repo</div>
          <ReactEChartsCore echarts={echarts} option={modelOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} />
        </div>
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Work type in repo</div>
          <ReactEChartsCore echarts={echarts} option={familyOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} />
        </div>
      </div>
      <div className="model-detail-footer">
        <button type="button" className="model-detail-toggle" onClick={() => setShowDetails(v => !v)} aria-expanded={showDetails}>
          <span className="model-detail-toggle-text">{showDetails ? 'Hide details' : 'Show details'}</span>
          <span className={`model-detail-toggle-arrow ${showDetails ? 'expanded' : ''}`} aria-hidden>▼</span>
        </button>
      </div>
      <div className={`model-detail-summary-wrap ${showDetails ? 'expanded' : ''}`}>
        <div className="model-detail-summary">
          {summaryRows.map((row) => (
            <div key={`${row.scope}-${row.key}`} className="model-detail-summary-card">
              <div className="model-detail-summary-head">
                <span className="model-detail-swatch" style={{ background: row.scope === 'model' ? getModelColor(row.key) : getFamilyColor(row.key) }} />
                <span className="model-detail-summary-name" title={row.key}>{row.key}</span>
              </div>
              <div className="model-detail-summary-line">{fmt(row.tokens)} tokens</div>
              <div className="model-detail-summary-line">{row.sessions || 0} sessions</div>
              <div className="model-detail-summary-line">{fmtCost(row.cost)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Repos({ data, chartMode = 'default' }) {
  const [family, setFamily] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const chartRef = useRef(null);

  const reposData = getReposData(data);
  const filtered = useMemo(() => {
    if (!reposData?.length) return [];
    if (family === 'all') return reposData;
    return reposData
      .map((r) => {
        const f = r.by_family?.[family];
        return f ? { ...r, tokens: f.tokens, cost: f.cost, sessions: f.sessions } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.tokens - a.tokens);
  }, [reposData, family]);

  if (!reposData?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;

  const top = filtered.slice(0, 15);
  const reversed = [...top].reverse();
  const maxTokens = Math.max(...top.map((repo) => repo.tokens || 0), 0);

  const option = {
    backgroundColor: 'transparent',
    ...ECHARTS_ANIMATION,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      formatter: (p) => {
        const repo = top[top.length - 1 - p[0].dataIndex];
        return repo ? `<b>${repo.repo_label}</b><br/>Tokens: ${fmt(repo.tokens)}<br/>Cost: ${fmtCost(repo.cost)}<br/>Sessions: ${repo.sessions}` : '';
      },
    },
    grid: { left: 150, right: 50, top: 8, bottom: 8 },
    xAxis: {
      type: 'value',
      splitNumber: 4,
      max: maxTokens || 1,
      axisLabel: { formatter: (v) => fmt(v), color: '#484f58', showMinLabel: true, showMaxLabel: true },
      splitLine: {
        lineStyle: {
          color: ['transparent', '#21262d', '#21262d', '#21262d', 'transparent'],
        },
      },
    },
    yAxis: { type: 'category', data: reversed.map((r) => r.repo_label), axisLabel: { color: '#8b949e', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{
      type: 'bar',
      data: reversed.map((r) => ({ value: r.tokens, itemStyle: { color: getRepoColor(r.repo_label), borderRadius: [0, 3, 3, 0] } })),
      barMaxWidth: 16,
      label: { show: true, position: 'right', formatter: (p) => fmt(p.value), color: '#8b949e', fontSize: 10, ...ECHARTS_LABEL_ANIMATION },
    }],
  };

  return (
    <div className="animate-in">
      <div className="section-header">
        <span className="section-title">Repos</span>
        <div className="btn-group">
          {FAMILY_FILTERS.map((f) => <button key={f} className={`btn ${family === f ? 'active' : ''}`} onClick={() => setFamily(f)}>{f}</button>)}
        </div>
      </div>

      <div className="chart-card">
        <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          style={{ height: Math.max(250, top.length * 28) }}
          theme="dark"
          lazyUpdate={true}
          onEvents={{
            click: (params) => {
              if (params?.componentType === 'series' && params?.dataIndex != null) {
                const repo = top[top.length - 1 - params.dataIndex];
                if (repo) setExpanded(expanded === repo.repo_key ? null : repo.repo_key);
              }
            },
          }}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Repo</th><th>Tokens</th><th>Cost</th><th>Sessions</th><th style={{ width: 200 }}>Families</th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <React.Fragment key={r.repo_key}>
                <tr onClick={() => setExpanded(expanded === r.repo_key ? null : r.repo_key)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: getRepoColor(r.repo_label), marginRight: 8 }} />
                    {r.repo_label}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(r.tokens)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtCost(r.cost)}</td>
                  <td>{r.sessions}</td>
                  <td>
                    {Object.entries(r.by_family || {})
                      .sort(([a], [b]) => {
                        const ia = FAMILY_ORDER.indexOf(a);
                        const ib = FAMILY_ORDER.indexOf(b);
                        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
                      })
                      .slice(0, 3)
                      .map(([f]) => (
                      <span key={f} className={`tag tag-${f}`} style={{ marginRight: 3 }}>{f}</span>
                    ))}
                  </td>
                </tr>
                {expanded === r.repo_key && (
                  <tr><td colSpan={5} style={{ background: 'var(--bg-surface)', padding: '0.75rem 1rem' }}>
                    <RepoDetailCharts repo={r} chartMode={chartMode} />
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
