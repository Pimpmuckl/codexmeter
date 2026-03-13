# Task Plan

## Task
Implement startup-only live ingest updates using SSE while keeping ECharts as the renderer. Target smooth visible chart and counter motion during ingest without replacing the existing settled-data REST/dashboard path.

## Decisions Locked
- Scope is startup ingest only, not continuous live watch.
- Keep ECharts for v1.
- Use SSE with polling fallback.
- REST endpoints remain the final settled-data source of truth.
- Sessions tab is not in the 60fps-critical path for v1.

## Phases
1. Baseline and transport scaffolding
   - Add SSE endpoint and backend subscriber plumbing.
   - Add normalized live aggregate state and coalesced patch emission.
   - Keep existing REST endpoints untouched for settled mode.
2. Frontend live state path
   - Add SSE client, live store, fallback path, and ingest-only live mode in `App`.
   - Merge keyed patches into canonical state without refetching whole snapshots every tick.
3. ECharts incremental updates
   - Update Overview first to use stable chart instances and incremental option updates.
   - Keep axis max pinned to top visible value and preserve current chart styling.
   - Extend same live-state consumption pattern to visible Repos/Models/Daily surfaces as feasible without destabilizing v1.
4. Validation and review
   - Build, run a real ingest smoke test, verify SSE cadence and chart smoothness.
   - Run required review loops after implementation slices.

## Risks / Watchpoints
- Excessive React rerenders if live patches update app-wide object identity too often.
- ECharts merge behavior can regress labels or cause stale series if ids are not stable.
- Backend patch generation can become too expensive if it rebuilds large sorted arrays on each session.
- Overview must not lose the currently restored chart styling.

## Exit Criteria
- During ingest, visible Overview counters and charts update continuously from SSE.
- Backend no longer requires full `fetchAll()` polling every ~1s to show progress.
- Final post-ingest state matches existing REST aggregates.
- If ECharts is still visibly choppy after this architecture, we have enough evidence to blame the renderer rather than transport/state flow.
