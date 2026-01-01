import type { ApiContext } from '../routes/types'

export async function listAgencies(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const result = await db
    .prepare(
      'SELECT agency_id, display_name, timezone, gtfs_static_url, swiftly_agency_key, enabled FROM agencies WHERE enabled = 1 ORDER BY agency_id'
    )
    .all()

  return c.json({ agencies: result.results ?? [] })
}

export async function listAgencyFeeds(c: ApiContext) {
  const db = c.env.DB
  if (!db) return c.text('D1 not configured', 501)

  const agencyId = c.req.param('agencyId')
  const result = await db
    .prepare('SELECT feed_id, agency_id, feed_type, url, enabled FROM feeds WHERE agency_id = ? ORDER BY feed_type')
    .bind(agencyId)
    .all()

  return c.json({ feeds: result.results ?? [] })
}
