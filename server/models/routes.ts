import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'
import { z } from 'zod'

import { recordAuditEvent, requireAdmin, requireUser } from '../auth/routes.js'

const uuidSchema = z.string().uuid()
const nonNegativeInt = z.number().int().nonnegative().max(2_147_483_647)
const nonNegativePrice = z.number().int().nonnegative().max(9_000_000_000_000_000)
const metadataSchema = z.record(z.string(), z.unknown()).default({})

const modelCreateSchema = z
  .object({
    providerId: uuidSchema,
    providerModelId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(120),
    description: z.string().max(10_000).default(''),
    contextWindow: nonNegativeInt.default(0),
    maxOutputTokens: nonNegativeInt.default(0),
    inputPriceMicros: nonNegativePrice.default(0),
    outputPriceMicros: nonNegativePrice.default(0),
    metadata: metadataSchema,
    enabled: z.boolean().default(false),
  })
  .strict()

const modelUpdateSchema = z
  .object({
    providerId: uuidSchema.optional(),
    providerModelId: z.string().trim().min(1).max(160).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(10_000).optional(),
    contextWindow: nonNegativeInt.optional(),
    maxOutputTokens: nonNegativeInt.optional(),
    inputPriceMicros: nonNegativePrice.optional(),
    outputPriceMicros: nonNegativePrice.optional(),
    metadata: metadataSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty_update')

const entitlementSchema = z
  .object({
    userId: uuidSchema,
    modelId: uuidSchema,
    enabled: z.boolean().default(true),
  })
  .strict()

type ModelRow = {
  id: string
  provider_id: string
  provider_model_id: string
  display_name: string
  description: string
  context_window: number
  max_output_tokens: number
  input_price_micros: number | string
  output_price_micros: number | string
  metadata: Record<string, unknown>
  enabled: boolean
  provider_name: string
  provider_kind: string
  provider_enabled: boolean
  created_at: Date | string
  updated_at: Date | string
}

type ClientModelRow = ModelRow & { entitlement_enabled: boolean }

const rateLimitConfig = { max: 30, timeWindow: '1 minute' }

const modelColumns = `
  m.id,
  m.provider_id,
  m.provider_model_id,
  m.display_name,
  m.description,
  m.context_window,
  m.max_output_tokens,
  m.input_price_micros,
  m.output_price_micros,
  m.metadata,
  m.enabled,
  p.name AS provider_name,
  p.provider_kind,
  p.enabled AS provider_enabled,
  m.created_at,
  m.updated_at
`

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function serializeModel(row: ModelRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    description: row.description,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    inputPriceMicros: Number(row.input_price_micros),
    outputPriceMicros: Number(row.output_price_micros),
    metadata: row.metadata,
    enabled: row.enabled,
    provider: {
      name: row.provider_name,
      kind: row.provider_kind,
      enabled: row.provider_enabled,
    },
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }
}

function modelId(request: FastifyRequest, reply: FastifyReply): string | null {
  const id = (request.params as { id?: unknown } | undefined)?.id
  if (typeof id !== 'string' || !uuidSchema.safeParse(id).success) {
    reply.code(400).send({ error: 'invalid_model_id' })
    return null
  }
  return id
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code
}

async function adminUser(pool: pg.Pool, request: FastifyRequest, reply: FastifyReply) {
  return requireAdmin(pool, request, reply)
}

export async function registerModelRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.get('/api/admin/models', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return

    try {
      const result = await pool.query<ModelRow>(
        `SELECT ${modelColumns}
         FROM models m
         INNER JOIN providers p ON p.id = m.provider_id
         ORDER BY m.created_at DESC, m.id DESC`,
      )
      return reply.send({ models: result.rows.map(serializeModel) })
    } catch {
      return reply.code(500).send({ error: 'model_list_failed' })
    }
  })

  app.get('/api/admin/models/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const id = modelId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<ModelRow>(
        `SELECT ${modelColumns}
         FROM models m
         INNER JOIN providers p ON p.id = m.provider_id
         WHERE m.id = $1`,
        [id],
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'model_not_found' })
      return reply.send({ model: serializeModel(result.rows[0]) })
    } catch {
      return reply.code(500).send({ error: 'model_read_failed' })
    }
  })

  app.post('/api/admin/models', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const parsed = modelCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_model', issues: parsed.error.issues })

    const data = parsed.data
    const id = randomUUID()
    try {
      const result = await pool.query<ModelRow>(
        `INSERT INTO models (
          id, provider_id, provider_model_id, display_name, description, context_window,
          max_output_tokens, input_price_micros, output_price_micros, metadata, enabled
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
        RETURNING ${modelColumns}`,
        [
          id,
          data.providerId,
          data.providerModelId,
          data.displayName,
          data.description,
          data.contextWindow,
          data.maxOutputTokens,
          data.inputPriceMicros,
          data.outputPriceMicros,
          JSON.stringify(data.metadata),
          data.enabled,
        ],
      )
      await recordAuditEvent(pool, 'model.created', request, admin.id, { modelId: id, providerId: data.providerId })
      return reply.code(201).send({ model: serializeModel(result.rows[0]) })
    } catch (error) {
      if (isErrorCode(error, '23503')) return reply.code(400).send({ error: 'provider_not_found' })
      if (isErrorCode(error, '23505')) return reply.code(409).send({ error: 'provider_model_conflict' })
      return reply.code(500).send({ error: 'model_create_failed' })
    }
  })

  app.patch('/api/admin/models/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const id = modelId(request, reply)
    if (!id) return
    const parsed = modelUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_model_update', issues: parsed.error.issues })

    const values: unknown[] = [id]
    const assignments: string[] = []
    const data = parsed.data
    const add = (column: string, value: unknown, cast = '') => {
      values.push(cast ? `${value}` : value)
      assignments.push(`${column} = $${values.length}${cast}`)
    }

    if (data.providerId !== undefined) add('provider_id', data.providerId)
    if (data.providerModelId !== undefined) add('provider_model_id', data.providerModelId)
    if (data.displayName !== undefined) add('display_name', data.displayName)
    if (data.description !== undefined) add('description', data.description)
    if (data.contextWindow !== undefined) add('context_window', data.contextWindow)
    if (data.maxOutputTokens !== undefined) add('max_output_tokens', data.maxOutputTokens)
    if (data.inputPriceMicros !== undefined) add('input_price_micros', data.inputPriceMicros)
    if (data.outputPriceMicros !== undefined) add('output_price_micros', data.outputPriceMicros)
    if (data.metadata !== undefined) add('metadata', JSON.stringify(data.metadata), '::jsonb')
    if (data.enabled !== undefined) add('enabled', data.enabled)
    assignments.push('updated_at = now()')

    try {
      const result = await pool.query<ModelRow>(
        `UPDATE models m SET ${assignments.join(', ')}
         FROM providers p
         WHERE m.provider_id = p.id AND m.id = $1
         RETURNING ${modelColumns}`,
        values,
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'model_not_found' })
      await recordAuditEvent(pool, 'model.updated', request, admin.id, { modelId: id })
      return reply.send({ model: serializeModel(result.rows[0]) })
    } catch (error) {
      if (isErrorCode(error, '23503')) return reply.code(400).send({ error: 'provider_not_found' })
      if (isErrorCode(error, '23505')) return reply.code(409).send({ error: 'provider_model_conflict' })
      return reply.code(500).send({ error: 'model_update_failed' })
    }
  })

  async function setEnabled(request: FastifyRequest, reply: FastifyReply, enabled: boolean): Promise<unknown> {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const id = modelId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<ModelRow>(
        `UPDATE models m SET enabled = $2, updated_at = now()
         FROM providers p
         WHERE m.provider_id = p.id AND m.id = $1
         RETURNING ${modelColumns}`,
        [id, enabled],
      )
      if (!result.rows[0]) return reply.code(404).send({ error: 'model_not_found' })
      await recordAuditEvent(pool, enabled ? 'model.enabled' : 'model.disabled', request, admin.id, { modelId: id })
      return reply.send({ model: serializeModel(result.rows[0]) })
    } catch {
      return reply.code(500).send({ error: 'model_status_update_failed' })
    }
  }

  app.post('/api/admin/models/:id/enable', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => setEnabled(request, reply, true))
  app.post('/api/admin/models/:id/disable', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => setEnabled(request, reply, false))

  app.delete('/api/admin/models/:id', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const id = modelId(request, reply)
    if (!id) return

    try {
      const result = await pool.query<{ id: string }>('DELETE FROM models WHERE id = $1 RETURNING id', [id])
      if (!result.rows[0]) return reply.code(404).send({ error: 'model_not_found' })
      await recordAuditEvent(pool, 'model.deleted', request, admin.id, { modelId: id })
      return reply.send({ ok: true })
    } catch {
      return reply.code(500).send({ error: 'model_delete_failed' })
    }
  })

  app.get('/api/models', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    try {
      const result = await pool.query<ClientModelRow>(
        `SELECT ${modelColumns}, e.enabled AS entitlement_enabled
         FROM client_model_entitlements e
         INNER JOIN models m ON m.id = e.model_id
         INNER JOIN providers p ON p.id = m.provider_id
         WHERE e.user_id = $1
           AND e.enabled = true
           AND m.enabled = true
           AND p.enabled = true
         ORDER BY m.display_name ASC, m.id ASC`,
        [user.id],
      )
      return reply.send({ models: result.rows.map(serializeModel) })
    } catch {
      return reply.code(500).send({ error: 'model_list_failed' })
    }
  })

  app.put('/api/admin/model-entitlements', { config: { rateLimit: rateLimitConfig } }, async (request, reply) => {
    const admin = await adminUser(pool, request, reply)
    if (!admin) return
    const parsed = entitlementSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_entitlement', issues: parsed.error.issues })

    const data = parsed.data
    try {
      const result = await pool.query<{ user_id: string; model_id: string; enabled: boolean; updated_at: Date | string }>(
        `INSERT INTO client_model_entitlements (user_id, model_id, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, model_id) DO UPDATE
         SET enabled = EXCLUDED.enabled, updated_at = now()
         RETURNING user_id, model_id, enabled, updated_at`,
        [data.userId, data.modelId, data.enabled],
      )
      await recordAuditEvent(pool, 'entitlement.updated', request, admin.id, {
        userId: data.userId,
        modelId: data.modelId,
        enabled: data.enabled,
      })
      return reply.send({ entitlement: result.rows[0] })
    } catch (error) {
      if (isErrorCode(error, '23503')) return reply.code(400).send({ error: 'user_or_model_not_found' })
      return reply.code(500).send({ error: 'entitlement_update_failed' })
    }
  })
}
