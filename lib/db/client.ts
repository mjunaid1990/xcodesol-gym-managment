import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

/**
 * One connection strategy per environment:
 *  - DATABASE_URL set  -> postgres.js against a pooled (Neon/Supabase) Postgres.
 *    `prepare: false` is required for transaction-mode poolers.
 *  - DATABASE_URL empty -> embedded Postgres (PGlite) persisted in ./.data/pglite.
 *    This keeps `npm run dev` a one-command, no-Docker experience.
 *
 * The exported type is the postgres.js flavour for both drivers: PGlite's drizzle
 * instance exposes the same query-builder surface, so services stay fully typed.
 */
export type Database = PostgresJsDatabase<typeof schema>

type GlobalWithDb = typeof globalThis & {
  __ironhouseDb?: Promise<Database>
  __ironhouseSql?: { end: (opts?: { timeout?: number }) => Promise<void> }
}

const globalForDb = globalThis as GlobalWithDb

async function createDb(): Promise<Database> {
  const url = process.env.DATABASE_URL?.trim()

  if (url) {
    const { default: postgres } = await import('postgres')
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const sql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: url.includes('sslmode=disable') ? false : 'require',
    })
    globalForDb.__ironhouseSql = sql
    return drizzle(sql, { schema })
  }

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    if (process.env.ALLOW_EMBEDDED_DB !== 'true') {
      throw new Error(
        'DATABASE_URL is not set. On Vercel, connect a Postgres database (Neon) and add DATABASE_URL to the project environment variables.',
      )
    }
  }

  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const { dirname, resolve } = await import('node:path')
  const { mkdirSync } = await import('node:fs')
  // Use turbopackIgnore comment so dynamic path resolution doesn't trace the entire repo into Vercel bundle
  const dir = resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PGLITE_DIR ?? '.data/pglite')
  // PGlite creates only its own leaf directory, so the parent has to exist first.
  mkdirSync(dirname(dir), { recursive: true })
  const client = new PGlite(dir)
  const instance = drizzle(client, { schema })
  return instance as unknown as Database
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getDb(): Promise<Database> {
  if (!globalForDb.__ironhouseDb) {
    globalForDb.__ironhouseDb = createDb()
  }
  return globalForDb.__ironhouseDb
}

/** Test helper: swap the process-wide connection for an in-memory database. */
export function setDbForTests(db: Database): void {
  globalForDb.__ironhouseDb = Promise.resolve(db)
}

export async function closeDb(): Promise<void> {
  await globalForDb.__ironhouseSql?.end({ timeout: 5 })
  globalForDb.__ironhouseDb = undefined
  globalForDb.__ironhouseSql = undefined
}

export { schema }
