import type { Api } from './types';
import { scheduledArrivalMs, utcMsToLocalDate } from '../gtfs-rt/schedule-time';

const BATCH_SIZE = 2000;

export function registerAdminRoutes(api: Api) {
  /**
   * POST /api/admin/backfill-delays
   *
   * Walks tu_stop_time_updates in ts_ms order, joins to gtfs_stop_times to
   * compute delay_seconds, and writes it back. Resumable via ?start_ms.
   *
   * Query params:
   *   agency_id   (required)
   *   start_ms    (optional, default 0) — resume cursor
   *   end_ms      (optional, default now)
   *   dry_run     (optional, "true") — count only, no writes
   *
   * Auth: X-Admin-Token header must match env.ADMIN_TOKEN.
   */
  api.post('/admin/backfill-delays', async (c) => {
    const token = c.req.header('X-Admin-Token');
    if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }
    if (!c.env.DB) return c.json({ ok: false, error: 'DB not configured' }, 500);

    const agencyId = c.req.query('agency_id');
    if (!agencyId) return c.json({ ok: false, error: 'agency_id required' }, 400);

    const startMs = Number(c.req.query('start_ms') ?? '0');
    const endMs = Number(c.req.query('end_ms') ?? String(Date.now()));
    const dryRun = c.req.query('dry_run') === 'true';

    const db = c.env.DB;

    const agencyRow = await db.prepare(
      'SELECT timezone FROM agencies WHERE agency_id = ?'
    ).bind(agencyId).first<{ timezone: string }>();
    if (!agencyRow) return c.json({ ok: false, error: 'Agency not found' }, 404);
    const tz = agencyRow.timezone;

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let lastTsMs = startMs;

    // Process up to ~50k rows per request to stay inside Worker CPU budget.
    const maxRows = 50_000;

    while (processed < maxRows) {
      // Query by time range (leverages the idx_tu_updates_agency_route_ts index).
      // We do NOT filter delay_seconds IS NULL here — on a 10GB table that forces a
      // full table scan and times out. Instead we skip already-filled rows in JS.
      const rows = await db.prepare(
        `SELECT rowid, ts_ms, trip_id, stop_sequence, arrival_time_ms, gtfs_version_id, start_date, delay_seconds
         FROM tu_stop_time_updates
         WHERE agency_id = ? AND ts_ms >= ? AND ts_ms < ?
         ORDER BY ts_ms ASC
         LIMIT ?`
      ).bind(agencyId, lastTsMs, endMs, BATCH_SIZE).all<{
        rowid: number;
        ts_ms: number;
        trip_id: string;
        stop_sequence: number | null;
        arrival_time_ms: number | null;
        gtfs_version_id: string;
        start_date: string | null;
        delay_seconds: number | null;
      }>();

      const batchAll = rows.results ?? [];
      if (batchAll.length === 0) break;

      // Skip rows that already have delay_seconds computed.
      const batch = batchAll.filter(r => r.delay_seconds === null);
      if (batch.length === 0) {
        // None in this window need work — advance cursor past them.
        lastTsMs = batchAll[batchAll.length - 1].ts_ms + 1;
        processed += batchAll.length;
        continue;
      }

      // Bulk-fetch all unique trip_ids in this batch from gtfs_stop_times.
      const distinctTripIds = [...new Set(batch.map(r => r.trip_id))];
      const placeholders = distinctTripIds.map(() => '?').join(',');

      // We may have multiple gtfs_version_ids in a batch — group by version.
      const versionGroups = new Map<string, typeof batch>();
      for (const row of batch) {
        const g = versionGroups.get(row.gtfs_version_id) ?? [];
        g.push(row);
        versionGroups.set(row.gtfs_version_id, g);
      }

      // scheduled arrival lookup: key "${gtfs_version_id}|${trip_id}|${stop_sequence}"
      const schedMap = new Map<string, string | null>();

      for (const [versionId, versionRows] of versionGroups) {
        const vTripIds = [...new Set(versionRows.map(r => r.trip_id))];
        // Chunk to avoid D1 "too many SQL variables" (limit 100 params per statement).
        const CHUNK = 80;
        for (let i = 0; i < vTripIds.length; i += CHUNK) {
          const chunk = vTripIds.slice(i, i + CHUNK);
          const vPlaceholders = chunk.map(() => '?').join(',');
          const stRows = await db.prepare(
            `SELECT trip_id, stop_sequence, arrival_time
             FROM gtfs_stop_times
             WHERE agency_id = ? AND gtfs_version_id = ? AND trip_id IN (${vPlaceholders})`
          ).bind(agencyId, versionId, ...chunk).all<{
            trip_id: string;
            stop_sequence: number;
            arrival_time: string | null;
          }>();
          for (const st of stRows.results ?? []) {
            schedMap.set(`${versionId}|${st.trip_id}|${st.stop_sequence}`, st.arrival_time ?? null);
          }
        }
      }

      void placeholders; // suppress unused

      // Build update statements.
      const stmts: D1PreparedStatement[] = [];
      for (const row of batch) {
        if (row.arrival_time_ms === null || row.stop_sequence === null) {
          skipped++;
          continue;
        }

        const schedArrivalStr = schedMap.get(`${row.gtfs_version_id}|${row.trip_id}|${row.stop_sequence}`);
        if (!schedArrivalStr) {
          skipped++;
          continue;
        }

        // Infer start_date from ts_ms if not present.
        const startDate = row.start_date ?? utcMsToLocalDate(row.ts_ms, tz);

        let delaySec: number | null = null;
        try {
          let schedMs = scheduledArrivalMs(tz, startDate, schedArrivalStr);
          if (schedMs - row.ts_ms > 12 * 3600 * 1000) {
            schedMs -= 24 * 3600 * 1000;
          }
          delaySec = Math.round((row.arrival_time_ms - schedMs) / 1000);
        } catch {
          skipped++;
          continue;
        }

        if (!dryRun) {
          stmts.push(
            db.prepare(
              `UPDATE tu_stop_time_updates SET delay_seconds = ?, start_date = COALESCE(start_date, ?) WHERE rowid = ?`
            ).bind(delaySec, startDate, row.rowid)
          );
        }
        updated++;
      }

      if (!dryRun && stmts.length > 0) {
        // D1 batch limit: 100 statements per batch.
        const BATCH = 100;
        for (let i = 0; i < stmts.length; i += BATCH) {
          await db.batch(stmts.slice(i, i + BATCH));
        }
      }

      processed += batchAll.length;
      lastTsMs = batchAll[batchAll.length - 1].ts_ms;

      if (batchAll.length < BATCH_SIZE) break; // reached end of range
    }

    const done = processed < maxRows;
    return c.json({
      ok: true,
      dry_run: dryRun,
      processed,
      updated,
      skipped,
      last_ts_ms: lastTsMs,
      done,
      message: done
        ? `Backfill complete for agency ${agencyId}.`
        : `Processed ${processed} rows. Call again with start_ms=${lastTsMs} to continue.`,
    });
  });
}
