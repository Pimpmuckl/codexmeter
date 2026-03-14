import React, { useState, useRef, useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor, getEffortColor } from '../utils/colors';
import { ECHARTS_ANIMATION, ECHARTS_LABEL_ANIMATION } from '../utils/echartsDefaults';
import { buildDistributionOption } from './subcharts';

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

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'unknown'];

function sortEffortEntries(entries) {
  return [...entries].sort(([a], [b]) => {
    const ia = EFFORT_ORDER.indexOf((a || '').toLowerCase());
    const ib = EFFORT_ORDER.indexOf((b || '').toLowerCase());
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

function ModelDetailCharts({ model, fmt, chartMode }) {
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

  const breakdownRows = summaryRows.map((row) => ({
    key: row.effort,
    sessions: row.sessions,
    tokens: row.tokens,
    avgTokens: row.avgTokens,
  }));

  const runsOption = buildDistributionOption({
    title: 'Sessions by effort',
    rows: breakdownRows,
    valueKey: 'sessions',
    colorForKey: getEffortColor,
    valueFormatter: (value) => Math.round(value).toLocaleString(),
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const tokensOption = buildDistributionOption({
    title: 'Tokens by effort',
    rows: breakdownRows,
    valueKey: 'tokens',
    colorForKey: getEffortColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'donut',
    renderTitleInChart: false,
  });

  const perRunOption = buildDistributionOption({
    title: 'Avg tokens per session',
    rows: breakdownRows,
    valueKey: 'avgTokens',
    colorForKey: getEffortColor,
    valueFormatter: fmt,
    chartMode,
    defaultMode: 'bar',
    renderTitleInChart: false,
    barLabelProgress,
  });

  return (
    <div className="model-detail-wrap">
      <div className="model-detail-charts">
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Sessions by effort</div>
          <ReactEChartsCore echarts={echarts} option={runsOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
        </div>
        <div className="model-detail-donut">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Tokens by effort</div>
          <ReactEChartsCore echarts={echarts} option={tokensOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
        </div>
        <div className="model-detail-bar">
          <div className="chart-title" style={{ marginBottom: '0.5rem' }}>Avg tokens per session</div>
          <ReactEChartsCore echarts={echarts} option={perRunOption} style={{ width: '100%', height: '100%' }} theme="dark" lazyUpdate={true} notMerge={false} />
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
                <span className="model-detail-summary-name" title={row.effort}>{row.effort}</span>
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

function getModelsData(data) {
  const d = data?.data;
  return Array.isArray(d) ? d : d?.total || [];
}

export default function Models({ data, chartMode = 'default' }) {
  const [expanded, setExpanded] = useState(null);
  const chartRef = useRef(null);

  const models = getModelsData(data);
  if (!models?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;
  const reversed = [...models].reverse();
  const maxTokens = Math.max(...models.map((model) => model.tokens || 0), 0);

  const option = {
    backgroundColor: 'transparent',
    ...ECHARTS_ANIMATION,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true, confine: true, formatter: p => {
      const m = models[models.length - 1 - p[0].dataIndex];
      return `<b>${m.model_name}</b><br/>Tokens: ${fmt(m.tokens)}<br/>Cost: ${fmtCost(m.cost)}<br/>Sessions: ${m.sessions}`;
    }},
    grid: { left: 160, right: 50, top: 8, bottom: 8 },
    xAxis: {
      type: 'value',
      splitNumber: 4,
      max: maxTokens || 1,
      axisLabel: { formatter: v => fmt(v), color: '#484f58', fontSize: 10, showMinLabel: true, showMaxLabel: true },
      splitLine: {
        lineStyle: {
          color: ['transparent', '#21262d', '#21262d', '#21262d', 'transparent'],
        },
      },
    },
    yAxis: { type: 'category', data: reversed.map(m => m.model_name), axisLabel: { color: '#8b949e', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{
      type: 'bar',
      data: reversed.map(m => ({
        value: m.tokens,
        itemStyle: { color: getModelColor(m.model_name), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 18,
      label: { show: true, position: 'right', formatter: p => fmt(p.value ?? 0), color: '#8b949e', fontSize: 10, ...ECHARTS_LABEL_ANIMATION },
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
          lazyUpdate={true}
          notMerge={false}
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
                    <ModelDetailCharts model={m} fmt={fmt} chartMode={chartMode} />
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
