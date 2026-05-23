const AUTO = 'auto';

/**
 * Overview ingest animation control panel.
 *
 * This is the single source of truth for:
 * - Overview client-side presentation timing
 * - Overview ECharts timing defaults
 * - Overview live snapshot transport cadence
 *
 * `speed` scales the main timings:
 * - `1` = baseline
 * - `2` = 2x faster
 * - `0.5` = 2x slower
 *
 * Per-chart overrides use:
 * - `'auto'` to inherit the scaled main value
 * - a number to force an explicit value in ms
 */
export const OVERVIEW_INGEST_ANIMATION = {
  speed: 1,
  live: {
    frameIntervalMs: 33,
    snapshotHz: 12,
  },
  main: {
    presentationDurationMs: 220,
    chartAppearDurationMs: 0,
    chartUpdateDurationMs: 200,
    easing: 'linear',
    easingUpdate: 'linear',
  },
  tail: {
    // Master switch for the end-of-ingest slowdown behavior.
    enabled: true,
    // Progress threshold where the tail mode starts, expressed from 0..1.
    startPercent: 0.95,
    // Fixed presentation duration in ms during the tail; use AUTO to derive it from main.durationScale.
    durationMs: AUTO,
    // Multiplier applied to the normal presentation duration when durationMs is AUTO.
    durationScale: 10,
    // Shared easing applied by the Overview presentation animator during the tail.
    easing: 'cubicOut',
  },
  daily: {
    chartAppearDurationMs: AUTO,
    chartUpdateDurationMs: 60,
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
  heatmap: {
    /** Duration (ms) of the pop animation when a cell gets new data during ingest */
    popDurationMs: 380,
    /** Don't trigger pop when ingest progress is above this (avoids burst at settle) */
    settleThreshold: 0.998,
    /** Min relative intensity rise (0–1) to trigger pop – e.g. 0.08 = cell turning white */
    intensityRiseThreshold: 0.08,
    /** Relative intensity (0–1) that counts as "white" – crossing this triggers pop */
    whiteThreshold: 0.88,
    /** Cell is "new winner" if val >= maxVal * this when max increased */
    nearMaxRatio: 0.985,
  },
  videoExport: {
    // Video export settings
    width: 1080,
    height: 864,
    fps: 60,
    frontloadSettledFrameCount: 1,

    // Intro fade-in effect
    introFadeEnabled: true,
    introFadeStartOpacity: 0.95,
    introContentStartOpacity: 0.05,
    introFadeDurationMs: 400,
    introFadeDelayMs: 0,
    introFadeEasing: 'cubicOut',

    // Start Delay for the animation
    startHoldDurationMs: 100,

    // Replay duration
    replayDurationMs: 10000,

    // Tail Settings
    tailDurationMs: 5000,
    replayEasing: 'cubicInOut',
    tailSourceFraction: 0.55,
    tailEasing: 'cubicOut',
    finalHoldDurationMs: 5000,

    // Final Flash Settings
    finalFlashDurationMs: 1000,
    finalFlashDelayMs: 200,
    finalFlashMaxOpacity: 0.35,

    // Display Tween Settings
    displayTweenStartMs: 200,
    displayTweenBaseMs: 240,
    displayTweenLateMs: 420,
    displayTweenLateWindowMs: 2200,
    chartIntroWindowMs: 2200,
    barsChartIntroUpdateDurationMs: 320,
    barsChartUpdateDurationMs: 50,
    barsChartTailUpdateDurationMs: 240,
    donutsChartIntroUpdateDurationMs: 360,
    donutsChartUpdateDurationMs: 50,
    donutsChartTailUpdateDurationMs: 240,

    // Render settings
    supersampleScale: 2,
    captureFormat: 'png',
    jpegQuality: 92,
    crf: 5,
    encoderPreset: 'veryfast',
  },
};

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

export function resolveOverviewPresentationDuration(progress = 0, isIngestActive = false) {
  const base = OVERVIEW_PRESENTATION_DURATION_MS;
  const tail = OVERVIEW_INGEST_ANIMATION.tail;

  if (!isIngestActive || !tail?.enabled) return base;

  const start = Math.min(Math.max(tail.startPercent ?? 0.9, 0), 0.999);
  const clampedProgress = Math.min(Math.max(progress || 0, 0), 1);
  if (clampedProgress <= start) return base;

  const normalized = (clampedProgress - start) / Math.max(1 - start, 0.001);
  const durationTarget = tail.durationMs === AUTO
    ? Math.round(base * Math.max(tail.durationScale || 1, 1))
    : tail.durationMs;

  return Math.round(base + (durationTarget - base) * cubicOut(normalized));
}

export function resolveOverviewPresentationEasing(progress = 0, isIngestActive = false) {
  const tail = OVERVIEW_INGEST_ANIMATION.tail;
  if (!isIngestActive || !tail?.enabled) return 'linear';

  const start = Math.min(Math.max(tail.startPercent ?? 0.9, 0), 0.999);
  const clampedProgress = Math.min(Math.max(progress || 0, 0), 1);
  if (clampedProgress <= start) return 'linear';

  return tail.easing || 'cubicOut';
}

export function isOverviewTailActive(progress = 0, isIngestActive = false) {
  const tail = OVERVIEW_INGEST_ANIMATION.tail;
  if (!isIngestActive || !tail?.enabled) return false;

  const start = Math.min(Math.max(tail.startPercent ?? 0.9, 0), 0.999);
  const clampedProgress = Math.min(Math.max(progress || 0, 0), 1);
  return clampedProgress > start;
}

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

function cubicOut(t) {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - x, 3);
}
