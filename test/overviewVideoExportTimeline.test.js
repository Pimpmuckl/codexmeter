import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceExportSimulation,
  createExportSimulation,
  mapReplaySeekMs,
} from '../src/utils/overviewVideoExportTimeline.js';

function buildRangeOverview(totalTokens, totalSessions) {
  return {
    total_tokens: totalTokens,
    total_elapsed_seconds: totalTokens / 10,
    total_cost: totalTokens / 1000,
    total_sessions: totalSessions,
    coverage: {
      enriched: totalSessions,
      priced: totalSessions,
      priced_exact: totalSessions,
      priced_fallback: 0,
      unpriced: 0,
      root_sessions: totalSessions,
      thread_rows: totalSessions,
    },
    date_range: {
      from: 0,
      to: 86400,
    },
  };
}

function buildPayload(totalTokens, totalSessions) {
  return {
    progress: { percent: totalTokens / 100, complete: false, phase: 'enrichment' },
    data: {
      overview: {
        total: buildRangeOverview(totalTokens, totalSessions),
        d7: buildRangeOverview(totalTokens, totalSessions),
        d30: buildRangeOverview(totalTokens, totalSessions),
      },
      repos: {
        total: [{ repo_label: 'nextide-web', tokens: totalTokens }],
        d7: [{ repo_label: 'nextide-web', tokens: totalTokens }],
        d30: [{ repo_label: 'nextide-web', tokens: totalTokens }],
      },
      models: {
        total: [{ model_name: 'gpt-5.4', tokens: totalTokens }],
        d7: [{ model_name: 'gpt-5.4', tokens: totalTokens }],
        d30: [{ model_name: 'gpt-5.4', tokens: totalTokens }],
      },
      families: {
        total: [{ family: 'generic', tokens: totalTokens }],
        d7: [{ family: 'generic', tokens: totalTokens }],
        d30: [{ family: 'generic', tokens: totalTokens }],
      },
      daily: {
        '2026-03-10': {
          date: '2026-03-10',
          by_model: {
            'gpt-5.4': { tokens: totalTokens },
          },
        },
      },
      heatmap: {
        '2026-03-10': {
          tokens: totalTokens,
          elapsed: totalTokens / 10,
          cost: totalTokens / 1000,
        },
      },
    },
  };
}

function buildRenderData({ replayEasing = 'cubicIn', tailEasing = 'cubicOut' } = {}) {
  return {
    startHoldDurationMs: 0,
    replayDurationMs: 4000,
    tailDurationMs: 2000,
    finalHoldDurationMs: 1000,
    durationMs: 7000,
    tailSourceFraction: 0.4,
    replayEasing,
    tailEasing,
    replay: {
      duration_ms: 3000,
      bootstrap: {
        payload: {
          ingest_id: 'ingest-1',
          seq: 0,
          ...buildPayload(10, 1),
        },
      },
      events: [
        { event: 'patch', at_ms: 200, payload: { ingest_id: 'ingest-1', seq: 1, ...buildPayload(30, 2) } },
        { event: 'patch', at_ms: 1500, payload: { ingest_id: 'ingest-1', seq: 2, ...buildPayload(60, 4) } },
        { event: 'patch', at_ms: 3000, payload: { ingest_id: 'ingest-1', seq: 3, ...buildPayload(100, 6) } },
      ],
    },
  };
}

function buildSettledEnvelope() {
  return {
    overview: {
      data: {
        total: buildRangeOverview(150, 3),
        d7: buildRangeOverview(150, 3),
        d30: buildRangeOverview(150, 3),
      },
    },
    repos: {
      data: {
        total: [{ repo_label: 'nextide-web', tokens: 150 }],
        d7: [{ repo_label: 'nextide-web', tokens: 150 }],
        d30: [{ repo_label: 'nextide-web', tokens: 150 }],
      },
    },
    models: {
      data: {
        total: [
          { model_name: 'gpt-5.4', tokens: 100 },
          { model_name: 'gpt-5.5', tokens: 50 },
        ],
        d7: [
          { model_name: 'gpt-5.4', tokens: 100 },
          { model_name: 'gpt-5.5', tokens: 50 },
        ],
        d30: [
          { model_name: 'gpt-5.4', tokens: 100 },
          { model_name: 'gpt-5.5', tokens: 50 },
        ],
      },
    },
    families: {
      data: {
        total: [{ family: 'generic', tokens: 150 }],
        d7: [{ family: 'generic', tokens: 150 }],
        d30: [{ family: 'generic', tokens: 150 }],
      },
    },
    daily: {
      data: [{
        date: '2026-03-10',
        tokens: 150,
        elapsed_seconds: 15,
        cost: 0.15,
        sessions: 3,
        by_model: {
          'gpt-5.4': { tokens: 100 },
          'gpt-5.5': { tokens: 50 },
        },
      }],
    },
    heatmap: {
      data: {
        '2026-03-10': {
          tokens: 150,
          elapsed: 15,
          cost: 0.15,
        },
      },
    },
  };
}

