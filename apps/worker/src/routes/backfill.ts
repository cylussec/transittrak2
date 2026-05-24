import type { Api } from './types'

const BATCH_SIZE = 5000;
const PIPELINE_CHUNK = 1000; // Pipeline max records per send

export function registerBackfillRoutes(api: Api) {
  // GET status of D1 tables (row counts)
  api.get('/backfill/status', async (c) => {
    if (!c.env.DB) return c.json({ ok: false, error: 'DB not configured' }, 500);

    const [vp, tu] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as cnt FROM vp_points').first<{ cnt: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as cnt FROM tu_stop_time_updates').first<{ cnt: number }>(),
    ]);

    return c.json({
      ok: true,
      vp_points: vp?.cnt ?? 0,
      tu_stop_time_updates: tu?.cnt ?? 0,
    });
  });

  // POST to backfill vp_points from D1 → VP Pipeline
  api.post('/backfill/vp', async (c) => {
    if (!c.env.DB || !c.env.VP_PIPELINE) {
      return c.json({ ok: false, error: 'DB or VP_PIPELINE not configured' }, 500);
    }

    let totalSent = 0;
    let lastRowid = 0;

    try {
      while (true) {
        const rows = await c.env.DB.prepare(
          `SELECT rowid, agency_id, ts_ms, vehicle_id, trip_id, route_id, direction_id, stop_id, lat, lon, bearing, speed, current_status, current_stop_sequence, gtfs_version_id
           FROM vp_points WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`
        ).bind(lastRowid, BATCH_SIZE).all();

        if (!rows.results || rows.results.length === 0) break;

        // Send in chunks to Pipeline
        for (let i = 0; i < rows.results.length; i += PIPELINE_CHUNK) {
          const chunk = rows.results.slice(i, i + PIPELINE_CHUNK);
          const records = chunk.map((r: Record<string, unknown>) => ({
            agency_id: r.agency_id,
            ts_ms: r.ts_ms,
            vehicle_id: r.vehicle_id,
            trip_id: r.trip_id,
            route_id: r.route_id,
            direction_id: r.direction_id,
            stop_id: r.stop_id,
            lat: r.lat,
            lon: r.lon,
            bearing: r.bearing,
            speed: r.speed,
            current_status: r.current_status,
            current_stop_sequence: r.current_stop_sequence,
            gtfs_version_id: r.gtfs_version_id,
          }));
          await c.env.VP_PIPELINE.send(records);
        }

        totalSent += rows.results.length;
        lastRowid = rows.results[rows.results.length - 1].rowid as number;

        // Yield between batches
        await new Promise(resolve => setTimeout(resolve, 10));

        // Workers have a 30s CPU time limit; cap at 500k per request
        if (totalSent >= 500_000) {
          return c.json({
            ok: true,
            sent: totalSent,
            last_rowid: lastRowid,
            done: false,
            message: `Sent ${totalSent} rows. Call again to continue.`,
          });
        }
      }
    } catch (error) {
      return c.json({
        ok: false,
        sent: totalSent,
        last_rowid: lastRowid,
        error: String(error),
      }, 500);
    }

    return c.json({ ok: true, sent: totalSent, done: true });
  });

  // POST to backfill tu_stop_time_updates from D1 → TU Pipeline
  api.post('/backfill/tu', async (c) => {
    if (!c.env.DB || !c.env.TU_PIPELINE) {
      return c.json({ ok: false, error: 'DB or TU_PIPELINE not configured' }, 500);
    }

    let totalSent = 0;
    let lastRowid = 0;

    try {
      while (true) {
        const rows = await c.env.DB.prepare(
          `SELECT rowid, agency_id, ts_ms, trip_id, route_id, stop_id, stop_sequence, arrival_time_ms, departure_time_ms, schedule_relationship, gtfs_version_id
           FROM tu_stop_time_updates WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`
        ).bind(lastRowid, BATCH_SIZE).all();

        if (!rows.results || rows.results.length === 0) break;

        for (let i = 0; i < rows.results.length; i += PIPELINE_CHUNK) {
          const chunk = rows.results.slice(i, i + PIPELINE_CHUNK);
          const records = chunk.map((r: Record<string, unknown>) => ({
            agency_id: r.agency_id,
            ts_ms: r.ts_ms,
            trip_id: r.trip_id,
            route_id: r.route_id,
            stop_id: r.stop_id,
            stop_sequence: r.stop_sequence,
            arrival_time_ms: r.arrival_time_ms,
            departure_time_ms: r.departure_time_ms,
            schedule_relationship: r.schedule_relationship,
            gtfs_version_id: r.gtfs_version_id,
          }));
          await c.env.TU_PIPELINE.send(records);
        }

        totalSent += rows.results.length;
        lastRowid = rows.results[rows.results.length - 1].rowid as number;

        await new Promise(resolve => setTimeout(resolve, 10));

        if (totalSent >= 500_000) {
          return c.json({
            ok: true,
            sent: totalSent,
            last_rowid: lastRowid,
            done: false,
            message: `Sent ${totalSent} rows. Call again to continue.`,
          });
        }
      }
    } catch (error) {
      return c.json({
        ok: false,
        sent: totalSent,
        last_rowid: lastRowid,
        error: String(error),
      }, 500);
    }

    return c.json({ ok: true, sent: totalSent, done: true });
  });
}
