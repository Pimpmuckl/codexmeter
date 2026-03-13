# Findings

- Current ingest UX is snapshot-based: `src/App.jsx` polls `api.progress()` every `1200ms` and, once progress passes `10%`, refetches all dashboard endpoints together.
- Current backend partial updates are coarse: `server/ingest.js` rebuilds partial aggregates only every `partialRebuildEvery` sessions, default `250`, after materialization.
- Current frontend charts rebuild complete ECharts options from aggregate arrays rather than maintaining a keyed incremental live store.
- ECharts defaults are already customized for shorter animation durations in `src/utils/echartsDefaults.js`, but that cannot produce true smooth motion when target states only change every ~1s.
- `Overview`, `Repos`, and `Models` bar charts already pin `xAxis.max` to current top value and hide boundary split lines; that behavior should be preserved in the live path.
- `Overview` already animates counters with `requestAnimationFrame` through `src/hooks/useCountUp.js`, which is useful as a pattern but too shallow because upstream data still arrives as coarse snapshots.
- Dev mode now correctly separates frontend and backend: Vite serves the UI and proxies `/api`, backend is API-only in dev.
- `review_plan` feedback confirmed the main architectural risk: SSE is only useful if it rides on one canonical live accumulator rather than layering on top of the old partial-rebuild cadence.
- `review_plan` also surfaced that reconnect semantics need explicit `ingest_id` and monotonic `seq`; that is now part of the live contract.
- Live SSE smoke test showed the transport works, but current patch payloads are still heavy because changed repo/model entries include nested breakdown objects. That may still limit smoothness even with higher-frequency updates.
