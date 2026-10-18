import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { closeDb, getDb, hasDatabaseUrl } from '../lib/db/client'
import { runMigrations } from '../lib/db/migrate'
import { isDatabaseSeeded, seedDatabase } from '../lib/db/seed'

async function main() {
  const command = process.argv[2] ?? 'migrate'

  // Automated Vercel / Production build hook: ensures migrations and seed run automatically
  if (command === 'deploy') {
    console.log('\n======================================================')
    console.log('🚀 [Vercel Build] Checking Database Migrations & Seed')
    console.log('======================================================')

    if (!hasDatabaseUrl()) {
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        console.warn('⚠️  DATABASE_URL is not set in Vercel environment variables.')
        console.warn('   Skipping database migration & seed during build.')
        console.warn('   Ensure DATABASE_URL is added to Vercel Project Settings.')
        process.exit(0)
      } else {
        console.log('▸ No DATABASE_URL set. Running on local embedded PGlite...')
      }
    }

    try {
      const db = await getDb()
      const target = hasDatabaseUrl() ? process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@') : 'embedded PGlite (.data/pglite)'
      console.log(`▸ Database target: ${target}`)

      // 1. Run migrations
      console.log('▸ Checking pending migrations...')
      const applied = await runMigrations(db)
      if (applied.length > 0) {
        console.log(`✓ Applied ${applied.length} migration(s): ${applied.join(', ')}`)
      } else {
        console.log('✓ Database schema is up to date.')
      }

      // 2. Check if database needs initial seeding
      const seeded = await isDatabaseSeeded(db)
      if (seeded) {
        console.log('✓ Database already contains data. Seeding skipped.')
      } else {
        console.log('▸ Database is empty. Seeding demo gym, plans, timetable and accounts...')
        const summary = await seedDatabase(db, { force: true })
        console.log('✓ Seeding complete:', summary)
      }

      await closeDb()
      console.log('✓ Database ready for Vercel production build.\n')
      process.exit(0)
    } catch (error) {
      console.error('\n✖ Build database setup failed:', error)
      await closeDb().catch(() => undefined)
      process.exit(1)
    }
  }

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
      const summary = await seedDatabase(db, { force: true })
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
      const summary = await seedDatabase(db, { force: true })
      console.log('▸ Seeded demo gym:', summary)
      break
    }
    default:
      console.log('Usage: tsx scripts/db.ts [migrate|seed|reset|deploy]')
  }

  await closeDb()
  process.exit(0)
}

main().catch(async (error) => {
  console.error('\n✖ Database command failed:', error)
  await closeDb().catch(() => undefined)
  process.exit(1)
})
