# AI Context — TransitTrack

## Architecture
- **Monorepo**: `apps/web` (Vite + React + Tailwind) + `apps/worker` (Cloudflare Workers + D1 + R2 Data Catalog)
- **Data flow**: GTFS-RT feeds → Cloudflare Queue → Worker parses → dual-write to **D1** (hot cache, 8GB limit) and **R2 Data Catalog** (Iceberg/Parquet, permanent archive)
- **D1 tables**: `vp_points` (vehicle positions), `tu_stop_time_updates` (trip updates), `gtfs_routes/stops/stop_times/trips` (static GTFS)

## Key Design Decisions
1. **Stop ordering from live data**: `gtfs_stop_times` is nearly empty for most routes. Instead of trusting `current_stop_sequence` (trip-local, non-unique across patterns), we infer canonical stop order via **topological sort** of observed vehicle trajectories (`inferStopOrder` in `analysis.ts`).
2. **Stringline chart modes**: Route stringlines support 3 views — Outbound (`direction_id=0`), Inbound (`direction_id=1`), Combined (`all`). Combined fetches all directions and renders the same vehicle's trips as one continuous line.
3. **SVG sizing**: D3 stringline uses explicit pixel `width`/`height` on the SVG element (not `viewBox` + `height:auto`), sized by a `ResizeObserver` on the container. `viewBox` causes unwanted aspect-ratio scaling.
4. **Vehicle stringlines**: Separate endpoint `/analysis/vehicles/:id/stringline` returns all points for a single vehicle across all routes/directions, with stop order inferred from that vehicle's data.
5. **GTFS static fallback**: Static queries intentionally ignore `gtfs_version_id` (use `GROUP BY` + `MIN()` on latest) because version mismatches are common.

## Pitfalls Learned
- D1 SQLite `ORDER BY current_stop_sequence` breaks when multiple trip patterns share the same route (local/express/short-turn all start at seq=1). Tie-breaking is arbitrary → scrambled stop order.
- Vehicles frequently do round trips, so filtering by `direction_id` alone doesn't isolate "inbound vs outbound" behavior. The same `vehicle_id` appears in both directions.
- `ResizeObserver` may not fire on initial mount in all browsers; always seed with `getBoundingClientRect()`.
- Worker `npm run build` doesn't exist; use `npx tsc -b` for type-checking.

## File Reference
- `apps/worker/src/routes/analysis.ts` — stringline, stops, vehicles endpoints
- `apps/web/src/components/StringlineChart.tsx` — D3 chart
- `apps/web/src/components/AnalysisPanel.tsx` — route/vehicle/stats tabs
- `apps/web/src/types.ts` — shared interfaces (`StringlineData`, `RouteStop`)
