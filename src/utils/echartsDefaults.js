const AUTO = 'auto';

/** Shared ECharts animation defaults for non-Overview charts */
export const ECHARTS_ANIMATION = {
  animationDuration: 750,
  animationDurationUpdate: 220,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Label animation - fade in after chart finishes */
export const ECHARTS_LABEL_ANIMATION = {
  show: true,
  animationDuration: 250,
  animationDurationUpdate: 220,
  animationDelay: 250,
  animationDelayUpdate: 180,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Detail donut charts (Repos/Models/Daily) */
export const ECHARTS_DONUT_ANIMATION = {
  ...ECHARTS_ANIMATION,
  animationDurationUpdate: 200,
  animationDelayUpdate: 0,
  animationEasingUpdate: 'cubicOut',
};

/** Detail bar charts (Repos/Models/Daily) */
export const ECHARTS_DETAIL_BAR_ANIMATION = {
  animationDuration: 700,
  animationDurationUpdate: 220,
  animationDelay: 250,
  animationDelayUpdate: 140,
  animationEasing: 'cubicOut',
  animationEasingUpdate: 'cubicOut',
};

/** Detail bar labels */
export const ECHARTS_DETAIL_BAR_LABEL_ANIMATION = {
  ...ECHARTS_LABEL_ANIMATION,
  animationDelay: 950,
  animationDelayUpdate: 360,
};

/**
 * Overview ingest animation control panel.
 *
 * `speed` is the generic knob:
 * - `1` = current baseline
 * - `2` = 2x faster
 * - `0.5` = 2x slower
 *
 * Main timings are scaled by `speed`.
 * Per-chart overrides use:
 * - `'auto'` to inherit the scaled main value
 * - a number to force an explicit value in ms
 */
export const OVERVIEW_INGEST_ANIMATION = {
  speed: 1,
  main: {
    presentationDurationMs: 190,
    chartAppearDurationMs: 0,
    chartUpdateDurationMs: 200,
    easing: 'linear',
    easingUpdate: 'linear',
  },
  daily: {
    chartAppearDurationMs: AUTO,
    chartUpdateDurationMs: 30,
    easing: AUTO,
    easingUpdate: AUTO,
  },
  bars: {
    chartAppearDurationMs: AUTO,
    chartUpdateDurationMs: 20,
    easing: AUTO,
    easingUpdate: AUTO,
  },
  donuts: {
    chartAppearDurationMs: AUTO,
    chartUpdateDurationMs: AUTO,
    easing: AUTO,
    easingUpdate: 'linear', 
    seriesAnimation: false,
  },
};

function safeSpeed(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function scaledMainDuration(ms) {
  return Math.max(0, Math.round(ms / safeSpeed(OVERVIEW_INGEST_ANIMATION.speed)));
}

function resolveOverviewValue(overrideValue, mainValue) {
  return overrideValue === AUTO ? scaledMainDuration(mainValue) : overrideValue;
}

function resolveOverviewString(overrideValue, mainValue) {
  return overrideValue === AUTO ? mainValue : overrideValue;
}

function buildOverviewChartAnimation(overrides) {
  return {
    animation: true,
    animationDuration: resolveOverviewValue(
      overrides.chartAppearDurationMs,
      OVERVIEW_INGEST_ANIMATION.main.chartAppearDurationMs
    ),
    animationDurationUpdate: resolveOverviewValue(
      overrides.chartUpdateDurationMs,
      OVERVIEW_INGEST_ANIMATION.main.chartUpdateDurationMs
    ),
    animationEasing: resolveOverviewString(
      overrides.easing,
      OVERVIEW_INGEST_ANIMATION.main.easing
    ),
    animationEasingUpdate: resolveOverviewString(
      overrides.easingUpdate,
      OVERVIEW_INGEST_ANIMATION.main.easingUpdate
    ),
  };
}

export const OVERVIEW_PRESENTATION_DURATION_MS = scaledMainDuration(
  OVERVIEW_INGEST_ANIMATION.main.presentationDurationMs
);

/** Overview page - resolved main animation config */
export const ECHARTS_OVERVIEW_ANIMATION = buildOverviewChartAnimation({
  chartAppearDurationMs: AUTO,
  chartUpdateDurationMs: AUTO,
  easing: AUTO,
  easingUpdate: AUTO,
});

/** Overview DailySpark - compact stacked bar */
export const ECHARTS_OVERVIEW_DAILY = buildOverviewChartAnimation(
  OVERVIEW_INGEST_ANIMATION.daily
);

/** Overview Top Repos - horizontal bar chart */
export const ECHARTS_OVERVIEW_BARS = buildOverviewChartAnimation(
  OVERVIEW_INGEST_ANIMATION.bars
);

/** Overview Work Type & Models - donut charts */
export const ECHARTS_OVERVIEW_DONUTS = buildOverviewChartAnimation(
  OVERVIEW_INGEST_ANIMATION.donuts
);

export const ECHARTS_OVERVIEW_DONUT_SERIES_ANIMATION =
  OVERVIEW_INGEST_ANIMATION.donuts.seriesAnimation;

export { AUTO as OVERVIEW_ANIMATION_AUTO };
