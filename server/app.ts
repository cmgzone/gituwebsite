import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import type pg from 'pg'

import { registerAuthRoutes } from './auth/routes.js'
import { registerApiKeyRoutes } from './api-keys/routes.js'
import { registerProviderRoutes } from './providers/routes.js'
import { registerModelRoutes } from './models/routes.js'
import { registerInferenceRoutes } from './inference/routes.js'
import { createDatabasePool } from './db/client.js'

const currentFile = fileURLToPath(import.meta.url)
const distDirectory = join(dirname(currentFile), '../dist')

export async function createApp(
  pool: pg.Pool = createDatabasePool(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  await app.register(helmet)
  await app.register(cookie)
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await registerAuthRoutes(app, pool)
  await registerApiKeyRoutes(app, pool)
  await registerProviderRoutes(app, pool)
  await registerModelRoutes(app, pool)
  await registerInferenceRoutes(app, pool)

  app.get('/health', async () => ({ ok: true }))

  await app.register(fastifyStatic, {
    root: distDirectory,
  })

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' })
    }

    return reply.sendFile('index.html')
  })

  app.addHook('onClose', async () => {
    await pool.end()
  })

  return app
}
