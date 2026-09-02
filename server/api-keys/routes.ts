import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'

import { recordAuditEvent, requireUser } from '../auth/routes.js'
import { digestToken, generateApiKey } from '../security/crypto.js'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresAt: z.string().trim().min(1).max(64).optional(),
}).strict()

const renameKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const keyParamsSchema = z.object({
  id: z.string().uuid(),
}).strict()

const validateKeySchema = z.object({
  token: z.string().min(10).max(200),
}).strict()

type KeyRow = {
  id: string
  user_id: string
  name: string
  key_prefix: string
  key_last_four: string
  created_at: Date | string
  updated_at: Date | string
  last_used_at: Date | string | null
  expires_at: Date | string | null
  revoked_at: Date | string | null
  rotated_from_id: string | null
}

type KeyResponse = {
  id: string
  name: string
  prefix: string
  lastFour: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  rotatedFromId: string | null
}

const rateLimitConfig = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
    },
  },
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) {
    return null
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function serializeKey(row: KeyRow): KeyResponse {
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    lastFour: row.key_last_four,
    createdAt: timestamp(row.created_at) as string,
    updatedAt: timestamp(row.updated_at) as string,
    lastUsedAt: timestamp(row.last_used_at),
    expiresAt: timestamp(row.expires_at),
    revokedAt: timestamp(row.revoked_at),
    rotatedFromId: row.rotated_from_id,
  }
}

function parseKeyId(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = keyParamsSchema.safeParse(request.params)
  if (!parsed.success) {
    reply.code(400).send({ error: 'invalid_request' })
    return null
  }
  return parsed.data.id
}

function parseExpiry(value: string | undefined): Date | null | false {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    return false
  }
  return parsed
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function sendKeyError(reply: FastifyReply, error: unknown) {
  if (isUniqueViolation(error)) {
    return reply.code(409).send({ error: 'key_name_conflict' })
  }
  return reply.code(500).send({ error: 'internal_error' })
}

export async function registerApiKeyRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.post('/api/keys', rateLimitConfig, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const parsed = createKeySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    const expiresAt = parseExpiry(parsed.data.expiresAt)
    if (expiresAt === false) {
      return reply.code(400).send({ error: 'invalid_expiry' })
    }

    const generated = generateApiKey()
    const id = randomUUID()

    try {
      const result = await pool.query<KeyRow>(
        `INSERT INTO api_keys
          (id, user_id, name, key_prefix, key_last_four, key_digest, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, name, key_prefix, key_last_four,
           created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id`,
        [id, user.id, parsed.data.name, generated.prefix, generated.lastFour, generated.digest, expiresAt],
      )

      await recordAuditEvent(pool, 'api_key.created', request, user.id, { keyId: id })
      return reply.code(201).send({ key: serializeKey(result.rows[0]), token: generated.token })
    } catch (error) {
      return sendKeyError(reply, error)
    }
  })

  app.get('/api/keys', rateLimitConfig, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const result = await pool.query<KeyRow>(
      `SELECT id, user_id, name, key_prefix, key_last_four,
         created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.id],
    )

    return reply.send({ keys: result.rows.map(serializeKey) })
  })

  app.patch('/api/keys/:id', rateLimitConfig, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const id = parseKeyId(request, reply)
    if (!id) return
    const parsed = renameKeySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    try {
      const result = await pool.query<KeyRow>(
        `UPDATE api_keys
         SET name = $1, updated_at = now()
         WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
         RETURNING id, user_id, name, key_prefix, key_last_four,
           created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id`,
        [parsed.data.name, id, user.id],
      )
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'not_found' })
      }

      await recordAuditEvent(pool, 'api_key.renamed', request, user.id, { keyId: id })
      return reply.send({ key: serializeKey(result.rows[0]) })
    } catch (error) {
      return sendKeyError(reply, error)
    }
  })

  app.post('/api/keys/:id/revoke', rateLimitConfig, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const id = parseKeyId(request, reply)
    if (!id) return

    const result = await pool.query<KeyRow>(
      `UPDATE api_keys
       SET revoked_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id, user_id, name, key_prefix, key_last_four,
         created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id`,
      [id, user.id],
    )
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'not_found' })
    }

    await recordAuditEvent(pool, 'api_key.revoked', request, user.id, { keyId: id })
    return reply.send({ key: serializeKey(result.rows[0]) })
  })

  app.post('/api/keys/:id/rotate', rateLimitConfig, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const id = parseKeyId(request, reply)
    if (!id) return

    const client = await pool.connect()
    const generated = generateApiKey()
    const replacementId = randomUUID()

    try {
      await client.query('BEGIN')
      const oldResult = await client.query<KeyRow>(
        `SELECT id, user_id, name, key_prefix, key_last_four,
           created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id
         FROM api_keys
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         FOR UPDATE`,
        [id, user.id],
      )
      const oldKey = oldResult.rows[0]
      if (!oldKey) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'not_found' })
      }

      await client.query(
        `UPDATE api_keys SET revoked_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [id, user.id],
      )
      const replacementResult = await client.query<KeyRow>(
        `INSERT INTO api_keys
          (id, user_id, name, key_prefix, key_last_four, key_digest, expires_at, rotated_from_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, user_id, name, key_prefix, key_last_four,
           created_at, updated_at, last_used_at, expires_at, revoked_at, rotated_from_id`,
        [replacementId, user.id, oldKey.name, generated.prefix, generated.lastFour, generated.digest, oldKey.expires_at, id],
      )
      await client.query('COMMIT')

      await recordAuditEvent(pool, 'api_key.rotated', request, user.id, {
        keyId: replacementId,
        rotatedFromId: id,
      })
      return reply.send({ key: serializeKey(replacementResult.rows[0]), token: generated.token })
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the generic error response without exposing database details.
      }
      return sendKeyError(reply, error)
    } finally {
      client.release()
    }
  })

  app.post('/api/keys/validate', rateLimitConfig, async (request, reply) => {
    const parsed = validateKeySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    const digest = digestToken(parsed.data.token)
    const result = await pool.query<Pick<KeyRow, 'id' | 'user_id' | 'revoked_at' | 'expires_at'>>(
      `SELECT id, user_id, revoked_at, expires_at
       FROM api_keys
       WHERE key_digest = $1`,
      [digest],
    )
    const key = result.rows[0]
    const expired = Boolean(key?.expires_at && new Date(key.expires_at).getTime() <= Date.now())
    if (!key || key.revoked_at !== null || expired) {
      return reply.send({ valid: false })
    }

    await pool.query(
      `UPDATE api_keys SET last_used_at = now(), updated_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [key.id],
    )
    await recordAuditEvent(pool, 'api_key.validated', request, key.user_id, { keyId: key.id })
    return reply.send({ valid: true, keyId: key.id })
  })
}
