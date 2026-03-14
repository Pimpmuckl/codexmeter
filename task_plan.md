# Task Plan

## Task
Optimize ingest throughput aggressively, with emphasis on the late-ingest slowdown. Keep the new live SSE path, but remove backend work that scales poorly as more sessions are materialized.

## Decisions Locked
- Scope is startup ingest only, not continuous live watch.
- Keep ECharts for v1.
- Use SSE with polling fallback.
- REST endpoints remain the final settled-data source of truth.
- Sessions tab is not in the 60fps-critical path for v1.

## Phases
1. Profile and identify the late-run hotspots
   - Confirm which ingest steps scale with total sessions seen so far.
   - Distinguish rollout parsing from cumulative bookkeeping cost.
2. Remove avoidable cumulative work
   - Replace full-session root resolution per batch with incremental root tracking.
   - Slim live-state accumulation to only fields required for live Overview transport.
   - Avoid expensive full-map work in live patch generation where possible.
3. Validate on real `.codex` data
   - Re-run ingest/build validations.
   - Compare later-batch behavior against current baseline qualitatively and with targeted timing evidence.
4. Worker-thread rollout enrichment
   - Keep main-thread ingest orchestration/live SSE state unchanged.
   - Move rollout enrichment into a bounded worker pool with a tiny job/result contract.
   - Preserve final aggregate semantics and rerun safety.
5. Review and checkpoint
   - Run review on the optimization pass.
   - Leave the codebase in a clean, testable state.
6. Final tuning and exit
   - Benchmark pool-size/batch-size/root-refresh combinations.
   - Lock the best proven defaults instead of leaving guessed values.

## Risks / Watchpoints
- Incremental root tracking must remain correct when parent threads appear later in ingest order.
- Live-state slimming must not break final settled REST aggregates or the Overview live surface.
- The existing uncommitted tweak in `src/utils/echartsDefaults.js` is not part of this optimization pass unless needed.
- Worker pool lifecycle must stay scoped to `runIngest(...)` so reruns cannot leak stale results.
- The worker contract should stay tiny: `rolloutPath` + `timezone` in, compact enrichment payload out.

## Exit Criteria
- Later ingest batches no longer degrade sharply from cumulative bookkeeping work.
- Live SSE remains functional and Overview still updates during ingest.
- Final post-ingest data matches the settled aggregate behavior.
- `npm run build` passes and the worker-thread enrichment path clearly improves ingest throughput.
- No remaining obvious backend-only optimization idea is left unmeasured or untried.
