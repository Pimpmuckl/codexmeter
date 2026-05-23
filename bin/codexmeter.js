#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import os from 'os';
import { createServer } from '../server/index.js';

const defaultCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

function parseBooleanEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumberEnv(name, defaultValue = undefined) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

program
  .name('codexmeter')
  .description('Local telemetry dashboard for Codex CLI usage')
  .option('--codex-home <path>', 'Path to .codex directory', defaultCodexHome)
  .option('--port <n>', 'Port number', '0')
  .option('--no-open', 'Do not open browser automatically')
  .option('--from <date>', 'Start date filter (YYYY-MM-DD)')
  .option('--to <date>', 'End date filter (YYYY-MM-DD)')
  .option('--repo <substring>', 'Filter by repo name substring')
  .option('--agent-family <family>', 'Filter by agent family')
  .parse();

const opts = program.opts();

const ingestToggles = {
  ingestTiming: parseBooleanEnv('CODEXMETER_INGEST_TIMING'),
  workerThreads: parseNumberEnv('CODEXMETER_WORKER_THREADS'),
  batchSize: parseNumberEnv('CODEXMETER_BATCH_SIZE'),
  fastRolloutReader: parseBooleanEnv('CODEXMETER_FAST_ROLLOUT_READER'),
  rgRolloutReader: parseBooleanEnv('CODEXMETER_RG_ROLLOUT_READER', true),
  rgMinBytes: parseNumberEnv('CODEXMETER_RG_MIN_BYTES'),
  streamRolloutChunks: parseBooleanEnv('CODEXMETER_STREAM_ROLLOUT_CHUNKS', true),
  forkCorrectionConcurrency: parseNumberEnv('CODEXMETER_FORK_CORRECTION_CONCURRENCY', 32),
  resultChunkSize: parseNumberEnv('CODEXMETER_RESULT_CHUNK_SIZE'),
  recentFirstDays: parseNumberEnv('CODEXMETER_RECENT_FIRST_DAYS'),
  warmupOldestCount: parseNumberEnv('CODEXMETER_WARMUP_OLDEST_COUNT'),
};

const activeIngestToggles = Object.entries(ingestToggles)
  .filter(([, value]) => value !== false && value !== undefined);
if (activeIngestToggles.length) {
  const label = activeIngestToggles
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  console.log(`codexmeter ingest toggles: ${label}`);
}

const app = createServer(opts.codexHome, {
  from: opts.from,
  to: opts.to,
  repo: opts.repo,
  agentFamily: opts.agentFamily,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  devApiOnly: process.env.CODEXMETER_DEV_API_ONLY === '1',
  frontendBaseUrl: process.env.CODEXMETER_FRONTEND_URL || null,
  ...ingestToggles,
});

const port = parseInt(opts.port, 10) || 0;

const server = app.listen(port, '127.0.0.1');

server.once('error', (err) => {
  console.error(`Failed to start codexmeter on 127.0.0.1:${port || 'auto'}: ${err.message}`);
  process.exit(1);
});

server.once('listening', async () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    console.error('Failed to resolve codexmeter listen address.');
    process.exit(1);
  }
  const url = `http://127.0.0.1:${addr.port}`;
  console.log(`\n  codexmeter → ${url}\n`);

  if (opts.open !== false) {
    try {
      const open = (await import('open')).default;
      await open(url);
    } catch {
      // ignore if browser open fails
    }
  }
});
