import type { Api } from './types'
import { runIngest } from '../handlers/ingest'

export function registerIngestRoutes(api: Api) {
  api.post('/ingest/run', runIngest)
}
