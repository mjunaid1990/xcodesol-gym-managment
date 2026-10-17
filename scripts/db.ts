import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { closeDb, getDb, hasDatabaseUrl } from '../lib/db/client'
import { runMigrations } from '../lib/db/migrate'
import { seedDatabase } from '../lib/db/seed'

async function main() {
  const command = process.argv[2] ?? 'migrate'
  const db = await getDb()
  const target = hasDatabaseUrl() ? process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@') : 'embedded PGlite (.data/pglite)'
  console.log(`\n▸ Database: ${target}`)

  switch (command) {
    case 'migrate': {
      const applied = await runMigrations(db)
      console.log(applied.length ? `▸ Applied migrations: ${applied.join(', ')}` : '▸ Schema already up to date')
      break
    }
    case 'seed': {
      await runMigrations(db)
      const summary = await seedDatabase(db)
      console.log('▸ Seeded demo gym:', summary)
      break
    }
    case 'reset': {
      if (hasDatabaseUrl() && process.env.ALLOW_DB_RESET !== 'true') {
        throw new Error('Refusing to drop tables on a remote database. Re-run with ALLOW_DB_RESET=true if you are sure.')
      }
      await db.execute(sql`drop schema if exists public cascade`)
      await db.execute(sql`create schema public`)
      console.log('▸ Schema dropped and recreated')
      await runMigrations(db)
      const summary = await seedDatabase(db)
      console.log('▸ Seeded demo gym:', summary)
      break
    }
    default:
      console.log('Usage: tsx scripts/db.ts [migrate|seed|reset]')
  }

  await closeDb()
  process.exit(0)
}

main().catch(async (error) => {
  console.error('\n✖ Database command failed:', error)
  await closeDb().catch(() => undefined)
  process.exit(1)
})
