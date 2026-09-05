import { createApp } from './app.js'
import { createDatabasePool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { assertProviderEncryptionKey } from './security/crypto.js'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

assertProviderEncryptionKey()

const pool = createDatabasePool()
let app: Awaited<ReturnType<typeof createApp>> | undefined

try {
  await runMigrations(pool)
  app = await createApp(pool)
  await app.listen({ host: '0.0.0.0', port })
} catch (error: unknown) {
  console.error('Gitu server failed to start.', error)

  if (app) {
    await app.close()
  } else {
    await pool.end()
  }

  process.exitCode = 1
}
