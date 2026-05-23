import { parentPort } from 'worker_threads';
import { enrichFromRollout } from './rollout-reader.js';

if (!parentPort) {
  throw new Error('rollout-worker requires a parentPort');
}

parentPort.on('message', async (message) => {
  const { id, rolloutPath, timezone, readerOptions } = message || {};

  try {
    const result = await enrichFromRollout(rolloutPath, { timezone, ...(readerOptions || {}) });
    parentPort.postMessage({ id, ok: true, data: result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
