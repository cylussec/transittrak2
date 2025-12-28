import type { ApiContext } from '../routes/types'

export async function runIngest(c: ApiContext) {
  const { DB, ARCHIVE_BUCKET, SWIFTLY_API_KEY, INGEST_COORDINATOR } = c.env
  if (!DB) return c.text('D1 not configured', 501)
  if (!ARCHIVE_BUCKET) return c.text('R2 not configured', 501)
  if (!SWIFTLY_API_KEY) return c.text('SWIFTLY_API_KEY not configured', 501)
  if (!INGEST_COORDINATOR) return c.text('Durable Object not configured', 501)

  const body = (await c.req.json().catch(() => null)) as null | { agency_id?: unknown }
  const agencyId = typeof body?.agency_id === 'string' ? body.agency_id : null
  if (!agencyId) return c.text('Invalid agency_id', 400)

  const id = INGEST_COORDINATOR.idFromName(agencyId)
  const stub = INGEST_COORDINATOR.get(id)
  return stub.fetch('https://do/do/ingest/run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ agency_id: agencyId }),
  })
}
