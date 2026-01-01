import type { ApiContext } from '../routes/types'

export function getHealthMessage(c: ApiContext) {
  return c.text('Hello, World!')
}

export function getRandomUuid(c: ApiContext) {
  return c.text(crypto.randomUUID())
}
