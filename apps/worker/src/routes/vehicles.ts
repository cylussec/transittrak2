import type { Api } from './types'
import type { ApiContext } from './types'

export function registerVehicleRoutes(api: Api) {
  api.get('/vehicles/positions', getVehiclePositions)
  api.get('/vehicles/positions/latest', getLatestPositions)
}

async function getVehiclePositions(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.query('agency_id')
  const routeId = c.req.query('route_id')
  const sinceMs = c.req.query('since_ms')
  const limit = Math.min(Number(c.req.query('limit') ?? '500'), 2000)

  let sql = `SELECT agency_id, ts_ms, vehicle_id, trip_id, route_id, direction_id, stop_id, lat, lon, bearing, speed, current_status, current_stop_sequence FROM vp_points WHERE 1=1`
  const binds: Array<string | number> = []

  if (agencyId) {
    sql += ' AND agency_id = ?'
    binds.push(agencyId)
  }
  if (routeId) {
    sql += ' AND route_id = ?'
    binds.push(routeId)
  }
  if (sinceMs) {
    sql += ' AND ts_ms >= ?'
    binds.push(Number(sinceMs))
  }

  sql += ' ORDER BY ts_ms DESC LIMIT ?'
  binds.push(limit)

  const result = await db.prepare(sql).bind(...binds).all()
  return c.json({ positions: result.results ?? [] })
}

async function getLatestPositions(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.query('agency_id')

  // Find the most recent snapshot timestamp, then get all positions from it
  let maxTsSql = 'SELECT MAX(ts_ms) as max_ts FROM vp_points'
  const maxTsBinds: Array<string | number> = []
  if (agencyId) {
    maxTsSql += ' WHERE agency_id = ?'
    maxTsBinds.push(agencyId)
  }

  const maxTsRow = await db.prepare(maxTsSql).bind(...maxTsBinds).first<{ max_ts: number | null }>()
  if (!maxTsRow?.max_ts) {
    return c.json({ positions: [], as_of_ms: Date.now() })
  }

  // Get all positions from the most recent minute of data
  const cutoff = maxTsRow.max_ts - 60_000
  let sql = `SELECT agency_id, ts_ms, vehicle_id, trip_id, route_id, direction_id, stop_id, lat, lon, bearing, speed, current_status, current_stop_sequence
    FROM vp_points WHERE ts_ms >= ?`
  const binds: Array<string | number> = [cutoff]

  if (agencyId) {
    sql += ' AND agency_id = ?'
    binds.push(agencyId)
  }

  sql += ' ORDER BY ts_ms DESC LIMIT 2000'

  const result = await db.prepare(sql).bind(...binds).all()
  return c.json({ positions: result.results ?? [], as_of_ms: maxTsRow.max_ts })
}
