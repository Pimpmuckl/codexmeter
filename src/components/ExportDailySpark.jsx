import React, { useMemo } from 'react';
import ReactEChartsCore from '../utils/echartsReact';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getModelColor } from '../utils/colors';
import { formatCompactNumber } from '../utils/formatters';
import { ECHARTS_OVERVIEW_DAILY } from '../utils/animationsDefault';
import { buildExportDailySparkFrame } from '../utils/exportDailySparkTimeline';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

function fmt(n) {
  return formatCompactNumber(n);
}

export default function ExportDailySpark({ daily, seekMs = 0, timing = null }) {
  const frame = useMemo(
    () => buildExportDailySparkFrame(daily, {
      seekMs,
      startMs: timing?.startMs ?? 0,
      endMs: timing?.endMs ?? 1,
    }),
    [daily, seekMs, timing?.startMs, timing?.endMs]
  );

  if (!daily?.dates?.length) {
    return (
      <div className="overview-daily-spark overview-daily-spark-empty">
        <span className="overview-daily-spark-title">Daily Usage</span>
        <span className="overview-daily-spark-empty-text">No daily data</span>
      </div>
    );
  }

  const dateAtIndex = (index) => frame.dates[
    Math.max(0, Math.min(frame.dates.length - 1, Math.round(index)))
  ];
  const option = {
    backgroundColor: 'transparent',
    ...ECHARTS_OVERVIEW_DAILY,
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      appendToBody: true,
      confine: true,
      formatter: (params) => {
        if (!params?.length) return '';
        const axisIndex = Array.isArray(params[0].data) ? params[0].data[0] : params[0].dataIndex;
        let html = `<b>${dateAtIndex(axisIndex)}</b><br/>`;
        let total = 0;
        const sorted = [...params]
          .filter((p) => (Array.isArray(p.value) ? p.value[1] : p.value) > 0)
          .sort((a, b) => ((Array.isArray(b.value) ? b.value[1] : b.value) || 0) - ((Array.isArray(a.value) ? a.value[1] : a.value) || 0));
        for (const p of sorted) {
          const value = Array.isArray(p.value) ? p.value[1] : p.value;
          html += `${p.marker} ${p.seriesName}: ${fmt(value)}<br/>`;
          total += value;
        }
        html += `<b>Total: ${fmt(total)}</b>`;
        return html;
      },
    },
    grid: { left: 4, right: 4, top: 4, bottom: 4 },
    xAxis: {
      type: 'value',
      min: frame.xMin,
      max: frame.xMax,
      show: false,
    },
    yAxis: {
      type: 'value',
      show: false,
      scale: false,
      min: 0,
      max: frame.yMax,
    },
    series: frame.series.map((series) => ({
      id: `overview-export-daily-${series.key}`,
      name: series.label,
      type: 'bar',
      stack: 'total',
      data: series.data,
      itemStyle: { color: getModelColor(series.key) },
      barWidth: frame.barWidth,
      barMaxWidth: frame.barMaxWidth,
      barMinHeight: 0,
    })),
  };

  return (
    <div className="overview-daily-spark">
      <span className="overview-daily-spark-title">Daily Usage</span>
      <div className="overview-daily-spark-chart">
        <ReactEChartsCore
          echarts={echarts}
          option={option}
          style={{ width: '100%', height: '100%' }}
          theme="dark"
          lazyUpdate={false}
          notMerge={true}
          replaceMerge={['series']}
        />
      </div>
    </div>
  );
}
