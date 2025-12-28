import type { ApiContext } from '../routes/types'

export async function fetchGtfsStatic(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const bucket = c.env.ARCHIVE_BUCKET
  if (!bucket) return c.text('R2 not configured', 501)

  const body = (await c.req.json().catch(() => null)) as null | { agency_id?: unknown }
  const agencyId = typeof body?.agency_id === 'string' ? body.agency_id : null
  if (!agencyId) return c.text('Invalid agency_id', 400)

  const agency = await db
    .prepare('SELECT agency_id, gtfs_static_url FROM agencies WHERE agency_id = ? AND enabled = 1')
    .bind(agencyId)
    .first<{ agency_id: string; gtfs_static_url: string }>()

  if (!agency) return c.text('Unknown agency_id', 404)

  const resp = await fetch(agency.gtfs_static_url)
  if (!resp.ok) return c.text('Failed to fetch GTFS static', 502)

  const bytes = await resp.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const gtfsVersionId = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const tsMs = Date.now()
  const r2Key = `gtfs-static/${agencyId}/hash=${gtfsVersionId}/fetched_at=${tsMs}.zip`

  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'application/zip',
    },
    customMetadata: {
      agency_id: agencyId,
      gtfs_version_id: gtfsVersionId,
      fetched_at_ms: String(tsMs),
    },
  })

  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO gtfs_versions (gtfs_version_id, agency_id, fetched_at_ms, r2_key) VALUES (?, ?, ?, ?)')
      .bind(gtfsVersionId, agencyId, tsMs, r2Key),
    db
      .prepare('INSERT OR IGNORE INTO gtfs_version_effective (agency_id, effective_from_ms, gtfs_version_id) VALUES (?, ?, ?)')
      .bind(agencyId, tsMs, gtfsVersionId),
  ])

  return c.json({ gtfs_version_id: gtfsVersionId, r2_key: r2Key })
}

export async function listGtfsStaticVersions(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.param('agencyId')
  const result = await db
    .prepare(
      'SELECT gtfs_version_id, agency_id, fetched_at_ms, r2_key FROM gtfs_versions WHERE agency_id = ? ORDER BY fetched_at_ms DESC'
    )
    .bind(agencyId)
    .all()

  return c.json({ versions: result.results ?? [] })
}

export async function getGtfsStaticVersionAt(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.param('agencyId')
  const tsMsRaw = c.req.query('ts_ms')
  const tsMs = tsMsRaw ? Number(tsMsRaw) : NaN
  if (!Number.isFinite(tsMs)) return c.text('Invalid ts_ms', 400)

  const row = await db
    .prepare(
      'SELECT gtfs_version_id, effective_from_ms FROM gtfs_version_effective WHERE agency_id = ? AND effective_from_ms <= ? ORDER BY effective_from_ms DESC LIMIT 1'
    )
    .bind(agencyId, tsMs)
    .first<{ gtfs_version_id: string; effective_from_ms: number }>()

  if (!row) return c.text('Not Found', 404)
  return c.json(row)
}
