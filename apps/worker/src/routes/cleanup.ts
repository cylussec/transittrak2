import type { Api } from './types'
import { cleanupD1HotCache, getD1SizeMb } from '../cleanup/retention'

export function registerCleanupRoutes(api: Api) {
  api.get('/cleanup/status', async (c) => {
    const sizeMb = await getD1SizeMb(c.env)
    return c.json({ ok: true, d1_size_mb: sizeMb, threshold_mb: 8_000 })
  })

  api.post('/cleanup/run', async (c) => {
    try {
      const result = await cleanupD1HotCache(c.env)
      return c.json({ ok: true, ...result })
    } catch (error) {
      console.error('Cleanup error:', error)
      return c.json({ ok: false, error: String(error) }, 500)
    }
  })
}
