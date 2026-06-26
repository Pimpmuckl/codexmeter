import os from 'os';
import { Worker } from 'worker_threads';

export function createRolloutWorkerPool(opts = {}) {
  const size = normalizePoolSize();
  const readerOptions = opts.readerOptions || {};

  const workers = new Set();
  const idleWorkers = [];
  const inflight = new Map();
  const queuedTasks = [];
  let nextId = 1;
  let closed = false;

  const spawnWorker = () => {
    const worker = new Worker(new URL('./rollout-worker.js', import.meta.url), {
      type: 'module',
      execArgv: [],
    });

    worker.on('message', (message) => {
      const task = inflight.get(message?.id);
      if (!task) return;
      inflight.delete(message.id);
      if (!closed) idleWorkers.push(worker);
      drainQueue();
      if (message?.ok === false) {
        task.resolve({ ok: false, data: null, error: message?.error || 'Unknown worker error' });
      } else {
        task.resolve({ ok: true, data: message?.data ?? null, error: null });
      }
    });

    worker.on('error', (error) => {
      failWorker(worker, error);
    });

    worker.on('exit', (code) => {
      if (closed) return;
      if (code !== 0) {
        failWorker(worker, new Error(`Worker exited with code ${code}`));
      } else {
        removeWorker(worker);
      }
    });

    workers.add(worker);
    idleWorkers.push(worker);
  };

  for (let i = 0; i < size; i += 1) {
    spawnWorker();
  }

  function removeWorker(worker) {
    workers.delete(worker);
    const idleIndex = idleWorkers.indexOf(worker);
    if (idleIndex >= 0) idleWorkers.splice(idleIndex, 1);
  }

  function failWorker(worker, error) {
    removeWorker(worker);

    for (const [id, task] of inflight.entries()) {
      if (task.worker !== worker) continue;
      inflight.delete(id);
      task.resolve({
        ok: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!closed) {
      spawnWorker();
      drainQueue();
    }
  }

  function drainQueue() {
    while (!closed && idleWorkers.length > 0 && queuedTasks.length > 0) {
      const worker = idleWorkers.pop();
      const task = queuedTasks.shift();
      const id = nextId++;
      inflight.set(id, { worker, resolve: task.resolve });
      worker.postMessage({
        id,
        rolloutPath: task.rolloutPath,
        timezone: task.timezone,
        readerOptions,
      });
    }
  }

  function runTask(rolloutPath, timezone) {
    if (closed) {
      return Promise.resolve({ ok: false, data: null, error: 'Worker pool is closed' });
    }
    return new Promise((resolve) => {
      queuedTasks.push({ rolloutPath, timezone, resolve });
      drainQueue();
    });
  }

  async function mapRolloutsInChunks(rolloutPaths, timezone, { chunkSize = 100, onChunk } = {}) {
    const results = new Array(rolloutPaths.length);
    const completed = new Array(rolloutPaths.length).fill(false);
    const safeChunkSize = Math.max(1, Number(chunkSize) || 1);
    const maxInFlight = Math.max(safeChunkSize, size * 4);
    let nextStartIndex = 0;
    let nextFlushIndex = 0;
    let activeCount = 0;
    let completedCount = 0;
    let flushChain = Promise.resolve();
    let rejected = false;

    const scheduleFlush = (force = false) => {
      if (typeof onChunk !== 'function') return;
      const chunk = [];
      while (nextFlushIndex < results.length && completed[nextFlushIndex]) {
        chunk.push({ index: nextFlushIndex, result: results[nextFlushIndex] });
        nextFlushIndex += 1;
        if (!force && chunk.length >= safeChunkSize) break;
      }
      if (!chunk.length) return;
      flushChain = flushChain.then(() => onChunk(chunk));
    };

    await new Promise((resolve, reject) => {
      const launchNext = () => {
        if (rejected) return;
        while (activeCount < maxInFlight && nextStartIndex < rolloutPaths.length) {
          const index = nextStartIndex;
          const rolloutPath = rolloutPaths[index];
          nextStartIndex += 1;
          activeCount += 1;
          runTask(rolloutPath, timezone)
            .then((result) => {
              results[index] = result;
              completed[index] = true;
              completedCount += 1;
              activeCount -= 1;
              scheduleFlush(false);
              if (completedCount >= rolloutPaths.length && activeCount === 0) {
                resolve();
                return;
              }
              launchNext();
            })
            .catch((error) => {
              rejected = true;
              reject(error);
            });
        }

        if (completedCount >= rolloutPaths.length && activeCount === 0) {
          resolve();
        }
      };

      launchNext();
    });

    scheduleFlush(true);
    await flushChain;
    return results;
  }

  async function close() {
    closed = true;
    while (queuedTasks.length > 0) {
      const task = queuedTasks.shift();
      task.resolve({ ok: false, data: null, error: 'Worker pool closed before task started' });
    }
    for (const [, task] of inflight.entries()) {
      task.resolve({ ok: false, data: null, error: 'Worker pool closed before task finished' });
    }
    inflight.clear();
    await Promise.allSettled([...workers].map((worker) => worker.terminate()));
    workers.clear();
    idleWorkers.length = 0;
  }

  return { mapRolloutsInChunks, close, size };
}

function normalizePoolSize() {
  const cpuCount = os.cpus()?.length || 4;
  return Math.max(2, Math.min(cpuCount - 1, 8));
}
