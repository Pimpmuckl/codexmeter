import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import { createDayKeyFormatter } from './day-key.js';

const ACTIVE_GAP_CAP_MS = 15 * 60 * 1000;
const LINE_HEADER_SCAN_CHARS = 512;
const TIMESTAMP_RE = /"timestamp"\s*:\s*"([^"]+)"/;
const DEFAULT_RG_MIN_BYTES = 10 * 1024 * 1024;
const RG_RELEVANT_PATTERN =
  '"type"\\s*:\\s*"session_meta"|' +
  '"type"\\s*:\\s*"turn_context"|' +
  '"type"\\s*:\\s*"token_count"';
const RG_TOKEN_COUNT_PATTERN = '"type"\\s*:\\s*"token_count"';
const RG_TIMESTAMP_PATTERN = '^\\{[^{}]*"timestamp"\\s*:\\s*"[^"]+"';

export async function enrichFromRollout(rolloutPath, opts = {}) {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return null;
  }

  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toDayKey = opts.toDayKey || createDayKeyFormatter(tz);
  const fastScan = opts.fastScan === true;
  const rgScan = opts.rgScan === true;
  const rgMinBytes = Math.max(0, Number(opts.rgMinBytes ?? DEFAULT_RG_MIN_BYTES) || 0);
  const result = {
    model_name: null,
    reasoning_effort: null,
    first_timestamp: null,
    first_usage_timestamp: null,
    last_timestamp: null,
    active_seconds: null,
    active_by_day: null,
    usage_by_day: null,
    parent_thread_id: null,
    forked_from_id: null,
    usage_total: null,
    usage_reset_detected: false,
  };

  try {
    let lines = null;
    let activeFromRgTimestamps = false;
    if (rgScan && shouldUseRipgrep(rolloutPath, rgMinBytes)) {
      const rgResult = await readRolloutLinesWithRipgrep(rolloutPath);
      if (rgResult) {
        lines = rgResult.relevantLines;
        applyTimestampMatches(result, rgResult.timestampMatches, toDayKey);
        activeFromRgTimestamps = true;
      }
    }
    if (!lines) {
      const content = await readFile(rolloutPath, 'utf8');
      lines = content.split(/\r?\n/);
    }

    let prevTimestamp = null;
    let activeMs = 0;
    const activeByDay = new Map();
    const usageByDay = new Map();
    let lastInputTokens = 0;
    let lastCachedInputTokens = 0;
    let lastOutputTokens = 0;
    let lastReasoningOutputTokens = 0;
    let lastTotalTokens = 0;
    let hasSeenUsage = false;
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        let obj = null;
        let ts = null;

        if (fastScan || activeFromRgTimestamps) {
          ts = extractTimestampMs(line);
          if (ts !== null && !activeFromRgTimestamps) {
            updateTimestampBounds(result, ts);
            if (prevTimestamp !== null && ts >= prevTimestamp) {
              const deltaMs = Math.min(ts - prevTimestamp, ACTIVE_GAP_CAP_MS);
              activeMs += deltaMs;
              if (deltaMs > 0) {
                const dayKey = toDayKey(prevTimestamp);
                activeByDay.set(dayKey, (activeByDay.get(dayKey) || 0) + deltaMs);
              }
            }
            prevTimestamp = ts;
          }
          if (!activeFromRgTimestamps && !isRolloutLineWorthParsing(line)) continue;
          obj = JSON.parse(line);
        } else {
          obj = JSON.parse(line);
          if (obj.timestamp) {
            ts = new Date(obj.timestamp).getTime();
            if (!isNaN(ts)) {
              updateTimestampBounds(result, ts);
              if (prevTimestamp !== null && ts >= prevTimestamp) {
                const deltaMs = Math.min(ts - prevTimestamp, ACTIVE_GAP_CAP_MS);
                activeMs += deltaMs;
                if (deltaMs > 0) {
                  const dayKey = toDayKey(prevTimestamp);
                  activeByDay.set(dayKey, (activeByDay.get(dayKey) || 0) + deltaMs);
                }
              }
              prevTimestamp = ts;
            }
          }
        }

        if (obj.type === 'event_msg' && obj.payload?.type === 'token_count') {
          const usage = obj.payload.info?.total_token_usage;
          if (usage) {
            const inputTokens = usage.input_tokens || 0;
            const cachedInputTokens = usage.cached_input_tokens || 0;
            const outputTokens = usage.output_tokens || 0;
            const reasoningOutputTokens = usage.reasoning_output_tokens || 0;
            const totalTokens = usage.total_tokens || 0;

            result.usage_total = {
              input_tokens: inputTokens,
              cached_input_tokens: cachedInputTokens,
              output_tokens: outputTokens,
              reasoning_output_tokens: reasoningOutputTokens,
              total_tokens: totalTokens,
            };

            const hasReset =
              hasSeenUsage &&
              totalTokens < lastTotalTokens;

            if (hasReset) {
              usageByDay.clear();
              result.usage_reset_detected = true;
              result.first_usage_timestamp = null;
              hasSeenUsage = false;
              lastInputTokens = 0;
              lastCachedInputTokens = 0;
              lastOutputTokens = 0;
              lastReasoningOutputTokens = 0;
              lastTotalTokens = 0;
            }

            const usageDelta = hasSeenUsage
              ? {
                  input_tokens: Math.max(inputTokens - lastInputTokens, 0),
                  cached_input_tokens: Math.max(cachedInputTokens - lastCachedInputTokens, 0),
                  output_tokens: Math.max(outputTokens - lastOutputTokens, 0),
                  reasoning_output_tokens: Math.max(reasoningOutputTokens - lastReasoningOutputTokens, 0),
                  total_tokens: Math.max(totalTokens - lastTotalTokens, 0),
                }
              : {
                  input_tokens: inputTokens,
                  cached_input_tokens: cachedInputTokens,
                  output_tokens: outputTokens,
                  reasoning_output_tokens: reasoningOutputTokens,
                  total_tokens: totalTokens,
                };

            hasSeenUsage = true;
            lastInputTokens = inputTokens;
            lastCachedInputTokens = cachedInputTokens;
            lastOutputTokens = outputTokens;
            lastReasoningOutputTokens = reasoningOutputTokens;
            lastTotalTokens = totalTokens;
            if (ts !== null && hasUsageBoundarySignal(usageDelta)) {
              if (!result.first_usage_timestamp || ts < result.first_usage_timestamp) {
                result.first_usage_timestamp = ts;
              }
              if (hasUsage(usageDelta)) {
                const dayKey = toDayKey(ts);
                mergeUsageTotals(usageByDay, dayKey, usageDelta);
              }
            }
          }
        }

        if (obj.type === 'turn_context' && obj.payload) {
          const p = obj.payload;
          if (p.model && !result.model_name) result.model_name = p.model;
          if (p.effort && !result.reasoning_effort) result.reasoning_effort = p.effort;
          if (p.collaboration_mode?.settings) {
            const s = p.collaboration_mode.settings;
            if (s.model && !result.model_name) result.model_name = s.model;
            if (s.reasoning_effort && !result.reasoning_effort) result.reasoning_effort = s.reasoning_effort;
          }
        }

        if (obj.type === 'session_meta' && obj.payload) {
          if (obj.payload.model && !result.model_name) result.model_name = obj.payload.model;
          if (!result.forked_from_id) result.forked_from_id = obj.payload?.forked_from_id || null;
          if (!result.parent_thread_id) {
            result.parent_thread_id =
              obj.payload?.source?.subagent?.thread_spawn?.parent_thread_id ||
              obj.payload?.forked_from_id ||
              null;
          }
        }
      } catch {
        // malformed line
      }

    }
    if (activeMs > 0) {
      const activeByDaySeconds = Object.fromEntries(
        [...activeByDay.entries()].map(([dayKey, ms]) => [dayKey, Math.round(ms / 1000)])
      );
      result.active_by_day = activeByDaySeconds;
      result.active_seconds = Object.values(activeByDaySeconds).reduce((sum, seconds) => sum + seconds, 0);
    }
    if (usageByDay.size > 0) {
      result.usage_by_day = Object.fromEntries(usageByDay);
    }
  } catch {
    return null;
  }

  return result;
}

