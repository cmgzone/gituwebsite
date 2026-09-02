import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'

import { recordAuditEvent, requireAdmin } from '../auth/routes.js'
import { encryptProviderSecret } from '../security/crypto.js'

const providerKindSchema = z.enum(['openrouter', 'deepseek', 'alibaba', 'openai_compatible'])

const baseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash
  }, 'base_url_must_be_http_without_credentials_or_query')

const providerCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_must_be_kebab_case'),
    providerKind: providerKindSchema,
    baseUrl: baseUrlSchema,
    credential: z.string().min(1).max(10_000),
    enabled: z.boolean().default(true),
  })
  .strict()

const providerUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_must_be_kebab_case').optional(),
    providerKind: providerKindSchema.optional(),
    baseUrl: baseUrlSchema.optional(),
    credential: z.string().min(1).max(10_000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty_update')

type ProviderKind = z.infer<typeof providerKindSchema>

type ProviderRow = {
  id: string
  name: string
  slug: string
  provider_kind: ProviderKind
  base_url: string
  has_credential: boolean
  enabled: boolean
  created_at: Date | string
  updated_at: Date | string
}

type ProviderResponse = {
  id: string
  name: string
  slug: string
  providerKind: ProviderKind
  baseUrl: string
  enabled: boolean
  hasCredential: boolean
  createdAt: string
  updatedAt: string
}

const rateLimitConfig = {
  max: 30,
  timeWindow: '1 minute',
}

const providerColumns = `
  id,
  name,
  slug,
  provider_kind,
  base_url,
  credential_nonce IS NOT NULL AS has_credential,
  enabled,
  created_at,
  updated_at
`

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function serializeProvider(row: ProviderRow): ProviderResponse {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    providerKind: row.provider_kind,
    baseUrl: row.base_url,
    enabled: row.enabled,
    hasCredential: row.has_credential,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'
}

function providerId(request: FastifyRequest, reply: FastifyReply): string | null {
  const id = (request.params as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string' || !z.string().uuid().safeParse(id).success) {
    reply.code(400).send({ error: 'invalid_provider_id' })
    return null
  }
  return id
}

async function requireAdminUser(
  pool: pg.Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string } | null> {
  return requireAdmin(pool, request, reply)
}

export async function registerProviderRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/api/admin/providers', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return

    try {
      const result = await pool.query<ProviderRow>(
        `SELECT ${providerColumns} FROM providers ORDER BY created_at DESC, id DESC`,
      )
      return reply.send({ providers: result.rows.map(serializeProvider) })
    } catch {
      return reply.code(500).send({ error: 'provider_list_failed' })
    }
  })

  app.get('/api/admin/providers/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return
    const id = providerId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<ProviderRow>(
        `SELECT ${providerColumns} FROM providers WHERE id = $1`,
        [id],
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'provider_not_found' })
      return reply.send({ provider: serializeProvider(result.rows[0]) })
    } catch {
      return reply.code(500).send({ error: 'provider_read_failed' })
    }
  })

  app.post('/api/admin/providers', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return

    const parsed = providerCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_provider', issues: parsed.error.issues })

    const id = randomUUID()
    const baseUrl = normalizeBaseUrl(parsed.data.baseUrl)
    const encrypted = encryptProviderSecret(parsed.data.credential)

    try {
      const result = await pool.query<ProviderRow>(
        `INSERT INTO providers (
          id, name, slug, provider_kind, base_url, credential_nonce, credential_ciphertext, credential_auth_tag, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING ${providerColumns}`,
        [
          id,
          parsed.data.name,
          parsed.data.slug,
          parsed.data.providerKind,
          baseUrl,
          encrypted.nonce,
          encrypted.ciphertext,
          encrypted.authTag,
          parsed.data.enabled,
        ],
      )
      await recordAuditEvent(pool, 'provider.created', request, admin.id, { providerId: id, slug: parsed.data.slug })
      return reply.code(201).send({ provider: serializeProvider(result.rows[0]) })
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'provider_slug_conflict' })
      return reply.code(500).send({ error: 'provider_create_failed' })
    }
  })

  app.patch('/api/admin/providers/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return
    const id = providerId(request, reply)
    if (!id) return

    const parsed = providerUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_provider_update', issues: parsed.error.issues })

    const values: unknown[] = [id]
    const assignments: string[] = []
    const data = parsed.data

    if (data.name !== undefined) {
      values.push(data.name)
      assignments.push(`name = $${values.length}`)
    }
    if (data.slug !== undefined) {
      values.push(data.slug)
      assignments.push(`slug = $${values.length}`)
    }
    if (data.providerKind !== undefined) {
      values.push(data.providerKind)
      assignments.push(`provider_kind = $${values.length}`)
    }
    if (data.baseUrl !== undefined) {
      values.push(normalizeBaseUrl(data.baseUrl))
      assignments.push(`base_url = $${values.length}`)
    }
    if (data.credential !== undefined) {
      const encrypted = encryptProviderSecret(data.credential)
      values.push(encrypted.nonce, encrypted.ciphertext, encrypted.authTag)
      assignments.push(`credential_nonce = $${values.length - 2}`, `credential_ciphertext = $${values.length - 1}`, `credential_auth_tag = $${values.length}`)
    }
    if (data.enabled !== undefined) {
      values.push(data.enabled)
      assignments.push(`enabled = $${values.length}`)
    }
    assignments.push('updated_at = now()')

    try {
      const result = await pool.query<ProviderRow>(
        `UPDATE providers SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${providerColumns}`,
        values,
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'provider_not_found' })
      await recordAuditEvent(pool, 'provider.updated', request, admin.id, { providerId: id })
      return reply.send({ provider: serializeProvider(result.rows[0]) })
    } catch (error) {
      if (isUniqueViolation(error)) return reply.code(409).send({ error: 'provider_slug_conflict' })
      return reply.code(500).send({ error: 'provider_update_failed' })
    }
  })

  async function setEnabled(
    request: FastifyRequest,
    reply: FastifyReply,
    enabled: boolean,
  ): Promise<unknown> {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return
    const id = providerId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<ProviderRow>(
        `UPDATE providers SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING ${providerColumns}`,
        [id, enabled],
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'provider_not_found' })
      await recordAuditEvent(pool, enabled ? 'provider.enabled' : 'provider.disabled', request, admin.id, { providerId: id })
      return reply.send({ provider: serializeProvider(result.rows[0]) })
    } catch {
      return reply.code(500).send({ error: 'provider_status_update_failed' })
    }
  }

  app.post('/api/admin/providers/:id/enable', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => setEnabled(request, reply, true))
  app.post('/api/admin/providers/:id/disable', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => setEnabled(request, reply, false))

  app.delete('/api/admin/providers/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await requireAdminUser(pool, request, reply)
    if (!admin) return
    const id = providerId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<{ id: string }>('DELETE FROM providers WHERE id = $1 RETURNING id', [id])
      if (!result.rows[0]) return reply.code(404).send({ error: 'provider_not_found' })
      await recordAuditEvent(pool, 'provider.deleted', request, admin.id, { providerId: id })
      return reply.send({ ok: true })
    } catch {
      return reply.code(500).send({ error: 'provider_delete_failed' })
    }
  })
}
