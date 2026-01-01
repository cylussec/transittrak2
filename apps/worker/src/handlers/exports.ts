import type { ApiContext } from '../routes/types'

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDate(date: string | null | undefined) {
  if (!date) return { ok: false as const, error: 'Missing date' }
  const match = date.match(DATE_REGEX)
  if (!match) return { ok: false as const, error: 'Invalid date' }
  const [, year, month, day] = match
  const startMs = Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
  const endMs = startMs + 24 * 60 * 60 * 1000
  return { ok: true as const, startMs, endMs }
}

function validateFeedType(feedType: string | null | undefined) {
  if (!feedType) return { ok: false as const, error: 'Missing feed_type' }
  switch (feedType) {
    case 'vehicle-positions':
    case 'trip-updates':
    case 'alerts':
      return { ok: true as const, feedTypes: [feedType] as string[], effectiveType: feedType }
    case 'all':
      return {
        ok: true as const,
        feedTypes: ['vehicle-positions', 'trip-updates', 'alerts'] as string[],
        effectiveType: feedType,
      }
    default:
      return { ok: false as const, error: 'Invalid feed_type' }
  }
}

export async function getExportManifest(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.param('agencyId')
  const dateParse = parseDate(c.req.query('date'))
  if (!dateParse.ok) return c.text(dateParse.error, 400)
  const { startMs, endMs } = dateParse

  const feedValidation = validateFeedType(c.req.query('feed_type'))
  if (!feedValidation.ok) return c.text(feedValidation.error, 400)
  const { feedTypes, effectiveType } = feedValidation

  const format = c.req.query('format') ?? 'pb'
  if (format !== 'pb') return c.text('Unsupported format', 400)

  const placeholders = feedTypes.map(() => '?').join(', ')
  const sql = `SELECT r2_key, ts_ms, feed_type FROM gtfsrt_snapshots WHERE agency_id = ? AND ts_ms >= ? AND ts_ms < ? AND feed_type IN (${placeholders}) ORDER BY ts_ms ASC`
  const stmt = db.prepare(sql).bind(agencyId, startMs, endMs, ...feedTypes)
  const result = await stmt.all<{ r2_key: string; ts_ms: number; feed_type: string }>()

  return c.json({
    agency_id: agencyId,
    date: c.req.query('date'),
    feed_type: effectiveType,
    format,
    objects: result.results ?? [],
  })
}

export async function listSnapshots(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.param('agencyId')
  const feedType = c.req.query('feed_type') ?? undefined
  const startMsRaw = c.req.query('start_ms') ?? undefined
  const endMsRaw = c.req.query('end_ms') ?? undefined
  const limitRaw = c.req.query('limit') ?? undefined

  const startMs = startMsRaw ? Number(startMsRaw) : null
  const endMs = endMsRaw ? Number(endMsRaw) : null
  if (startMsRaw && !Number.isFinite(startMs)) return c.text('Invalid start_ms', 400)
  if (endMsRaw && !Number.isFinite(endMs)) return c.text('Invalid end_ms', 400)

  const limitUnclamped = limitRaw ? Number(limitRaw) : 100
  if (limitRaw && (!Number.isFinite(limitUnclamped) || limitUnclamped <= 0)) return c.text('Invalid limit', 400)
  const limit = Math.min(Math.floor(limitUnclamped), 1000)

  let sql =
    'SELECT snapshot_id, agency_id, feed_type, ts_ms, gtfs_version_id, r2_key, byte_size, http_etag, http_last_modified FROM gtfsrt_snapshots WHERE agency_id = ?'
  const binds: Array<string | number> = [agencyId]

  if (feedType) {
    if (!['vehicle-positions', 'trip-updates', 'alerts'].includes(feedType)) return c.text('Invalid feed_type', 400)
    sql += ' AND feed_type = ?'
    binds.push(feedType)
  }

  if (startMs !== null) {
    sql += ' AND ts_ms >= ?'
    binds.push(startMs)
  }

  if (endMs !== null) {
    sql += ' AND ts_ms <= ?'
    binds.push(endMs)
  }

  sql += ' ORDER BY ts_ms DESC LIMIT ?'
  binds.push(limit)

  const result = await db.prepare(sql).bind(...binds).all()
  return c.json({ snapshots: result.results ?? [] })
}
