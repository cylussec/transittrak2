import type { Api } from './types'
import { fetchGtfsStatic, getGtfsStaticVersionAt, listGtfsStaticVersions } from '../handlers/gtfs-static'

export function registerGtfsStaticRoutes(api: Api) {
  api.post('/gtfs-static/fetch', fetchGtfsStatic)
  api.get('/gtfs-static/agency/:agencyId/versions', listGtfsStaticVersions)
  api.get('/gtfs-static/agency/:agencyId/version-at', getGtfsStaticVersionAt)
}
