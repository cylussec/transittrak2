import type { Api } from './types'
import { getExportManifest, listSnapshots } from '../handlers/exports'

export function registerExportsRoutes(api: Api) {
  api.get('/exports/agency/:agencyId/manifest', getExportManifest)
  api.get('/exports/agency/:agencyId/snapshots', listSnapshots)
}
