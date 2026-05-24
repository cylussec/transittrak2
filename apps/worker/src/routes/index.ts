import type { Api } from './types'
import { registerHealthRoutes } from './health'
import { registerMetadataRoutes } from './metadata'
import { registerGtfsStaticRoutes } from './gtfs-static'
import { registerIngestRoutes } from './ingest'
import { registerExportsRoutes } from './exports'
import { registerCleanupRoutes } from './cleanup'
import { registerBackfillRoutes } from './backfill'
import { registerVehicleRoutes } from './vehicles'
import { registerAnalysisRoutes } from './analysis'

export function registerRoutes(api: Api) {
  registerHealthRoutes(api)
  registerMetadataRoutes(api)
  registerGtfsStaticRoutes(api)
  registerIngestRoutes(api)
  registerExportsRoutes(api)
  registerCleanupRoutes(api)
  registerBackfillRoutes(api)
  registerVehicleRoutes(api)
  registerAnalysisRoutes(api)
}
