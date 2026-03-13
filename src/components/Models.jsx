import React, { useState, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor } from '../utils/colors';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

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
    grid: { left: 160, right: 20, top: 8, bottom: 8 },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt(v), color: '#484f58' }, splitLine: { lineStyle: { color: '#21262d' } } },
    yAxis: { type: 'category', data: reversed.map(m => m.model_name), axisLabel: { color: '#8b949e', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: 'bar', data: reversed.map(m => ({ value: m.tokens, itemStyle: { color: getModelColor(m.model_name), borderRadius: [0, 3, 3, 0] } })), barMaxWidth: 18 }],
  };

  return (
    <div className="animate-in">
      <div className="section-header">
        <span className="section-title">Models</span>
      </div>

      <div className="chart-card">
        <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
        <ReactEChartsCore ref={chartRef} echarts={echarts} option={option} style={{ height: Math.max(180, models.length * 34) }} theme="dark" />
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
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                      {Object.entries(m.by_effort).sort(([,a],[,b]) => b.tokens - a.tokens).map(([effort, v]) => (
                        <div key={effort} style={{ fontSize: '0.78rem' }}>
                          <span style={{ color: 'var(--cyan)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{effort}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{fmt(v.tokens)} · {v.sessions} runs</span>
                        </div>
                      ))}
                    </div>
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
