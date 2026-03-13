#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import os from 'os';
import { createServer } from '../server/index.js';

program
  .name('codexmeter')
  .description('Local telemetry dashboard for Codex CLI usage')
  .option('--codex-home <path>', 'Path to .codex directory', path.join(os.homedir(), '.codex'))
  .option('--port <n>', 'Port number', '0')
  .option('--no-open', 'Do not open browser automatically')
  .option('--from <date>', 'Start date filter (YYYY-MM-DD)')
  .option('--to <date>', 'End date filter (YYYY-MM-DD)')
  .option('--repo <substring>', 'Filter by repo name substring')
  .option('--agent-family <family>', 'Filter by agent family')
  .parse();

const opts = program.opts();

const app = createServer(opts.codexHome, {
  from: opts.from,
  to: opts.to,
  repo: opts.repo,
  agentFamily: opts.agentFamily,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

const port = parseInt(opts.port, 10) || 0;

const server = app.listen(port, '127.0.0.1', async () => {
  const addr = server.address();
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
