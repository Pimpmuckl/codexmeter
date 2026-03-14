import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { createDayKeyFormatter } from './day-key.js';

const ACTIVE_GAP_CAP_MS = 15 * 60 * 1000;

export async function enrichFromRollout(rolloutPath, opts = {}) {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return null;
  }

  const tz = opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toDayKey = opts.toDayKey || createDayKeyFormatter(tz);
  const result = {
    model_name: null,
    reasoning_effort: null,
    first_timestamp: null,
    last_timestamp: null,
    active_seconds: null,
    active_by_day: null,
    parent_thread_id: null,
    usage_total: null,
  };

  try {
    const content = await readFile(rolloutPath, 'utf8');

    let prevTimestamp = null;
    let activeMs = 0;
    const activeByDay = new Map();
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);

        if (obj.timestamp) {
          const ts = new Date(obj.timestamp).getTime();
          if (!isNaN(ts)) {
            if (!result.first_timestamp || ts < result.first_timestamp) {
              result.first_timestamp = ts;
            }
            if (!result.last_timestamp || ts > result.last_timestamp) {
              result.last_timestamp = ts;
            }
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

        if (obj.type === 'event_msg' && obj.payload?.type === 'token_count') {
          const usage = obj.payload.info?.total_token_usage;
          if (usage) {
            result.usage_total = {
              input_tokens: usage.input_tokens || 0,
              cached_input_tokens: usage.cached_input_tokens || 0,
              output_tokens: usage.output_tokens || 0,
              reasoning_output_tokens: usage.reasoning_output_tokens || 0,
              total_tokens: usage.total_tokens || 0,
            };
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
  } catch {
    return null;
  }

  return result;
}
