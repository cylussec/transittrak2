import type { Api } from './types'
import { listAgencies, listAgencyFeeds } from '../handlers/metadata'

export function registerMetadataRoutes(api: Api) {
  api.get('/metadata/agencies', listAgencies)
  api.get('/metadata/agency/:agencyId/feeds', listAgencyFeeds)
}
