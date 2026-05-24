import type { Api, ApiContext } from './types'

export function registerAnalysisRoutes(api: Api) {
  api.get('/analysis/routes', listRoutesWithInfo)
  api.get('/analysis/routes/:routeId/stringline', getStringlineData)
  api.get('/analysis/routes/:routeId/stops', getRouteStops)
  api.get('/analysis/vehicles', listVehicles)
  api.get('/analysis/vehicles/:vehicleId/stringline', getVehicleStringline)
  api.get('/analysis/stats/ontime', getOnTimeStats)
}

/** Infer canonical stop order from vehicle trajectories using topological sort.
 *  current_stop_sequence is trip-local, so multiple stops can share the same seq.
 *  We build a DAG of observed stop-to-stop transitions and topologically sort it.
 */
function inferStopOrder(points: Array<Record<string, unknown>>): string[] {
  // Group by vehicle
  const byVehicle: Record<string, Array<Record<string, unknown>>> = {}
  for (const row of points) {
    const vid = row.vehicle_id as string
    if (!byVehicle[vid]) byVehicle[vid] = []
    byVehicle[vid].push(row)
  }

  // Build edges from observed transitions
  const edges = new Map<string, Map<string, number>>() // from -> {to: count}
  const allStops = new Set<string>()

  for (const vid in byVehicle) {
    const pts = byVehicle[vid].sort((a, b) => (a.ts_ms as number) - (b.ts_ms as number))
    let prevStop: string | null = null
    for (const p of pts) {
      const sid = p.stop_id as string | null
      if (!sid) continue
      allStops.add(sid)
      if (prevStop && prevStop !== sid) {
        if (!edges.has(prevStop)) edges.set(prevStop, new Map())
        const toMap = edges.get(prevStop)!
        toMap.set(sid, (toMap.get(sid) || 0) + 1)
      }
      prevStop = sid
    }
  }

  // Kahn's topological sort with tie-breaking by out-degree weight
  const inDegree = new Map<string, number>()
  for (const stop of allStops) inDegree.set(stop, 0)
  for (const [, toMap] of edges) {
    for (const [to] of toMap) {
      inDegree.set(to, (inDegree.get(to) || 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [stop, deg] of inDegree) {
    if (deg === 0) queue.push(stop)
  }

  const result: string[] = []
  while (queue.length > 0) {
    // Pick node with highest total outgoing weight (most-traveled first)
    let bestIdx = 0
    let bestOut = -1
    for (let i = 0; i < queue.length; i++) {
      const outEdges = edges.get(queue[i])
      let outCount = 0
      if (outEdges) {
        for (const c of outEdges.values()) outCount += c
      }
      if (outCount > bestOut) {
        bestOut = outCount
        bestIdx = i
      }
    }
    const node = queue.splice(bestIdx, 1)[0]
    result.push(node)

    const toMap = edges.get(node)
    if (toMap) {
      for (const [to] of toMap) {
        inDegree.set(to, (inDegree.get(to) || 0) - 1)
        if (inDegree.get(to) === 0) queue.push(to)
      }
    }
  }

  // Append any remaining nodes (cycles or disconnected)
  for (const stop of allStops) {
    if (!result.includes(stop)) result.push(stop)
  }

  return result
}

async function listRoutesWithInfo(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'

  // Get routes from GTFS static if available, otherwise from live data
  const staticRoutes = await db.prepare(`
    SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name, r.route_color, r.route_text_color, r.route_type
    FROM gtfs_routes r
    WHERE r.agency_id = ?
    ORDER BY r.route_sort_order, r.route_short_name
  `).bind(agencyId).all()

  if (staticRoutes.results && staticRoutes.results.length > 0) {
    return c.json({ routes: staticRoutes.results })
  }

  // Fallback: get unique route_ids from live data
  const liveRoutes = await db.prepare(`
    SELECT DISTINCT route_id FROM vp_points 
    WHERE agency_id = ? AND route_id IS NOT NULL
    ORDER BY route_id
  `).bind(agencyId).all()

  const routes = (liveRoutes.results ?? []).map((r: Record<string, unknown>) => ({
    route_id: r.route_id,
    route_short_name: r.route_id,
    route_long_name: null,
    route_color: null,
    route_text_color: null,
    route_type: 3,
  }))

  return c.json({ routes })
}

async function getRouteStops(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const routeId = c.req.param('routeId')
  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'
  const directionId = c.req.query('direction_id') ?? '0'
  const allDirections = directionId === 'all'

  // Try getting stops from GTFS static data (ignore gtfs_version_id mismatch by using latest version)
  let staticSql = `
    SELECT DISTINCT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon, st.stop_sequence
    FROM gtfs_stop_times st
    JOIN gtfs_trips t ON st.trip_id = t.trip_id AND st.agency_id = t.agency_id
    JOIN gtfs_stops s ON st.stop_id = s.stop_id AND st.agency_id = s.agency_id
    WHERE t.route_id = ? AND t.agency_id = ?`
  const binds: Array<string | number> = [routeId, agencyId]
  if (!allDirections) {
    staticSql += ' AND t.direction_id = ?'
    binds.push(Number(directionId))
  }
  staticSql += ' GROUP BY s.stop_id ORDER BY MIN(st.stop_sequence)'

  const stops = await db.prepare(staticSql).bind(...binds).all()

  if (stops.results && stops.results.length > 0) {
    return c.json({ stops: stops.results })
  }

  // Fallback: infer stop order from live VP data using topological sort
  let liveSql = `
    SELECT vehicle_id, ts_ms, stop_id
    FROM vp_points 
    WHERE route_id = ? AND agency_id = ? AND stop_id IS NOT NULL
  `
  const liveBinds: Array<string | number> = [routeId, agencyId]
  if (!allDirections) {
    liveSql += ' AND direction_id = ?'
    liveBinds.push(Number(directionId))
  }
  liveSql += ' ORDER BY vehicle_id, ts_ms LIMIT 10000'

  const liveStops = await db.prepare(liveSql).bind(...liveBinds).all()
  const stopOrder = inferStopOrder(liveStops.results ?? [])

  // Try to get stop names from static data
  let stopNames = new Map<string, string>()
  if (stopOrder.length > 0) {
    try {
      const placeholders = stopOrder.map(() => '?').join(',')
      const nameResult = await db.prepare(`
        SELECT stop_id, stop_name FROM gtfs_stops
        WHERE agency_id = ? AND stop_id IN (${placeholders})
      `).bind(agencyId, ...stopOrder).all()
      for (const row of (nameResult.results ?? [])) {
        const r = row as Record<string, unknown>
        stopNames.set(r.stop_id as string, r.stop_name as string)
      }
    } catch {
      // ignore
    }
  }

  return c.json({ stops: stopOrder.map((sid, i) => ({
    stop_id: sid,
    stop_name: stopNames.get(sid) ?? sid,
    stop_sequence: i,
  })) })
}

async function getStringlineData(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const routeId = c.req.param('routeId')
  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'
  const directionId = c.req.query('direction_id') ?? '0'
  const allDirections = directionId === 'all'
  // Default to last 2 hours of data
  const sinceMs = Number(c.req.query('since_ms') ?? (Date.now() - 2 * 60 * 60 * 1000))
  const untilMs = Number(c.req.query('until_ms') ?? Date.now())

  // Build query
  let sql = `
    SELECT vehicle_id, ts_ms, stop_id, current_stop_sequence, lat, lon, current_status, direction_id
    FROM vp_points
    WHERE route_id = ? AND agency_id = ? AND ts_ms >= ? AND ts_ms <= ?
  `
  const binds: Array<string | number> = [routeId, agencyId, sinceMs, untilMs]
  if (!allDirections) {
    sql += ' AND direction_id = ?'
    binds.push(Number(directionId))
  }
  sql += ' ORDER BY vehicle_id, ts_ms LIMIT 10000'

  const result = await db.prepare(sql).bind(...binds).all()

  // Group by vehicle_id for the chart
  const byVehicle: Record<string, Array<Record<string, unknown>>> = {}
  for (const row of (result.results ?? [])) {
    const r = row as Record<string, unknown>
    const vid = r.vehicle_id as string
    if (!byVehicle[vid]) byVehicle[vid] = []
    byVehicle[vid].push(r)
  }

  // Infer stop order from trajectories
  const stopOrder = inferStopOrder(result.results ?? [])

  // Try to get stop names from static data
  let stopNames = new Map<string, string>()
  if (stopOrder.length > 0) {
    try {
      const placeholders = stopOrder.map(() => '?').join(',')
      const nameResult = await db.prepare(`
        SELECT stop_id, stop_name FROM gtfs_stops
        WHERE agency_id = ? AND stop_id IN (${placeholders})
      `).bind(agencyId, ...stopOrder).all()
      for (const row of (nameResult.results ?? [])) {
        const r = row as Record<string, unknown>
        stopNames.set(r.stop_id as string, r.stop_name as string)
      }
    } catch {
      // ignore
    }
  }

  const stops = stopOrder.map((sid, i) => ({
    stop_id: sid,
    stop_name: stopNames.get(sid) ?? sid,
    stop_sequence: i,
  }))

  const resp: Record<string, unknown> = {
    route_id: routeId,
    since_ms: sinceMs,
    until_ms: untilMs,
    vehicles: byVehicle,
    stops,
  }
  if (!allDirections) {
    resp.direction_id = Number(directionId)
  }

  return c.json(resp)
}

async function listVehicles(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)
  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'
  const sinceMs = Number(c.req.query('since_ms') ?? (Date.now() - 2 * 60 * 60 * 1000))

  const result = await db.prepare(`
    SELECT DISTINCT vehicle_id, route_id, direction_id
    FROM vp_points
    WHERE agency_id = ? AND ts_ms >= ?
    ORDER BY vehicle_id
    LIMIT 5000
  `).bind(agencyId, sinceMs).all()

  return c.json({ vehicles: result.results ?? [] })
}

async function getVehicleStringline(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const vehicleId = c.req.param('vehicleId')
  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'
  const sinceMs = Number(c.req.query('since_ms') ?? (Date.now() - 4 * 60 * 60 * 1000))
  const untilMs = Number(c.req.query('until_ms') ?? Date.now())

  const result = await db.prepare(`
    SELECT vehicle_id, ts_ms, stop_id, current_stop_sequence, lat, lon, current_status, route_id, direction_id
    FROM vp_points
    WHERE vehicle_id = ? AND agency_id = ? AND ts_ms >= ? AND ts_ms <= ?
    ORDER BY ts_ms
    LIMIT 10000
  `).bind(vehicleId, agencyId, sinceMs, untilMs).all()

  const byVehicle: Record<string, Array<Record<string, unknown>>> = {}
  const stopSeqMap = new Map<string, number>()
  const stopIdsSet = new Set<string>()
  for (const row of (result.results ?? [])) {
    const r = row as Record<string, unknown>
    const vid = r.vehicle_id as string
    if (!byVehicle[vid]) byVehicle[vid] = []
    byVehicle[vid].push(r)
    const sid = r.stop_id as string | null
    if (sid) {
      stopIdsSet.add(sid)
      const seq = r.current_stop_sequence as number | null
      if (seq !== null) {
        const existing = stopSeqMap.get(sid)
        if (existing === undefined || seq < existing) {
          stopSeqMap.set(sid, seq)
        }
      }
    }
  }

  // Order stops by their minimum observed sequence
  const sortedStopIds = Array.from(stopIdsSet).sort((a, b) => {
    const sa = stopSeqMap.get(a) ?? Infinity
    const sb = stopSeqMap.get(b) ?? Infinity
    return sa - sb
  })

  // Try to get stop names from static data
  let stopNames = new Map<string, string>()
  if (sortedStopIds.length > 0) {
    try {
      const placeholders = sortedStopIds.map(() => '?').join(',')
      const nameResult = await db.prepare(`
        SELECT stop_id, stop_name FROM gtfs_stops
        WHERE agency_id = ? AND stop_id IN (${placeholders})
      `).bind(agencyId, ...sortedStopIds).all()
      for (const row of (nameResult.results ?? [])) {
        const r = row as Record<string, unknown>
        stopNames.set(r.stop_id as string, r.stop_name as string)
      }
    } catch {
      // ignore
    }
  }

  const stops = sortedStopIds.map((sid, i) => ({
    stop_id: sid,
    stop_name: stopNames.get(sid) ?? sid,
    stop_sequence: stopSeqMap.get(sid) ?? i,
  }))

  return c.json({
    vehicle_id: vehicleId,
    since_ms: sinceMs,
    until_ms: untilMs,
    vehicles: byVehicle,
    stops,
  })
}

async function getOnTimeStats(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.query('agency_id') ?? 'mta-maryland'
  const routeId = c.req.query('route_id')
  const groupBy = c.req.query('group_by') ?? 'route' // route, hour, dow

  // Get trip update stats - compare predicted arrival to scheduled
  // For now, use tu_stop_time_updates to compute basic metrics
  let sql: string
  const binds: Array<string | number> = [agencyId]

  if (groupBy === 'hour') {
    sql = `
      SELECT route_id, 
        CAST((ts_ms / 1000 / 3600) % 24 AS INTEGER) as hour_of_day,
        COUNT(*) as total_updates,
        COUNT(CASE WHEN schedule_relationship = 'SCHEDULED' THEN 1 END) as scheduled_count
      FROM tu_stop_time_updates
      WHERE agency_id = ?`
    if (routeId) {
      sql += ' AND route_id = ?'
      binds.push(routeId)
    }
    sql += ` GROUP BY route_id, hour_of_day ORDER BY route_id, hour_of_day`
  } else if (groupBy === 'dow') {
    sql = `
      SELECT route_id, 
        CAST((ts_ms / 1000 / 86400 + 4) % 7 AS INTEGER) as day_of_week,
        COUNT(*) as total_updates,
        COUNT(CASE WHEN schedule_relationship = 'SCHEDULED' THEN 1 END) as scheduled_count
      FROM tu_stop_time_updates
      WHERE agency_id = ?`
    if (routeId) {
      sql += ' AND route_id = ?'
      binds.push(routeId)
    }
    sql += ` GROUP BY route_id, day_of_week ORDER BY route_id, day_of_week`
  } else {
    sql = `
      SELECT route_id,
        COUNT(*) as total_updates,
        COUNT(DISTINCT trip_id) as unique_trips,
        MIN(ts_ms) as first_update_ms,
        MAX(ts_ms) as last_update_ms
      FROM tu_stop_time_updates
      WHERE agency_id = ?`
    if (routeId) {
      sql += ' AND route_id = ?'
      binds.push(routeId)
    }
    sql += ` GROUP BY route_id ORDER BY route_id`
  }

  const result = await db.prepare(sql).bind(...binds).all()
  return c.json({ group_by: groupBy, stats: result.results ?? [] })
}
