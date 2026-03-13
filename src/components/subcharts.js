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
}) {
  const mode = resolveSubchartMode(chartMode, defaultMode);
  const normalizedRows = (rows || [])
    .map((row, index) => {
      const key = row?.key ?? row?.repo_label ?? row?.model_name ?? row?.family ?? null;
      if (!key) return null;
      return { ...row, key: String(key), _idx: index };
    })
    .filter(Boolean);

  if (!normalizedRows.length) {
    return {
      title: {
        text: title,
        left: 'center',
        top: 'middle',
        textStyle: { fontSize: 12, color: '#484f58', fontWeight: 'normal' },
      },
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
  }

  if (mode === 'donut') {
    return {
      backgroundColor: 'transparent',
      title: {
        text: title,
        left: 'center',
        top: 8,
        textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p) => `${p.name}: ${valueFormatter(p.value)} (${p.percent}%)`,
        confine: false,
        appendToBody: true,
      },
      series: [{
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '55%'],
        label: { show: true, color: '#8b949e', fontSize: 10, formatter: '{b}' },
        labelLine: { lineStyle: { color: '#30363d' } },
        itemStyle: { borderColor: '#161b22', borderWidth: 2 },
        data: normalizedRows.map((row) => ({
          name: row.key,
          value: row[valueKey] || 0,
          itemStyle: { color: colorForKey(row.key) },
        })),
      }],
    };
  }

  const reversed = [...normalizedRows].reverse();
  const maxValue = Math.max(...normalizedRows.map((row) => row[valueKey] || 0), 0);
  return {
    backgroundColor: 'transparent',
    title: {
      text: title,
      left: 'center',
      top: 8,
      textStyle: { fontSize: 11, color: '#8b949e', fontWeight: 'normal' },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const idx = params?.[0]?.dataIndex;
        const row = reversed[idx];
        return row ? `${row.key}: ${valueFormatter(row[valueKey] || 0)}` : '';
      },
    },
    grid: { left: 65, right: 50, top: 35, bottom: 20 },
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
      axisLabel: { color: '#8b949e', fontSize: 10 },
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
      },
    }],
  };
}
