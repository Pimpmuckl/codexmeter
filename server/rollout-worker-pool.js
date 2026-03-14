import os from 'os';
import { Worker } from 'worker_threads';

export function createRolloutWorkerPool(opts = {}) {
  const size = normalizePoolSize(opts.size);
  if (size <= 1) {
    return createInlinePool();
  }

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

  async function mapRollouts(rolloutPaths, timezone) {
    return Promise.all(rolloutPaths.map((rolloutPath) => runTask(rolloutPath, timezone)));
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

  return { mapRollouts, close, size };
}

function createInlinePool() {
  return {
    size: 1,
    async mapRollouts(rolloutPaths, timezone) {
      const { enrichFromRollout } = await import('./rollout-reader.js');
      return Promise.all(
        rolloutPaths.map(async (rolloutPath) => {
          try {
            const data = await enrichFromRollout(rolloutPath, { timezone });
            return { ok: true, data, error: null };
          } catch (error) {
            return {
              ok: false,
              data: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );
    },
    async close() {},
  };
}

function normalizePoolSize(size) {
  if (size != null) {
    return Math.max(1, Number(size) || 1);
  }

  const cpuCount = os.cpus()?.length || 4;
  return Math.max(2, Math.min(cpuCount - 1, 8));
}
