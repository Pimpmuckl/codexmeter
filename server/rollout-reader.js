import { createReadStream, existsSync } from 'fs';
import { createInterface } from 'readline';

export async function enrichFromRollout(rolloutPath) {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return null;
  }

  const result = {
    model_name: null,
    reasoning_effort: null,
    first_timestamp: null,
    last_timestamp: null,
  };

  try {
    const rl = createInterface({
      input: createReadStream(rolloutPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    let linesRead = 0;
    for await (const line of rl) {
      linesRead++;
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
        }
      } catch {
        // malformed line
      }

      // Read up to 150 lines for model/effort, but continue for timestamps
      if (linesRead > 150 && result.model_name && result.reasoning_effort) break;
    }
  } catch {
    return null;
  }

  return result;
}
