import type { Api } from './types'
import { getHealthMessage, getRandomUuid } from '../handlers/health'

export function registerHealthRoutes(api: Api) {
  api.get('/health/message', getHealthMessage)
  api.get('/health/random', getRandomUuid)
}
