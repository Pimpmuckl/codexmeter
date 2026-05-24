const EXPORT_DAILY_WINDOW_DAYS = 7;
const EXPORT_DAILY_CHART_WIDTH_PX = 304;
const EXPORT_DAILY_REVEAL_LEAD_DAYS = 0.18;
const EXPORT_DAILY_REVEAL_SPAN_DAYS = 1.35;

export function buildExportDailySparkFrame(daily, {
  seekMs = 0,
  startMs = 0,
  endMs = 1,
} = {}) {
  const dates = daily?.dates || [];
  if (!dates.length) {
    return {
      dates: [],
      series: [],
      cursor: 0,
      xMin: -0.5,
      xMax: EXPORT_DAILY_WINDOW_DAYS - 0.5,
      yMax: 1,
      barWidth: 1,
      barMaxWidth: 1,
    };
  }

  const lastIndex = dates.length - 1;
  const introEndIndex = Math.min(EXPORT_DAILY_WINDOW_DAYS - 1, lastIndex);
  const motionStartMs = Math.max(0, startMs || 0);
  const motionEndMs = Math.max(motionStartMs + 1, endMs || motionStartMs + 1);
  const motionDurationMs = motionEndMs - motionStartMs;
  const elapsedMs = Math.max(0, Math.min(motionDurationMs, (seekMs || 0) - motionStartMs));
  const progress = computeScheduledDayProgress(dates.length, elapsedMs, motionDurationMs);
  const cursor = progress <= EXPORT_DAILY_WINDOW_DAYS
    ? introEndIndex
    : Math.min(lastIndex, progress - 0.5);
  const visibleEndIndex = Math.max(introEndIndex, Math.min(lastIndex, Math.ceil(progress)));
  const visibleDates = dates.slice(0, visibleEndIndex + 1);
  const xMin = -0.5;
  const xMax = Math.max(EXPORT_DAILY_WINDOW_DAYS - 0.5, cursor + 0.5);
  const visibleSlots = Math.max(EXPORT_DAILY_WINDOW_DAYS, xMax - xMin);
  const introStackMax = computeStackMax(daily, 0, introEndIndex);
  const barWidth = Math.max(1.8, Math.min(24, (EXPORT_DAILY_CHART_WIDTH_PX / visibleSlots) * 0.72));
  const series = (daily.series || []).map((sourceSeries) => ({
    ...sourceSeries,
    data: visibleDates.map((_, index) => [
      index,
      Math.max(0, Number(sourceSeries.data?.[index]) || 0) * revealFactorForIndex(index, progress, dates.length),
    ]),
  }));

  return {
    dates: visibleDates,
    series,
    cursor,
    xMin,
    xMax,
    yMax: Math.max(1, introStackMax, computeRevealedStackMax(series)),
    barWidth,
    barMaxWidth: Math.max(2, Math.min(26, barWidth * 1.1)),
  };
}

export function buildExportDailySparkCadence(dayCount, {
  startMs = 0,
  endMs = 1,
} = {}) {
  const safeCount = Math.max(0, Math.floor(Number(dayCount) || 0));
  if (!safeCount) return [];

  const motionStartMs = Math.max(0, startMs || 0);
  const motionEndMs = Math.max(motionStartMs + 1, endMs || motionStartMs + 1);
  const durations = buildDayDurations(safeCount, motionEndMs - motionStartMs);
  let cursorMs = motionStartMs;
  return durations.map((durationMs, index) => {
    const start = cursorMs;
    const end = start + durationMs;
    cursorMs = end;
    return {
      day: index + 1,
      startMs: start,
      endMs: end,
      durationMs,
    };
  });
}

function computeScheduledDayProgress(dayCount, elapsedMs, motionDurationMs) {
  const safeCount = Math.max(1, Math.floor(Number(dayCount) || 1));
  const durations = buildDayDurations(safeCount, motionDurationMs);
  const clampedElapsed = Math.max(0, Math.min(motionDurationMs, elapsedMs || 0));
  let cursorMs = 0;

  for (let index = 0; index < durations.length; index += 1) {
    const durationMs = Math.max(1, durations[index]);
    const nextMs = cursorMs + durationMs;
    if (clampedElapsed <= nextMs) {
      return Math.min(safeCount, index + ((clampedElapsed - cursorMs) / durationMs));
    }
    cursorMs = nextMs;
  }

  return safeCount;
}

function buildDayDurations(dayCount, motionDurationMs) {
  const safeCount = Math.max(1, Math.floor(Number(dayCount) || 1));
  const startRampDays = Math.min(safeCount, Math.max(EXPORT_DAILY_WINDOW_DAYS, Math.ceil(safeCount * 0.08)));
  const endRampDays = Math.min(safeCount, Math.max(4, Math.ceil(safeCount * 0.05)));
  const weights = Array.from({ length: safeCount }, (_, index) => {
    const startT = startRampDays <= 1 ? 1 : index / (startRampDays - 1);
    const startBoost = index < startRampDays
      ? 0.95 * (1 - easeInOutCubic(startT))
      : 0;
    const endIndex = safeCount - 1 - index;
    const endT = endRampDays <= 1 ? 1 : 1 - (endIndex / (endRampDays - 1));
    const endBoost = endIndex < endRampDays
      ? 2.2 * easeInOutCubic(endT)
      : 0;
    return 1 + startBoost + endBoost;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const baseMs = Math.max(1, motionDurationMs || 1) / totalWeight;
  return weights.map((weight) => weight * baseMs);
}

function revealFactorForIndex(index, progress, dayCount) {
  if (progress <= 0) return 0;
  if (progress >= dayCount) return 1;
  return easeOutSoft(clamp01((progress - index + EXPORT_DAILY_REVEAL_LEAD_DAYS) / EXPORT_DAILY_REVEAL_SPAN_DAYS));
}

function computeStackMax(daily, startIndex, endIndex) {
  const dates = daily?.dates || [];
  if (!dates.length) return 1;

  const first = Math.max(0, Math.min(dates.length - 1, startIndex || 0));
  const last = Math.max(first, Math.min(dates.length - 1, endIndex ?? dates.length - 1));
  let max = 0;
  for (let index = first; index <= last; index += 1) {
    let total = 0;
    for (const series of daily.series || []) {
      total += Math.max(0, Number(series?.data?.[index]) || 0);
    }
    max = Math.max(max, total);
  }
  return Math.max(1, max);
}

function computeRevealedStackMax(series) {
  const length = Math.max(0, ...series.map((item) => item.data?.length || 0));
  let max = 0;
  for (let index = 0; index < length; index += 1) {
    let total = 0;
    for (const item of series) {
      total += Math.max(0, Number(item.data?.[index]?.[1]) || 0);
    }
    max = Math.max(max, total);
  }
  return max;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutSoft(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 2.35);
}

function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5
    ? 4 * x * x * x
    : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
