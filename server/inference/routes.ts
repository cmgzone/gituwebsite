import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'

import { requireUser } from '../auth/routes.js'
import { decryptProviderSecret } from '../security/crypto.js'
import {
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ProviderUpstreamError,
  requestProviderCompletion,
} from './adapter.js'
import { chatRequestSchema, extractUsage, type ChatRequest } from './contracts.js'

type InferenceRow = {
  model_id: string
  provider_id: string
  provider_model_id: string
  base_url: string
  credential_nonce: Buffer
  credential_ciphertext: Buffer
  credential_auth_tag: Buffer
}

type UsageInput = {
  requestId: string
  userId: string | null
  providerId: string | null
  modelId: string | null
  status: string
  upstreamStatus?: number | null
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number | null
  errorCode?: string | null
}

async function recordUsage(pool: pg.Pool, usage: UsageInput): Promise<void> {
  await pool.query(
    `INSERT INTO inference_usage
      (id, request_id, user_id, provider_id, model_id, status, upstream_status,
       prompt_tokens, completion_tokens, total_tokens, latency_ms, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      randomUUID(), usage.requestId, usage.userId, usage.providerId, usage.modelId,
      usage.status, usage.upstreamStatus ?? null, usage.promptTokens ?? 0,
      usage.completionTokens ?? 0, usage.totalTokens ?? 0, usage.latencyMs ?? null,
      usage.errorCode ?? null,
    ],
  )
}

function requestBody(value: unknown): ChatRequest | null {
  const parsed = chatRequestSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

async function resolveInference(
  pool: pg.Pool,
  userId: string,
  modelId: string,
): Promise<InferenceRow | null> {
  const result = await pool.query<InferenceRow>(
    `SELECT m.id AS model_id, p.id AS provider_id, m.provider_model_id,
            p.base_url, p.credential_nonce, p.credential_ciphertext,
            p.credential_auth_tag
       FROM models m
       INNER JOIN providers p ON p.id = m.provider_id
       INNER JOIN client_model_entitlements e ON e.model_id = m.id
      WHERE m.id = $1 AND e.user_id = $2
        AND m.enabled = true AND p.enabled = true AND e.enabled = true
      LIMIT 1`,
    [modelId, userId],
  )
  return result.rows[0] ?? null
}

async function safeRecordUsage(pool: pg.Pool, usage: UsageInput): Promise<void> {
  try { await recordUsage(pool, usage) } catch { /* telemetry must not expose or alter request errors */ }
}

export async function registerInferenceRoutes(app: FastifyInstance, pool: pg.Pool): Promise<void> {
  app.post('/api/chat/completions', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireUser(pool, request, reply)
    if (!user) return

    const requestId = randomUUID()
    const startedAt = Date.now()
    const body = requestBody(request.body)
    if (!body) {
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: null, modelId: null,
        status: 'rejected', latencyMs: Date.now() - startedAt, errorCode: 'invalid_request',
      })
      return reply.code(400).send({ error: 'invalid_request' })
    }

    let resolved: InferenceRow | null
    try {
      resolved = await resolveInference(pool, user.id, body.model)
    } catch {
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: null, modelId: body.model,
        status: 'failed', latencyMs: Date.now() - startedAt, errorCode: 'model_resolution_failed',
      })
      return reply.code(500).send({ error: 'inference_failed' })
    }

    if (!resolved) {
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: null, modelId: body.model,
        status: 'rejected', latencyMs: Date.now() - startedAt, errorCode: 'model_not_available',
      })
      return reply.code(404).send({ error: 'model_not_available' })
    }

    let credential: string
    try {
      credential = decryptProviderSecret({
        nonce: resolved.credential_nonce,
        ciphertext: resolved.credential_ciphertext,
        authTag: resolved.credential_auth_tag,
      })
    } catch {
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: resolved.provider_id, modelId: resolved.model_id,
        status: 'failed', latencyMs: Date.now() - startedAt, errorCode: 'provider_credential_unavailable',
      })
      return reply.code(503).send({ error: 'provider_unavailable' })
    }

    try {
      const completion = await requestProviderCompletion({
        baseUrl: resolved.base_url,
        credential,
        model: resolved.provider_model_id,
        messages: body.messages,
        maxTokens: body.max_tokens,
      })
      const usage = extractUsage(completion.response)
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: resolved.provider_id, modelId: resolved.model_id,
        status: 'succeeded', upstreamStatus: completion.upstreamStatus,
        promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens, latencyMs: Date.now() - startedAt,
      })
      return reply.send(completion.response)
    } catch (error) {
      let statusCode = 502
      let errorCode = 'provider_error'
      let upstreamStatus: number | null = null
      if (error instanceof ProviderTimeoutError) {
        statusCode = 504
        errorCode = 'provider_timeout'
      } else if (error instanceof ProviderUnavailableError) {
        statusCode = 503
        errorCode = 'provider_unavailable'
      } else if (error instanceof ProviderResponseError) {
        errorCode = 'provider_invalid_response'
      } else if (error instanceof ProviderUpstreamError) {
        upstreamStatus = error.upstreamStatus
      }
      await safeRecordUsage(pool, {
        requestId, userId: user.id, providerId: resolved.provider_id, modelId: resolved.model_id,
        status: 'failed', upstreamStatus, latencyMs: Date.now() - startedAt, errorCode,
      })
      return reply.code(statusCode).send({ error: errorCode })
    }
  })
}
