import React, { useState, useMemo, useRef } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getRepoColor, getFamilyColor } from '../utils/colors';

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

const FAMILY_FILTERS = ['all', 'implementation', 'review', 'exploration', 'planning', 'memory', 'generic'];

function exportChart(ref) {
  if (!ref.current) return;
  const url = ref.current.getEchartsInstance().getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#06080f' });
  Object.assign(document.createElement('a'), { href: url, download: 'codexmeter-repos.png' }).click();
}

export default function Repos({ data }) {
  const [family, setFamily] = useState('all');
  const [expanded, setExpanded] = useState(null);
  const chartRef = useRef(null);

  const filtered = useMemo(() => {
    if (!data?.data?.length) return [];
    if (family === 'all') return data.data;
    return data.data
      .map(r => { const f = r.by_family[family]; return f ? { ...r, tokens: f.tokens, cost: f.cost, sessions: f.sessions } : null; })
      .filter(Boolean)
      .sort((a, b) => b.tokens - a.tokens);
  }, [data, family]);

  if (!data?.data?.length) return <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>No data</div>;

  const top = filtered.slice(0, 15);
  const reversed = [...top].reverse();

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: p => {
      const repo = top[top.length - 1 - p[0].dataIndex];
      return repo ? `<b>${repo.repo_label}</b><br/>Tokens: ${fmt(repo.tokens)}<br/>Cost: ${fmtCost(repo.cost)}<br/>Sessions: ${repo.sessions}` : '';
    }},
    grid: { left: 150, right: 20, top: 8, bottom: 8 },
    xAxis: { type: 'value', axisLabel: { formatter: v => fmt(v), color: '#484f58' }, splitLine: { lineStyle: { color: '#21262d' } } },
    yAxis: { type: 'category', data: reversed.map(r => r.repo_label), axisLabel: { color: '#8b949e', fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: 'bar', data: reversed.map(r => ({ value: r.tokens, itemStyle: { color: getRepoColor(r.repo_label), borderRadius: [0, 3, 3, 0] } })), barMaxWidth: 16 }],
  };

  return (
    <div className="animate-in">
      <div className="section-header">
        <span className="section-title">Repos</span>
        <div className="btn-group">
          {FAMILY_FILTERS.map(f => <button key={f} className={`btn ${family === f ? 'active' : ''}`} onClick={() => setFamily(f)}>{f}</button>)}
        </div>
      </div>

      <div className="chart-card">
        <button className="export-btn" onClick={() => exportChart(chartRef)}>PNG</button>
        <ReactEChartsCore ref={chartRef} echarts={echarts} option={option} style={{ height: Math.max(250, top.length * 28) }} theme="dark" />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Repo</th><th>Tokens</th><th>Cost</th><th>Sessions</th><th style={{ width: 200 }}>Families</th></tr></thead>
          <tbody>
            {filtered.map(r => (
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
                    {Object.entries(r.by_family || {}).sort(([,a],[,b]) => b.tokens - a.tokens).slice(0, 3).map(([f]) => (
                      <span key={f} className={`tag tag-${f}`} style={{ marginRight: 3 }}>{f}</span>
                    ))}
                  </td>
                </tr>
                {expanded === r.repo_key && (
                  <tr><td colSpan={5} style={{ background: 'var(--bg-surface)', padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                      {Object.entries(r.by_model).sort(([,a],[,b]) => b.tokens - a.tokens).map(([model, v]) => (
                        <div key={model} style={{ fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{model}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{fmt(v.tokens)} · {fmtCost(v.cost)}</span>
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
