# Progress

## 2026-03-14

- Started planning-with-files workflow for startup-only live ingest animation work.
- Confirmed current architecture bottleneck:
  - `App.jsx` polls every `1200ms`
  - backend partial aggregate rebuilds are coarse
  - ECharts receives whole option rebuilds instead of keyed incremental updates
- Locked approach:
  - SSE transport with polling fallback
  - ECharts retained for v1
  - Overview is the priority live surface
- `review_plan` completed and the valid feedback was incorporated:
  - use one canonical live accumulator
  - add `ingest_id` and `seq`
  - avoid parallel merge confusion between SSE and fallback polling
- Implemented:
  - backend live aggregate accumulator and `/api/live` SSE stream
  - client live-state merge path in `App.jsx`
  - smoother counter interpolation and slower ECharts update timing
  - top-right icon-only rerun button wired to `POST /api/rerun`
  - backend rerun safety via `run_token` invalidation and fresh SSE bootstrap
- Validated:
  - `npm run build` passes
  - `/api/live` streams `bootstrap` and `patch` events during ingest
  - Vite `/api/progress` still returns `200` through the dev proxy
  - `/api/rerun` returns `202` with a new `ingest_id`
- Next:
  - payload slimming and cadence shaping are now in progress for phase 2
  - next likely bottleneck is ECharts render cost rather than transport size
