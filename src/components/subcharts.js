import { ECHARTS_ANIMATION, ECHARTS_DONUT_ANIMATION, ECHARTS_DETAIL_BAR_ANIMATION, ECHARTS_LABEL_ANIMATION, ECHARTS_DETAIL_BAR_LABEL_ANIMATION } from '../utils/echartsDefaults';

export function resolveSubchartMode(chartMode, defaultMode) {
  return chartMode === 'default' ? defaultMode : chartMode;
}

export function buildBreakdownRows(obj, sortBy = 'tokens') {
  return Object.entries(obj || {})
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
}

export function buildDistributionOption({
  title,
  rows,
  valueKey = 'tokens',
  colorForKey,
  valueFormatter,
  chartMode = 'default',
  defaultMode = 'bar',
  emptyLabel = 'No data',
  renderTitleInChart = true,
}) {
  const mode = resolveSubchartMode(chartMode, defaultMode);
  const normalizedRows = (rows || [])
    .map((row, index) => {
      const key = row?.key ?? row?.repo_label ?? row?.model_name ?? row?.family ?? null;
      if (!key) return null;
      return { ...row, key: String(key), _idx: index };
    })
    .filter(Boolean);

  const emptyOpt = {
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
    graphic: {
      type: 'text',
      left: 'center',
      top: '60%',
      style: { text: emptyLabel, fill: '#484f58', fontSize: 11 },
    },
  };
  if (renderTitleInChart) {
    emptyOpt.title = { text: title, left: 'center', top: 'middle', textStyle: { fontSize: 12, color: '#484f58', fontWeight: 'normal' } };
  }
  if (!normalizedRows.length) return emptyOpt;

  if (mode === 'donut') {
    const total = normalizedRows.reduce((s, r) => s + (r[valueKey] || 0), 0);
    const donutOpt = {
      backgroundColor: 'transparent',
      ...ECHARTS_DONUT_ANIMATION,
      tooltip: {
        trigger: 'item',
        appendToBody: true,
        formatter: (p) => `${p.name}: ${valueFormatter(p.value)} (${p.percent}%)`,
      },
      series: [{
        type: 'pie',
        ...ECHARTS_DONUT_ANIMATION,
        radius: ['40%', '62%'],
        center: ['50%', '52%'],
        label: { show: true, color: '#8b949e', fontSize: 10, formatter: '{b}', overflow: 'truncate', width: 90, ...ECHARTS_LABEL_ANIMATION },
        labelLine: { lineStyle: { color: '#30363d' } },
        itemStyle: { borderColor: '#161b22', borderWidth: 2 },
        data: normalizedRows.map((row) => {
          const val = row[valueKey] || 0;
          const pct = total > 0 ? val / total : 0;
          const showLabel = pct >= 0.01;
          return {
            name: row.key,
            value: val,
            itemStyle: { color: colorForKey(row.key) },
            label: { show: showLabel, color: colorForKey(row.key) },
            labelLine: { show: showLabel },
          };
        }),
      }],
    };
    if (renderTitleInChart) {
      donutOpt.title = { text: title, left: 'center', top: 8, textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' } };
    }
    return donutOpt;
  }

  const reversed = [...normalizedRows].reverse();
  const maxValue = Math.max(...normalizedRows.map((row) => row[valueKey] || 0), 0);
  const barOpt = {
    backgroundColor: 'transparent',
    ...ECHARTS_DETAIL_BAR_ANIMATION,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      formatter: (params) => {
        const idx = params?.[0]?.dataIndex;
        const row = reversed[idx];
        return row ? `${row.key}: ${valueFormatter(row[valueKey] || 0)}` : '';
      },
    },
    grid: { left: 65, right: 50, top: renderTitleInChart ? 35 : 20, bottom: 20 },
    xAxis: {
      type: 'value',
      splitNumber: 4,
      max: maxValue || 1,
      axisLabel: {
        formatter: (v) => valueFormatter(v),
        color: '#484f58',
        fontSize: 10,
        showMinLabel: true,
        showMaxLabel: true,
      },
      splitLine: {
        lineStyle: {
          color: ['transparent', '#21262d', '#21262d', '#21262d', 'transparent'],
        },
      },
    },
    yAxis: {
      type: 'category',
      data: reversed.map((row) => row.key),
      axisLabel: { color: '#8b949e', fontSize: 10, overflow: 'truncate', width: 55 },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [{
      type: 'bar',
      data: reversed.map((row) => ({
        value: row[valueKey] || 0,
        itemStyle: { color: colorForKey(row.key), borderRadius: [0, 3, 3, 0] },
      })),
      barMaxWidth: 14,
      label: {
        show: true,
        position: 'right',
        formatter: (p) => valueFormatter(p.value),
        color: '#8b949e',
        fontSize: 9,
        ...ECHARTS_DETAIL_BAR_LABEL_ANIMATION,
      },
    }],
  };
  if (renderTitleInChart) {
    barOpt.title = { text: title, left: 'center', top: 8, textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' } };
  }
  return barOpt;
}
