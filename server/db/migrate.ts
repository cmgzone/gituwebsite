import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const currentFile = fileURLToPath(import.meta.url)
const migrationsDirectory = join(dirname(currentFile), 'migrations')

function databaseUrl() {
  const value = process.env.DATABASE_URL
  if (!value) {
    throw new Error('DATABASE_URL is required to run database migrations.')
  }

  return value
}

function migrationVersion(filename: string) {
  return basename(filename, extname(filename))
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort()

    for (const filename of filenames) {
      const version = migrationVersion(filename)
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [version],
      )

      if (existing.rowCount) continue

      const migration = await readFile(join(migrationsDirectory, filename), 'utf8')
      await client.query(migration)
      console.log(`Applied migration ${version}`)
    }
  } finally {
    client.release()
  }
}

if (process.argv[1] === currentFile) {
  const pool = new Pool({ connectionString: databaseUrl() })

  runMigrations(pool)
    .catch((error: unknown) => {
      console.error('Database migration failed.', error)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
