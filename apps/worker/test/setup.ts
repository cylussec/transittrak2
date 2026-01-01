import { env } from 'cloudflare:test'
import { beforeAll, vi } from 'vitest'

import migrationSql from '../migrations/0000_init.sql?raw'
import seedSql from '../db/seed.sql?raw'

function splitMigrationStatements(sql: string) {
  return sql
    .split(/--> statement-breakpoint\s*/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function splitSeedStatements(sql: string) {
  return sql
    .split(/;\s*\n/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function runStatement(db: D1Database, sql: string) {
  const statement = sql.endsWith(';') ? sql.slice(0, -1) : sql
  await db.prepare(statement).run()
}

async function ensureSchema() {
  const db = (env as Env).DB
  if (!db) throw new Error('Missing env.DB in test runtime')

  const alreadyInitialized = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agencies'")
    .first()

  if (alreadyInitialized) return

  for (const stmt of splitMigrationStatements(migrationSql)) {
    await runStatement(db, stmt)
  }
}

async function ensureSeeded() {
  const db = (env as Env).DB
  if (!db) throw new Error('Missing env.DB in test runtime')

  const alreadySeeded = await db
    .prepare('SELECT agency_id FROM agencies WHERE agency_id = ?')
    .bind('mta-maryland-local-bus')
    .first()

  if (alreadySeeded) return

  for (const stmt of splitSeedStatements(seedSql)) {
    await runStatement(db, stmt)
  }
}

beforeAll(async () => {
  const realFetch = globalThis.fetch.bind(globalThis)

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (url.startsWith('https://static.mta.maryland.gov/') || url.startsWith('https://swiftly.app/')) {
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
        },
      })
    }

    return realFetch(input as RequestInfo, init)
  })

  Reflect.set(env as unknown as Record<string, unknown>, 'SWIFTLY_API_KEY', (env as Env).SWIFTLY_API_KEY ?? 'test')

  await ensureSchema()
  await ensureSeeded()
})
