import type { Api } from './types'
import { fetchGtfsStatic, getGtfsStaticVersionAt, listGtfsStaticVersions } from '../handlers/gtfs-static'
import { parseAndStoreGtfsStatic } from '../gtfs-static/parsers'

export function registerGtfsStaticRoutes(api: Api) {
  api.post('/gtfs-static/fetch', fetchGtfsStatic)
  api.get('/gtfs-static/agency/:agencyId/versions', listGtfsStaticVersions)
  api.get('/gtfs-static/agency/:agencyId/version-at', getGtfsStaticVersionAt)

  // Trigger DO-based fetch+parse (downloads zip, parses routes/stops/trips into D1)
  api.post('/gtfs-static/fetch-and-parse', async (c) => {
    const body = (await c.req.json().catch(() => null)) as null | { agency_id?: unknown }
    const agencyId = typeof body?.agency_id === 'string' ? body.agency_id : null
    if (!agencyId) return c.text('Missing agency_id', 400)
    if (!c.env.GTFS_STATIC_COORDINATOR) return c.text('DO not configured', 501)

    const staticId = c.env.GTFS_STATIC_COORDINATOR.idFromName(agencyId)
    const staticStub = c.env.GTFS_STATIC_COORDINATOR.get(staticId)
    const doResp = await staticStub.fetch('https://do/do/gtfs-static/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agency_id: agencyId }),
    })
    const result = await doResp.json()
    return c.json(result, doResp.status as 200)
  })

  // Parse an existing GTFS version into D1 tables (routes, stops, trips, etc.)
  api.post('/gtfs-static/parse-existing', async (c) => {
    const body = (await c.req.json().catch(() => null)) as null | { agency_id?: unknown }
    const agencyId = typeof body?.agency_id === 'string' ? body.agency_id : null
    if (!agencyId) return c.text('Missing agency_id', 400)
    if (!c.env.DB) return c.text('D1 not configured', 501)

    const version = await c.env.DB.prepare(
      'SELECT gtfs_version_id, r2_key FROM gtfs_versions WHERE agency_id = ? ORDER BY fetched_at_ms DESC LIMIT 1'
    ).bind(agencyId).first<{ gtfs_version_id: string; r2_key: string }>()

    if (!version) return c.json({ ok: false, error: 'No GTFS version found' }, 404)

    try {
      await parseAndStoreGtfsStatic(agencyId, version.gtfs_version_id, version.r2_key, c.env)
      return c.json({ ok: true, gtfs_version_id: version.gtfs_version_id })
    } catch (e) {
      console.error('GTFS parse error:', e)
      return c.json({ ok: false, error: String(e) }, 500)
    }
  })
}
