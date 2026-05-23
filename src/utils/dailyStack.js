export function getDailyRows(daily) {
  const rows = Array.isArray(daily?.data) ? daily.data : (Array.isArray(daily) ? daily : []);
  return rows.slice().sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
}

export function getBreakdownSource(row, split = 'model') {
  if (split === 'family') return row?.by_family || {};
  if (split === 'repo') return row?.by_repo || {};
  return row?.by_model || {};
}

export function getBreakdownMetricValue(value, metric = 'tokens') {
  if (!value) return 0;
  if (metric === 'elapsed_seconds') return value.elapsed_seconds || 0;
  if (metric === 'cost') return value.cost || 0;
  return value.tokens || 0;
}

export function buildDailyStackPresentation(daily, { split = 'model', metric = 'tokens', dates = null } = {}) {
  const rows = getDailyRows(daily);
  if (!rows.length) return { dates: [], groups: [], series: [], dayTotals: [] };

  const dateList = dates || rows.map((row) => row.date);
  const rowByDate = new Map(rows.map((row) => [row.date, row]));
  const groups = [];
  const seen = new Set();

  for (const date of dateList) {
    const row = rowByDate.get(date);
    const source = getBreakdownSource(row, split);
    for (const [key, value] of Object.entries(source)) {
      if (seen.has(key) || getBreakdownMetricValue(value, metric) <= 0) continue;
      seen.add(key);
      groups.push(key);
    }
  }

  const series = groups.map((key) => ({
    key,
    label: key,
    data: dateList.map((date) => (
      getBreakdownMetricValue(getBreakdownSource(rowByDate.get(date), split)[key], metric)
    )),
  }));

  const dayTotals = dateList.map((_, index) => (
    series.reduce((sum, item) => sum + (item.data[index] || 0), 0)
  ));

  return { dates: dateList, groups, series, dayTotals };
}