function buildMultiDaySettledEnvelope(dayCount = 14) {
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = `2026-03-${String(index + 1).padStart(2, '0')}`;
    const primary = (index + 1) * 100;
    const secondary = (index + 1) * 25;
    return {
      date,
      tokens: primary + secondary,
      elapsed_seconds: index + 1,
      cost: (primary + secondary) / 1000,
      sessions: 1,
      by_model: {
        'gpt-5.4': { tokens: primary },
        'gpt-5.5': { tokens: secondary },
      },
      by_family: {
        generic: { tokens: primary + secondary, sessions: 1 },
      },
      by_repo: {
        'nextide-web': { tokens: primary + secondary, sessions: 1 },
      },
    };
  });
  const totalTokens = days.reduce((sum, day) => sum + day.tokens, 0);
  const heatmap = Object.fromEntries(days.map((day) => [day.date, {
    tokens: day.tokens,
    elapsed: day.elapsed_seconds,
    cost: day.cost,
  }]));

  return {
    overview: {
      data: {
        total: buildRangeOverview(totalTokens, dayCount),
        d7: buildRangeOverview(totalTokens, dayCount),
        d30: buildRangeOverview(totalTokens, dayCount),
      },
    },
    repos: {
      data: {
        total: [{ repo_label: 'nextide-web', tokens: totalTokens }],
        d7: [{ repo_label: 'nextide-web', tokens: totalTokens }],
        d30: [{ repo_label: 'nextide-web', tokens: totalTokens }],
      },
    },
    models: {
      data: {
        total: [
          { model_name: 'gpt-5.4', tokens: days.reduce((sum, day) => sum + day.by_model['gpt-5.4'].tokens, 0) },
          { model_name: 'gpt-5.5', tokens: days.reduce((sum, day) => sum + day.by_model['gpt-5.5'].tokens, 0) },
        ],
        d7: [],
        d30: [],
      },
    },
    families: {
      data: {
        total: [{ family: 'generic', tokens: totalTokens }],
        d7: [{ family: 'generic', tokens: totalTokens }],
        d30: [{ family: 'generic', tokens: totalTokens }],
      },
    },
    daily: { data: days },
    heatmap: { data: heatmap },
  };
}

test('replay easing knob changes replay source progress', () => {
  const linearSim = createExportSimulation(buildRenderData({ replayEasing: 'linear' }));
  const cubicSim = createExportSimulation(buildRenderData({ replayEasing: 'cubicIn' }));
  const midpointMs = linearSim.replayStartMs + 1000;

  const linearSourceMs = mapReplaySeekMs(linearSim, midpointMs);
  const cubicSourceMs = mapReplaySeekMs(cubicSim, midpointMs);

  assert.ok(linearSourceMs > cubicSourceMs, 'linear replay easing should advance source time faster than cubicIn at the same wall time');
});

test('tail easing knob changes late-presentation progress', () => {
  const linearSim = createExportSimulation(buildRenderData({ tailEasing: 'linear' }));
  const cubicOutSim = createExportSimulation(buildRenderData({ tailEasing: 'cubicOut' }));
  const tailMidpointMs = linearSim.tailStartMs + 1000;

  const linearFrame = advanceExportSimulation(linearSim, tailMidpointMs);
  const cubicOutFrame = advanceExportSimulation(cubicOutSim, tailMidpointMs);

  assert.equal(linearFrame.phase, 'tail');
  assert.equal(cubicOutFrame.phase, 'tail');
  assert.ok(
    cubicOutFrame.presentation.stats.tokens > linearFrame.presentation.stats.tokens,
    'cubicOut tail easing should move farther through the tail than linear at the same wall time'
  );
});

test('final export frame uses settled daily model stacks as authoritative truth', () => {
  const sim = createExportSimulation({
    ...buildRenderData(),
    settledEnvelope: buildSettledEnvelope(),
  });

  const frame = advanceExportSimulation(sim, sim.totalDurationMs);
  const dailySeries = new Map(frame.presentation.daily.series.map((series) => [series.key, series.data[0]]));

  assert.equal(frame.phase, 'final_hold');
  assert.equal(frame.presentation.stats.tokens, 150);
  assert.equal(dailySeries.get('gpt-5.4'), 100);
  assert.equal(dailySeries.get('gpt-5.5'), 50);
});

test('export daily spark starts with a seven-day domain and advances by smooth cursor', () => {
  const sim = createExportSimulation({
    ...buildRenderData(),
    settledEnvelope: buildMultiDaySettledEnvelope(14),
  });

  const introFrame = advanceExportSimulation(sim, sim.startHoldDurationMs + 500);
  const midFrame = advanceExportSimulation(sim, sim.startHoldDurationMs + 1800);
  const finalFrame = advanceExportSimulation(sim, sim.totalDurationMs);

  assert.equal(introFrame.presentation.daily.dates.length, 7);
  assert.ok(
    introFrame.presentation.daily.series.some((series) => (series.data[3] || 0) > 0),
    'the intro should move past the first two days quickly'
  );
  assert.ok(
    midFrame.presentation.daily.dates.length > introFrame.presentation.daily.dates.length,
    'the main replay should keep adding days after the seven-day intro'
  );
  assert.equal(finalFrame.presentation.daily.dates.length, 14);
});

test('export heatmap does not reveal days beyond the daily cursor', () => {
  const sim = createExportSimulation({
    ...buildRenderData(),
    settledEnvelope: buildMultiDaySettledEnvelope(14),
  });

  const frame = advanceExportSimulation(sim, sim.startHoldDurationMs + 500);
  const lastDailyDate = frame.presentation.daily.dates[frame.presentation.daily.dates.length - 1];
  const heatmapDates = Object.keys(frame.presentation.heatmap);

  assert.ok(heatmapDates.length > 0);
  assert.ok(heatmapDates.every((date) => date <= lastDailyDate));
});
