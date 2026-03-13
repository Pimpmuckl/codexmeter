import React, { useState, useRef, useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor, getEffortColor } from '../utils/colors';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);

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

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'unknown'];

function sortEffortEntries(entries) {
  return [...entries].sort(([a], [b]) => {
    const ia = EFFORT_ORDER.indexOf((a || '').toLowerCase());
    const ib = EFFORT_ORDER.indexOf((b || '').toLowerCase());
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

function ModelDetailCharts({ model, fmt }) {
  const [showDetails, setShowDetails] = useState(false);
  const effortData = useMemo(() => sortEffortEntries(Object.entries(model.by_effort || {})), [model.by_effort]);
  if (!effortData.length) return null;

  const summaryRows = effortData.map(([effort, v]) => ({
    effort,
    sessions: v.sessions,
    tokens: v.tokens,
    avgTokens: v.sessions ? Math.round(v.tokens / v.sessions) : 0,
    cost: v.cost,
    exactPriced: v.exact_priced || 0,
    fallbackPriced: v.heuristic_priced || 0,
  }));

  const runsOption = {
    backgroundColor: 'transparent',
    title: { text: 'Sessions by effort', left: 'center', top: 8, textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' } },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: ${p.value} sessions (${p.percent}%)`, confine: false, appendToBody: true },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '55%'],
      color: effortData.map(([e]) => getEffortColor(e)),
      label: { show: true, color: '#8b949e', fontSize: 10, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: effortData.map(([effort, v]) => ({
        name: effort,
        value: v.sessions,
        itemStyle: { color: getEffortColor(effort) },
      })),
    }],
  };

  const tokensOption = {
    backgroundColor: 'transparent',
    title: { text: 'Tokens by effort', left: 'center', top: 8, textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' } },
    tooltip: { trigger: 'item', formatter: p => `${p.name}: ${fmt(p.value)} tokens (${p.percent}%)`, confine: false, appendToBody: true },
    series: [{
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '55%'],
      color: effortData.map(([e]) => getEffortColor(e)),
      label: { show: true, color: '#8b949e', fontSize: 10, formatter: '{b}' },
      labelLine: { lineStyle: { color: '#30363d' } },
      itemStyle: { borderColor: '#161b22', borderWidth: 2 },
      data: effortData.map(([effort, v]) => ({
        name: effort,
        value: v.tokens,
        itemStyle: { color: getEffortColor(effort) },
      })),
    }],
  };

  const perRunReversed = [...effortData].reverse();
  const perRunOption = {
    backgroundColor: 'transparent',
    title: { text: 'Avg tokens per session', left: 'center', top: 8, textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: params => {
      const idx = params[0]?.dataIndex;
      const [effort, v] = perRunReversed[idx] || [];
      const avg = v?.sessions ? Math.round(v.tokens / v.sessions) : 0;
      return `${effort}: ${fmt(avg)} tokens/session (${v?.sessions} sessions)`;
    }},
    grid: { left: 55, right: 45, top: 35, bottom: 20 },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt(v), color: '#484f58', fontSize: 10 }, splitLine: { lineStyle: { color: '#21262d' } } },
    yAxis: { type: 'category', data: perRunReversed.map(([e]) => e), axisLabel: { color: '#8b949e', fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{
      type: 'bar',
      data: perRunReversed.map(([effort, v]) => ({
        value: v.sessions ? Math.round(v.tokens / v.sessions) : 0,
        itemStyle: { color: getEffortColor(effort), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 14,
      label: { show: true, position: 'right', formatter: p => fmt(p.value), color: '#8b949e', fontSize: 9 },
    }],
  };

  return (
    <div className="model-detail-wrap">
      <div className="model-detail-note">
        Model drill-in is grouped by reasoning effort. The bar chart is an average, not a literal per-session timeline.
      </div>
      <div className="model-detail-charts">
        <div className="model-detail-donut">
          <ReactEChartsCore echarts={echarts} option={runsOption} style={{ width: '100%', height: '100%' }} theme="dark" />
        </div>
        <div className="model-detail-donut">
          <ReactEChartsCore echarts={echarts} option={tokensOption} style={{ width: '100%', height: '100%' }} theme="dark" />
        </div>
        <div className="model-detail-bar">
          <ReactEChartsCore echarts={echarts} option={perRunOption} style={{ width: '100%', height: '100%' }} theme="dark" />
        </div>
      </div>
      <div className="model-detail-footer">
        <button
          type="button"
          className="model-detail-toggle"
          onClick={() => setShowDetails(d => !d)}
          aria-expanded={showDetails}
        >
          <span className="model-detail-toggle-text">{showDetails ? 'Hide details' : 'Show details'}</span>
          <span className={`model-detail-toggle-arrow ${showDetails ? 'expanded' : ''}`} aria-hidden>▼</span>
        </button>
      </div>
      <div className={`model-detail-summary-wrap ${showDetails ? 'expanded' : ''}`}>
        <div className="model-detail-summary">
          {summaryRows.map((row) => (
            <div key={row.effort} className="model-detail-summary-card">
              <div className="model-detail-summary-head">
                <span
                  className="model-detail-swatch"
                  style={{ background: getEffortColor(row.effort) }}
                />
                <span>{row.effort}</span>
              </div>
              <div className="model-detail-summary-line">{row.sessions} sessions</div>
              <div className="model-detail-summary-line">{fmt(row.tokens)} tokens</div>
              <div className="model-detail-summary-line">{fmt(row.avgTokens)} avg/session</div>
              <div className="model-detail-summary-line">{fmtCost(row.cost)} cost</div>
              <div className="model-detail-summary-line">{row.exactPriced} exact · {row.fallbackPriced} fallback</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function exportChart(ref) {
  if (!ref.current) return;
  const url = ref.current.getEchartsInstance().getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#06080f' });
  Object.assign(document.createElement('a'), { href: url, download: 'codexmeter-models.png' }).click();
}

export default function Models({ data }) {
  const [expanded, setExpanded] = useState(null);
  const chartRef = useRef(null);

  if (!data?.data?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;

  const models = data.data;
  const reversed = [...models].reverse();

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
      const m = models[models.length - 1 - p[0].dataIndex];
      return `<b>${m.model_name}</b><br/>Tokens: ${fmt(m.tokens)}<br/>Cost: ${fmtCost(m.cost)}<br/>Sessions: ${m.sessions}`;
    }},
    grid: { left: 160, right: 50, top: 8, bottom: 8 },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt(v), color: '#484f58', fontSize: 10 }, splitLine: { lineStyle: { color: '#21262d' } } },
    yAxis: { type: 'category', data: reversed.map(m => m.model_name), axisLabel: { color: '#8b949e', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{
      type: 'bar',
      data: reversed.map(m => ({
        value: m.tokens,
        itemStyle: { color: getModelColor(m.model_name), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 18,
      label: { show: true, position: 'right', formatter: p => fmt(p.value), color: '#8b949e', fontSize: 10 },
    }],
  };

  return (
    <div className="animate-in">
      <div className="section-header">
        <span className="section-title">Models</span>
      </div>

      <div className="chart-card">
        <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
        <ReactEChartsCore
          ref={chartRef}
          echarts={echarts}
          option={option}
          style={{ height: Math.max(180, models.length * 34) }}
          theme="dark"
          onEvents={{
            click: (params) => {
              if (params?.componentType === 'series' && params?.dataIndex != null) {
                const m = models[models.length - 1 - params.dataIndex];
                if (m) setExpanded(expanded === m.model_name ? null : m.model_name);
              }
            },
          }}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Model</th><th>Tokens</th><th>Cost</th><th>Sessions</th><th>Effort Levels</th></tr></thead>
          <tbody>
            {models.map(m => (
              <React.Fragment key={m.model_name}>
                <tr onClick={() => setExpanded(expanded === m.model_name ? null : m.model_name)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: getModelColor(m.model_name), marginRight: 8 }} />
                    {m.model_name}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(m.tokens)}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtCost(m.cost)}</td>
                  <td>{m.sessions}</td>
                  <td>{Object.keys(m.by_effort).length}</td>
                </tr>
                {expanded === m.model_name && (
                  <tr><td colSpan={5} style={{ background: 'var(--bg-surface)', padding: '0.75rem 1rem' }}>
                    <ModelDetailCharts model={m} fmt={fmt} />
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
