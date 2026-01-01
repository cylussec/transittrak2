import type { Api } from './types'
import { registerHealthRoutes } from './health'
import { registerMetadataRoutes } from './metadata'
import { registerGtfsStaticRoutes } from './gtfs-static'
import { registerIngestRoutes } from './ingest'
import { registerExportsRoutes } from './exports'

export function registerRoutes(api: Api) {
  registerHealthRoutes(api)
  registerMetadataRoutes(api)
  registerGtfsStaticRoutes(api)
  registerIngestRoutes(api)
  registerExportsRoutes(api)
}
