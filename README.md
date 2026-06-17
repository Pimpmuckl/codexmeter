# CodexMeter

A local telemetry dashboard for [Codex](https://openai.com/codex) CLI and App usage. Zero config, snapshot-based, reads your `.codex` state and serves a polished browser UI.

## Quick Start

```bash
npx codexmeter@latest
```

That’s it. A local URL is printed; Ctrl+click to open. The dashboard ingests your Codex sessions and shows tokens, cost, repos, models, and daily usage.

## Usage

```bash
# Default: auto port, open browser, read $CODEX_HOME or ~/.codex
npx codexmeter@latest

# Custom Codex home
npx codexmeter@latest --codex-home /path/to/.codex

# Specific port, no auto-open
npx codexmeter@latest --port 3456 --no-open

# Filter by date range
npx codexmeter@latest --from 2026-01-01 --to 2026-03-13

# Filter by repo or agent family
npx codexmeter@latest --repo my-project --agent-family review
```

## Features

- **Overview** — Total tokens, cost, sessions, active repos and models, coverage
- **Repos** — Token and cost per repo, model split, agent-family toggle
- **Models** — Token and cost per model, thinking-level breakdown
- **Daily Usage** — Tokens, wall-clock time, and cost per day, stacked by model
- **Sessions** — Searchable table with repo, model, role, duration, tokens
- **Export** — PNG chart export and Overview ingest video clips

Data is read from `state_5.sqlite`, `logs_1.sqlite`, and rollout JSONL under `.codex`. No separate cache DB; ingestion runs on each launch.

## Requirements

- Node.js 22.13+
- A `.codex` directory (from Codex CLI usage)
- Chrome, Chromium, or Edge for video export, or let CodexMeter download a single-use portable browser from the UI

## Development

```bash
npm install
npm run dev      # Vite dev server (frontend only)
npm run build    # Build frontend
npm run start    # Run full server (ingest + serve)
npm run preview  # Build + run (production-like)
```

## License

MIT