export async function readUsageTimeline(rolloutPath, opts = {}) {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return [];
  }

  try {
    const fastScan = opts.fastScan === true;
    const rgScan = opts.rgScan === true;
    const rgMinBytes = Math.max(0, Number(opts.rgMinBytes ?? DEFAULT_RG_MIN_BYTES) || 0);
    let lines = null;
    if (rgScan && shouldUseRipgrep(rolloutPath, rgMinBytes)) {
      lines = await readMatchingLinesWithRipgrep(RG_TOKEN_COUNT_PATTERN, rolloutPath);
    }
    if (!lines) {
      const content = await readFile(rolloutPath, 'utf8');
      lines = content.split(/\r?\n/);
    }
    const timeline = [];
    let segmentId = 0;
    let lastTotalTokens = 0;
    let hasSeenUsage = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (fastScan && !isTokenCountEventLine(line)) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'event_msg' || obj.payload?.type !== 'token_count') continue;
        const usage = obj.payload.info?.total_token_usage;
        if (!usage || !obj.timestamp) continue;
        const ts = new Date(obj.timestamp).getTime();
        if (isNaN(ts)) continue;
        const normalizedUsage = normalizeUsageTotals(usage);
        if (hasSeenUsage && normalizedUsage.total_tokens < lastTotalTokens) {
          segmentId += 1;
        }
        timeline.push({
          timestamp: ts,
          segment_id: segmentId,
          usage: normalizedUsage,
        });
        hasSeenUsage = true;
        lastTotalTokens = normalizedUsage.total_tokens;
      } catch {
        // malformed line
      }
    }
    timeline.sort((left, right) => left.timestamp - right.timestamp);
    return timeline;
  } catch {
    return [];
  }
}

