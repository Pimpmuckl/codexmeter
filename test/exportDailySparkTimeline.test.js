import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExportDailySparkCadence, buildExportDailySparkFrame } from '../src/utils/exportDailySparkTimeline.js';

function buildDaily(dayCount = 14) {
  const dates = Array.from({ length: dayCount }, (_, index) => `2026-03-${String(index + 1).padStart(2, '0')}`);
  return {
    dates,
    series: [
      {
        key: 'gpt-5.4',
        label: 'gpt-5.4',
        data: dates.map((_, index) => (index + 1) * 100),
      },
      {
        key: 'gpt-5.5',
        label: 'gpt-5.5',
        data: dates.map((_, index) => (index + 1) * 25),
      },
    ],
  };
}

function stackValue(frame, index) {
  return frame.series.reduce((sum, series) => sum + (series.data[index]?.[1] || 0), 0);
}

test('export daily spark starts as a seven-day grow-in-place frame', () => {
  const daily = buildDaily(14);
  const frame = buildExportDailySparkFrame(daily, {
    seekMs: 100,
    startMs: 100,
    endMs: 15100,
  });

  assert.equal(frame.dates.length, 7);
  assert.equal(frame.xMin, -0.5);
  assert.equal(frame.xMax, 6.5);
  assert.equal(frame.yMax, 875);
  assert.equal(stackValue(frame, 0), 0);
  assert.equal(stackValue(frame, 6), 0);
});

test('export daily spark grows the first seven days before moving the camera', () => {
  const daily = buildDaily(14);
  const frame = buildExportDailySparkFrame(daily, {
    seekMs: 800,
    startMs: 100,
    endMs: 15100,
  });

  assert.equal(frame.dates.length, 7);
  assert.equal(frame.xMax, 6.5);
  assert.ok(stackValue(frame, 0) > 0);
  assert.ok(stackValue(frame, 6) < 875);
});

test('export daily spark expands continuously and reveals the crossing day fractionally', () => {
  const daily = buildDaily(14);
  const frame = buildExportDailySparkFrame(daily, {
    seekMs: 8300,
    startMs: 100,
    endMs: 15100,
  });
  const crossingIndex = Math.floor(frame.cursor + 0.5);
  const crossingFullValue = (crossingIndex + 1) * 125;
  const crossingValue = stackValue(frame, crossingIndex);

  assert.ok(frame.cursor > 6);
  assert.ok(frame.dates.length >= crossingIndex + 1);
  assert.equal(frame.xMax, frame.cursor + 0.5);
  assert.ok(crossingValue > 0);
  assert.ok(crossingValue < crossingFullValue);
});

test('export daily spark ends at the full final daily domain', () => {
  const daily = buildDaily(14);
  const frame = buildExportDailySparkFrame(daily, {
    seekMs: 15100,
    startMs: 100,
    endMs: 15100,
  });

  assert.equal(frame.cursor, 13);
  assert.equal(frame.dates.length, 14);
  assert.equal(frame.xMax, 13.5);
  assert.equal(frame.yMax, 1750);
  assert.equal(stackValue(frame, 13), 1750);
});

test('export daily spark cadence uses a stable baseline with slow edges', () => {
  const cadence = buildExportDailySparkCadence(129, {
    startMs: 100,
    endMs: 15100,
  });
  const durations = cadence.map((row) => row.durationMs);
  const middleDurations = durations.slice(14, -14);
  const middleMin = Math.min(...middleDurations);
  const middleMax = Math.max(...middleDurations);

  assert.ok(durations[0] > middleMax, 'the first day should be slower than the cruising cadence');
  assert.ok(durations[128] > middleMax * 2.5, 'the final day should brake visibly');
  assert.ok(middleMax - middleMin < 1, 'the middle cadence should not pulse between bursts and stalls');
  assert.ok(durations.every((duration) => duration > 75 && duration < 360));
});
