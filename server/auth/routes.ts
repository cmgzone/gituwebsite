import { randomUUID } from 'node:crypto'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'
import type pg from 'pg'
import { z } from 'zod'

import {
  createSession,
  getSessionUser,
  revokeSession,
  type SessionUser,
} from './session.js'
import { hashPassword, verifyPassword } from '../security/crypto.js'

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(200),
})

type UserRow = {
  id: string
  email: string
  password_hash: string
}

type AuditEventType =
  | 'auth.registered'
  | 'auth.bootstrap_completed'
  | 'auth.logged_in'
  | 'auth.logged_out'
  | 'api_key.created'
  | 'api_key.renamed'
  | 'api_key.revoked'
  | 'api_key.rotated'
  | 'api_key.validated'
  | 'provider.created'
  | 'provider.updated'
  | 'provider.enabled'
  | 'provider.disabled'
  | 'provider.deleted'
  | 'model.created'
  | 'model.updated'
  | 'model.enabled'
  | 'model.disabled'
  | 'model.deleted'
  | 'entitlement.updated'

type AuditMetadata = Record<string, string | number | boolean | null>

function parseCredentials(body: unknown) {
  return credentialsSchema.safeParse(body)
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}

export async function recordAuditEvent(
  pool: pg.Pool,
  eventType: AuditEventType,
  request: FastifyRequest,
  userId: string | null,
  metadata: AuditMetadata = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events
      (id, actor_user_id, target_user_id, event_type, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      randomUUID(),
      userId,
      userId,
      eventType,
      JSON.stringify(metadata),
      request.ip,
    ],
  )
}

export async function requireUser(
  pool: pg.Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await getSessionUser(pool, request)

  if (!user) {
    reply.code(401).send({ error: 'authentication_required' })
    return null
  }

  return user
}

export async function requireAdmin(
  pool: pg.Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await requireUser(pool, request, reply)

  if (!user) {
    return null
  }

  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'admin_required' })
    return null
  }

  return user
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = parseCredentials(request.body)

    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    const passwordHash = await hashPassword(parsed.data.password)
    const userId = randomUUID()

    try {
      await pool.query(
        `INSERT INTO users (id, email, email_normalized, password_hash)
         VALUES ($1, $2, $3, $4)`,
        [userId, parsed.data.email, parsed.data.email, passwordHash],
      )
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'account_unavailable' })
      }

      throw error
    }

    await createSession(pool, userId, request, reply)
    await recordAuditEvent(pool, 'auth.registered', request, userId)

    return reply.code(201).send({
      user: {
        id: userId,
        email: parsed.data.email,
      },
    })
  })

  app.post('/api/auth/bootstrap-admin', async (request, reply) => {
    const parsed = parseCredentials(request.body)

    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET
    const presentedSecret = request.headers['x-admin-bootstrap-secret']

    if (!configuredSecret || configuredSecret.length < 32) {
      return reply.code(503).send({ error: 'admin_bootstrap_unavailable' })
    }

    if (typeof presentedSecret !== 'string' || presentedSecret !== configuredSecret) {
      return reply.code(403).send({ error: 'admin_bootstrap_forbidden' })
    }

    const passwordHash = await hashPassword(parsed.data.password)
    const userId = randomUUID()

    try {
      const result = await pool.query<{
        id: string
        email: string
        role: 'admin'
      }>(
        `WITH bootstrap_lock AS (
           SELECT pg_advisory_xact_lock(hashtext('gitu:first-admin-bootstrap'))
         ), created_user AS (
           INSERT INTO users (id, email, email_normalized, password_hash, role)
           SELECT $1, $2, $2, $3, 'admin'
           FROM bootstrap_lock
           WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
           RETURNING id, email, role
         )
         SELECT id, email, role FROM created_user`,
        [userId, parsed.data.email, passwordHash],
      )

      const admin = result.rows[0]

      if (!admin) {
        return reply.code(409).send({ error: 'admin_bootstrap_already_completed' })
      }

      await recordAuditEvent(pool, 'auth.bootstrap_completed', request, admin.id)

      return reply.code(201).send({
        user: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'admin_bootstrap_email_conflict' })
      }

      throw error
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = parseCredentials(request.body)

    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' })
    }

    const result = await pool.query<UserRow>(
      `SELECT id, email, password_hash
       FROM users
       WHERE email_normalized = $1
       LIMIT 1`,
      [parsed.data.email],
    )
    const user = result.rows[0]

    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }

    await pool.query(
      `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
      [user.id],
    )
    await createSession(pool, user.id, request, reply)
    await recordAuditEvent(pool, 'auth.logged_in', request, user.id)

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
      },
    })
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const user = await getSessionUser(pool, request)
    await revokeSession(pool, request, reply)

    if (user) {
      await recordAuditEvent(pool, 'auth.logged_out', request, user.id)
    }

    return reply.send({ ok: true })
  })

  app.get('/api/auth/me', async (request, reply) => {
    const user = await requireUser(pool, request, reply)

    if (!user) {
      return
    }

    return reply.send({ user })
  })
}