export function findUsageEntryAtOrBefore(timeline, timestampMs) {
  if (!Array.isArray(timeline) || !timeline.length || !timestampMs) return null;
  const orderedTimeline = timeline.every((entry, index) => index === 0 || timeline[index - 1].timestamp <= entry.timestamp)
    ? timeline
    : [...timeline].sort((left, right) => left.timestamp - right.timestamp);
  let best = null;
  for (const entry of orderedTimeline) {
    if ((entry?.timestamp || 0) <= timestampMs) {
      best = entry;
      continue;
    }
    break;
  }
  return best || null;
}

export function findUsageAtOrBefore(timeline, timestampMs) {
  return findUsageEntryAtOrBefore(timeline, timestampMs)?.usage || null;
}

function shouldUseRipgrep(rolloutPath, minBytes) {
  try {
    return statSync(rolloutPath).size >= minBytes;
  } catch {
    return false;
  }
}

async function readRolloutLinesWithRipgrep(rolloutPath) {
  const [relevantLines, timestampMatches] = await Promise.all([
    readMatchingLinesWithRipgrep(RG_RELEVANT_PATTERN, rolloutPath),
    readMatchingLinesWithRipgrep(RG_TIMESTAMP_PATTERN, rolloutPath, ['--only-matching']),
  ]);
  if (!relevantLines || !timestampMatches) return null;
  return { relevantLines, timestampMatches };
}

function readMatchingLinesWithRipgrep(pattern, rolloutPath, extraArgs = []) {
  return new Promise((resolve) => {
    const args = [
      '--no-heading',
      '--no-line-number',
      '--color',
      'never',
      ...extraArgs,
      pattern,
      rolloutPath,
    ];
    const child = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      resolve(stdout ? stdout.split(/\r?\n/).filter(Boolean) : []);
    });
  });
}

function applyTimestampMatches(result, timestampMatches, toDayKey) {
  let prevTimestamp = null;
  let activeMs = 0;
  const activeByDay = new Map();

  for (const line of timestampMatches || []) {
    const ts = extractTimestampMs(line);
    if (ts === null) continue;
    updateTimestampBounds(result, ts);
    if (prevTimestamp !== null && ts >= prevTimestamp) {
      const deltaMs = Math.min(ts - prevTimestamp, ACTIVE_GAP_CAP_MS);
      activeMs += deltaMs;
      if (deltaMs > 0) {
        const dayKey = toDayKey(prevTimestamp);
        activeByDay.set(dayKey, (activeByDay.get(dayKey) || 0) + deltaMs);
      }
    }
    prevTimestamp = ts;
  }

  if (activeMs > 0) {
    const activeByDaySeconds = Object.fromEntries(
      [...activeByDay.entries()].map(([dayKey, ms]) => [dayKey, Math.round(ms / 1000)])
    );
    result.active_by_day = activeByDaySeconds;
    result.active_seconds = Object.values(activeByDaySeconds).reduce((sum, seconds) => sum + seconds, 0);
  }
}

