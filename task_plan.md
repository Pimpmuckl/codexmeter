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
4. Review and checkpoint
   - Run review on the optimization pass.
   - Leave the codebase in a clean, testable state before any worker-thread follow-up.

## Risks / Watchpoints
- Incremental root tracking must remain correct when parent threads appear later in ingest order.
- Live-state slimming must not break final settled REST aggregates or the Overview live surface.
- The existing uncommitted tweak in `src/utils/echartsDefaults.js` is not part of this optimization pass unless needed.
- If the real bottleneck is rollout parsing itself, we should stop after proving that and move to worker threads separately.

## Exit Criteria
- Later ingest batches no longer degrade sharply from cumulative bookkeeping work.
- Live SSE remains functional and Overview still updates during ingest.
- Final post-ingest data matches the settled aggregate behavior.
- `npm run build` passes and the optimization is ready for a worker-thread follow-up, not entangled with it.
