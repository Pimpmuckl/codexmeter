import React, { useState, useMemo, useRef } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatCompactNumber } from '../utils/formatters';

function fmt(n) {
  return formatCompactNumber(n);
}
function fmtCost(n) { return n == null ? '—' : '$' + n.toFixed(2); }
function fmtDur(s) { if (!s || s <= 0) return '—'; const m = Math.floor(s / 60); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; }
function fmtTime(ts) { return !ts ? '—' : new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

const ch = createColumnHelper();
const FAMILY_TAG = { review: 'tag-review', exploration: 'tag-exploration', planning: 'tag-planning', memory: 'tag-memory', generic: 'tag-generic' };

export default function Sessions({ data }) {
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState([{ id: 'started_at', desc: true }]);
  const parentRef = useRef(null);

  const rows = useMemo(() => {
    if (!data?.data) return [];
    const q = search.toLowerCase();
    if (!q) return data.data;
    return data.data.filter(s =>
      (s.repo_label || '').toLowerCase().includes(q) ||
      (s.model_name || '').toLowerCase().includes(q) ||
      (s.agent_role || '').toLowerCase().includes(q) ||
      (s.agent_nickname || '').toLowerCase().includes(q) ||
      (s.title || '').toLowerCase().includes(q) ||
      (s.descendant_models || []).some(v => (v || '').toLowerCase().includes(q)) ||
      (s.descendant_families || []).some(v => (v || '').toLowerCase().includes(q)) ||
      (s.descendant_roles || []).some(v => (v || '').toLowerCase().includes(q)) ||
      (s.descendant_nicknames || []).some(v => (v || '').toLowerCase().includes(q)) ||
      (s.related_titles || []).some(v => (v || '').toLowerCase().includes(q))
    );
  }, [data, search]);

  const columns = useMemo(() => [
    ch.accessor('started_at', { header: 'Time', cell: i => fmtTime(i.getValue()), size: 130 }),
    ch.accessor('repo_label', { header: 'Repo', cell: i => i.getValue() || '—', size: 140 }),
    ch.accessor('model_name', { header: 'Model', cell: i => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{i.getValue() || '?'}</span>, size: 130 }),
    ch.accessor('thread_count', {
      header: 'Threads',
      cell: i => {
        const count = i.getValue() || 1;
        const row = i.row.original;
        return count > 1 ? `${count} (${row.subagent_count || 0} sub)` : '1';
      },
      size: 92,
    }),
    ch.accessor('agent_family', { header: 'Root', cell: i => <span className={`tag ${FAMILY_TAG[i.getValue()] || 'tag-generic'}`}>{i.getValue()}</span>, size: 100 }),
    ch.accessor('agent_nickname', { header: 'Agent', cell: i => i.getValue() || '—', size: 85 }),
    ch.accessor('reasoning_effort', { header: 'Effort', cell: i => i.getValue() || '—', size: 70 }),
    ch.accessor('elapsed_seconds', { header: 'Duration', cell: i => fmtDur(i.getValue()), size: 85 }),
    ch.accessor('tokens_used', { header: 'Tokens', cell: i => <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(i.getValue())}</span>, size: 90 }),
    ch.accessor('cost', { header: 'Cost', cell: i => <span style={{ fontFamily: 'var(--font-mono)' }}>{i.getValue() != null ? fmtCost(i.getValue()) : '—'}</span>, size: 80 }),
    ch.accessor('title', { header: 'Title', cell: i => <span title={i.getValue()} style={{ opacity: 0.6 }}>{(i.getValue() || '').slice(0, 55)}</span>, size: 240 }),
  ], []);

  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  const tableRows = table.getRowModel().rows;
  const filteredTotals = useMemo(() => rows.reduce((acc, row) => {
    acc.sessions += 1;
    acc.tokens += row.tokens_used || 0;
    acc.cost += row.cost || 0;
    acc.elapsed += row.elapsed_seconds || 0;
    return acc;
  }, { sessions: 0, tokens: 0, cost: 0, elapsed: 0 }), [rows]);
  const virt = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
    getItemKey: (index) => tableRows[index]?.id ?? index,
  });
  const virtualItems = virt.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? virt.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="animate-in">
      <div className="table-wrap">
        <div className="table-search">
          <input placeholder="Search sessions..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.4rem 1rem', borderBottom: '1px solid var(--border)' }}>
          {rows.length.toLocaleString()} root sessions
          {data && !data.complete && <span className="incomplete-badge" style={{ marginLeft: '0.5rem' }}>partial</span>}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '0.45rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span>Filtered sessions: <strong style={{ color: 'var(--text-secondary)' }}>{filteredTotals.sessions.toLocaleString()}</strong></span>
          <span>Tokens: <strong style={{ color: 'var(--text-secondary)' }}>{fmt(filteredTotals.tokens)}</strong></span>
          <span>Cost: <strong style={{ color: 'var(--text-secondary)' }}>{fmtCost(filteredTotals.cost)}</strong></span>
          <span>Time: <strong style={{ color: 'var(--text-secondary)' }}>{fmtDur(filteredTotals.elapsed)}</strong></span>
        </div>
        <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
          <table style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>{hg.headers.map(h => (
                  <th key={h.id} style={{ width: h.getSize() }} onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted()] || ''}
                  </th>
                ))}</tr>
              ))}
            </thead>
            <tbody>
              {virtualItems.length === 0 && <tr><td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No sessions</td></tr>}
              {paddingTop > 0 && <tr><td colSpan={columns.length} style={{ height: `${paddingTop}px`, padding: 0, borderBottom: 'none' }} /></tr>}
              {virtualItems.map(vi => {
                const row = tableRows[vi.index];
                return <tr key={row.id} style={{ height: vi.size }}>{row.getVisibleCells().map(c => <td key={c.id} style={{ width: c.column.getSize() }}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>;
              })}
              {paddingBottom > 0 && <tr><td colSpan={columns.length} style={{ height: `${paddingBottom}px`, padding: 0, borderBottom: 'none' }} /></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