function updateTimestampBounds(result, ts) {
  if (!result.first_timestamp || ts < result.first_timestamp) {
    result.first_timestamp = ts;
  }
  if (!result.last_timestamp || ts > result.last_timestamp) {
    result.last_timestamp = ts;
  }
}

function extractTimestampMs(line) {
  const head = line.length > LINE_HEADER_SCAN_CHARS
    ? line.slice(0, LINE_HEADER_SCAN_CHARS)
    : line;
  const match = TIMESTAMP_RE.exec(head);
  if (!match) return null;
  const ts = Date.parse(match[1]);
  return Number.isNaN(ts) ? null : ts;
}

function isRolloutLineWorthParsing(line) {
  const head = line.length > LINE_HEADER_SCAN_CHARS
    ? line.slice(0, LINE_HEADER_SCAN_CHARS)
    : line;
  return head.includes('"type":"token_count"') ||
    head.includes('"type":"turn_context"') ||
    head.includes('"type":"session_meta"');
}

function isTokenCountEventLine(line) {
  const head = line.length > LINE_HEADER_SCAN_CHARS
    ? line.slice(0, LINE_HEADER_SCAN_CHARS)
    : line;
  return head.includes('"type":"token_count"');
}

function normalizeUsageTotals(usage) {
  return {
    input_tokens: usage.input_tokens || 0,
    cached_input_tokens: usage.cached_input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    reasoning_output_tokens: usage.reasoning_output_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function splitUsageTotals(usage) {
  const normalized = normalizeUsageTotals(usage || {});
  const cachedInputTokens = Math.min(normalized.cached_input_tokens, normalized.input_tokens);
  return {
    uncached_input_tokens: Math.max(normalized.input_tokens - cachedInputTokens, 0),
    cached_input_tokens: cachedInputTokens,
    output_tokens: normalized.output_tokens,
    reasoning_output_tokens: normalized.reasoning_output_tokens,
  };
}

function combineUsageTotals(parts, currentTotalTokens = 0, previousTotalTokens = 0) {
  const inputTokens = (parts.uncached_input_tokens || 0) + (parts.cached_input_tokens || 0);
  const outputTokens = parts.output_tokens || 0;
  return {
    input_tokens: inputTokens,
    cached_input_tokens: parts.cached_input_tokens || 0,
    output_tokens: outputTokens,
    reasoning_output_tokens: parts.reasoning_output_tokens || 0,
    total_tokens: Math.max(inputTokens + outputTokens, Math.max(currentTotalTokens - previousTotalTokens, 0)),
  };
}

export function subtractUsageTotals(current, previous) {
  const currentParts = splitUsageTotals(current);
  const previousParts = splitUsageTotals(previous);
  return combineUsageTotals({
    uncached_input_tokens: Math.max(currentParts.uncached_input_tokens - previousParts.uncached_input_tokens, 0),
    cached_input_tokens: Math.max(currentParts.cached_input_tokens - previousParts.cached_input_tokens, 0),
    output_tokens: Math.max(currentParts.output_tokens - previousParts.output_tokens, 0),
    reasoning_output_tokens: Math.max(currentParts.reasoning_output_tokens - previousParts.reasoning_output_tokens, 0),
  }, current?.total_tokens || 0, previous?.total_tokens || 0);
}

export function hasUsageTotals(usage) {
  return !!usage && (
    (usage.input_tokens || 0) > 0 ||
    (usage.cached_input_tokens || 0) > 0 ||
    (usage.output_tokens || 0) > 0 ||
    (usage.reasoning_output_tokens || 0) > 0 ||
    (usage.total_tokens || 0) > 0
  );
}

function hasUsage(usage) {
  return !!usage && (
    usage.input_tokens > 0 ||
    usage.cached_input_tokens > 0 ||
    usage.output_tokens > 0
  );
}

function hasUsageBoundarySignal(usage) {
  return hasUsage(usage) || (usage?.reasoning_output_tokens || 0) > 0 || (usage?.total_tokens || 0) > 0;
}

function mergeUsageTotals(target, dayKey, usage) {
  let previous = target.get(dayKey);
  if (!previous) {
    previous = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
    target.set(dayKey, previous);
  }
  previous.input_tokens += usage.input_tokens || 0;
  previous.cached_input_tokens += usage.cached_input_tokens || 0;
  previous.output_tokens += usage.output_tokens || 0;
}
