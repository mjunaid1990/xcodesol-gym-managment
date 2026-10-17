import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Database } from './client'

/** postgres.js returns a RowList, PGlite returns { rows }. Normalise both. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  const maybe = result as { rows?: T[] }
  return maybe?.rows ?? []
}

export async function runMigrations(db: Database, dir = join(process.cwd(), 'drizzle')): Promise<string[]> {
  await db.execute(
    sql`create table if not exists app_migrations (name text primary key, applied_at timestamptz not null default now())`,
  )

  const appliedResult = await db.execute(sql`select name from app_migrations`)
  const applied = new Set(rowsOf<{ name: string }>(appliedResult).map((r) => r.name))

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const executed: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const contents = readFileSync(join(dir, file), 'utf8')
    const statements = contents
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    for (const statement of statements) {
      await db.execute(sql.raw(statement))
    }
    await db.execute(sql`insert into app_migrations (name) values (${file})`)
    executed.push(file)
  }
  return executed
}
