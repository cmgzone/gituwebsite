import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { digestToken } from '../security/crypto.js'

const adminId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const providerId = '33333333-3333-4333-8333-333333333333'
const modelId = '44444444-4444-4444-8444-444444444444'
const adminToken = 'admin-session-token'
const userToken = 'user-session-token'

type SessionUser = { id: string; email: string; role: 'user' | 'admin' }
type ModelRow = {
  id: string
  provider_id: string
  provider_model_id: string
  display_name: string
  description: string
  context_window: number
  max_output_tokens: number
  input_price_micros: number
  output_price_micros: number
  metadata: Record<string, unknown>
  enabled: boolean
  provider_name: string
  provider_kind: string
  provider_enabled: boolean
  created_at: Date
  updated_at: Date
}
type ClientModelRow = ModelRow & { entitlement_enabled: boolean }
type Result<T> = { rows: T[] }

type EntitlementRow = {
  user_id: string
  model_id: string
  enabled: boolean
  updated_at: Date
}

function valueKey(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  return String(value)
}

function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  const now = new Date('2026-09-01T00:00:00.000Z')
  return {
    id: modelId,
    provider_id: providerId,
    provider_model_id: 'deepseek-chat',
    display_name: 'DeepSeek Chat',
    description: 'A test model',
    context_window: 128000,
    max_output_tokens: 4096,
    input_price_micros: 140,
    output_price_micros: 280,
    metadata: { family: 'deepseek' },
    enabled: true,
    provider_name: 'DeepSeek',
    provider_kind: 'deepseek',
    provider_enabled: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

class MemoryPool {
  sessionUser: SessionUser = { id: adminId, email: 'admin@example.com', role: 'admin' }
  readonly models: ModelRow[] = [modelRow()]
  readonly clientModels: ClientModelRow[] = [{ ...modelRow(), entitlement_enabled: true }]
  readonly entitlements: EntitlementRow[] = []
  readonly audits: Array<{ eventType: string; userId: string | null }> = []
  ended = false

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<Result<T>> {
    const statement = sql.replace(/\s+/g, ' ').trim()

    if (statement.startsWith('SELECT users.id, users.email, users.role FROM sessions')) {
      const tokenHash = valueKey(values[0])
      const expectedToken = this.sessionUser.id === adminId ? adminToken : userToken
      const expectedHash = valueKey(digestToken(expectedToken))
      return { rows: tokenHash === expectedHash ? [this.sessionUser as T] : [] }
    }

    if (statement.startsWith('SELECT m.id, m.provider_id, m.provider_model_id')) {
      if (statement.includes('e.enabled AS entitlement_enabled')) return { rows: this.clientModels as T[] }
      if (statement.includes('WHERE m.id = $1')) {
        const row = this.models.find((candidate) => candidate.id === String(values[0]))
        return { rows: row ? [row as T] : [] }
      }
      return { rows: this.models as T[] }
    }

    if (statement.startsWith('INSERT INTO models')) {
      const now = new Date('2026-09-01T00:00:00.000Z')
      const created = modelRow({
        id: String(values[0]),
        provider_id: String(values[1]),
        provider_model_id: String(values[2]),
        display_name: String(values[3]),
        description: String(values[4]),
        context_window: Number(values[5]),
        max_output_tokens: Number(values[6]),
        input_price_micros: Number(values[7]),
        output_price_micros: Number(values[8]),
        metadata: JSON.parse(String(values[9])),
        enabled: Boolean(values[10]),
        created_at: now,
        updated_at: now,
      })
      this.models.unshift(created)
      return { rows: [created as T] }
    }

    if (statement.startsWith('UPDATE models')) {
      const id = String(values[0])
      const row = this.models.find((candidate) => candidate.id === id)
      if (!row) return { rows: [] }
      if (statement.includes('SET enabled')) row.enabled = Boolean(values[1])
      if (statement.includes('display_name')) row.display_name = String(values[1])
      row.updated_at = new Date('2026-09-01T00:00:00.000Z')
      return { rows: [row as T] }
    }

    if (statement.startsWith('DELETE FROM models')) {
      const id = String(values[0])
      const index = this.models.findIndex((candidate) => candidate.id === id)
      if (index < 0) return { rows: [] }
      this.models.splice(index, 1)
      return { rows: [{ id } as T] }
    }

    if (statement.startsWith('INSERT INTO client_model_entitlements')) {
      const entitlement: EntitlementRow = {
        user_id: String(values[0]),
        model_id: String(values[1]),
        enabled: Boolean(values[2]),
        updated_at: new Date('2026-09-01T00:00:00.000Z'),
      }
      this.entitlements.push(entitlement)
      return { rows: [entitlement as T] }
    }

    if (statement.startsWith('INSERT INTO audit_events')) return { rows: [] }

    throw new Error(`Unexpected SQL in model route test: ${statement}`)
  }

  async end(): Promise<void> {
    this.ended = true
  }
}

describe('model routes', () => {
  let pool: MemoryPool

  beforeEach(() => {
    pool = new MemoryPool()
  })

  it('lists models for admins and serializes provider metadata', async () => {
    const app = await createApp(pool as never)

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/models',
      headers: { cookie: `gitu_session=${adminToken}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      models: [{
        id: modelId,
        providerId,
        providerModelId: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        description: 'A test model',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputPriceMicros: 140,
        outputPriceMicros: 280,
        metadata: { family: 'deepseek' },
        enabled: true,
        provider: { name: 'DeepSeek', kind: 'deepseek', enabled: true },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
    })

    await app.close()
    expect(pool.ended).toBe(true)
  })

  it('supports admin create, read, edit, availability, and delete lifecycle', async () => {
    const app = await createApp(pool as never)
    const headers = { cookie: `gitu_session=${adminToken}` }

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/models',
      headers,
      payload: {
        providerId,
        providerModelId: 'deepseek-reasoner',
        displayName: 'DeepSeek Reasoner',
        description: 'Reasoning model',
        contextWindow: 64000,
        maxOutputTokens: 8192,
        inputPriceMicros: 550,
        outputPriceMicros: 1100,
        metadata: { family: 'deepseek' },
        enabled: false,
      },
    })
    expect(created.statusCode).toBe(201)
    const createdModel = created.json().model
    expect(createdModel.providerModelId).toBe('deepseek-reasoner')
    expect(createdModel.enabled).toBe(false)

    const read = await app.inject({ method: 'GET', url: `/api/admin/models/${createdModel.id}`, headers })
    expect(read.statusCode).toBe(200)
    expect(read.json().model.id).toBe(createdModel.id)

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/models/${createdModel.id}`,
      headers,
      payload: { displayName: 'DeepSeek Reasoner Updated' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().model.displayName).toBe('DeepSeek Reasoner Updated')

    const enabled = await app.inject({ method: 'POST', url: `/api/admin/models/${createdModel.id}/enable`, headers })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().model.enabled).toBe(true)

    const disabled = await app.inject({ method: 'POST', url: `/api/admin/models/${createdModel.id}/disable`, headers })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json().model.enabled).toBe(false)

    const deleted = await app.inject({ method: 'DELETE', url: `/api/admin/models/${createdModel.id}`, headers })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ ok: true })
    await app.close()
  })

  it('returns only the authenticated client models and updates entitlements', async () => {
    const app = await createApp(pool as never)
    pool.sessionUser = { id: userId, email: 'user@example.com', role: 'user' }

    const clientList = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { cookie: `gitu_session=${userToken}` },
    })
    expect(clientList.statusCode).toBe(200)
    expect(clientList.json().models).toHaveLength(1)
    expect(clientList.json().models[0].id).toBe(modelId)

    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/models',
      headers: { cookie: `gitu_session=${userToken}` },
    })
    expect(denied.statusCode).toBe(403)

    pool.sessionUser = { id: adminId, email: 'admin@example.com', role: 'admin' }
    const entitlement = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-entitlements',
      headers: { cookie: `gitu_session=${adminToken}` },
      payload: { userId, modelId, enabled: true },
    })
    expect(entitlement.statusCode).toBe(200)
    expect(entitlement.json().entitlement).toMatchObject({ user_id: userId, model_id: modelId, enabled: true })

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/admin/model-entitlements',
      headers: { cookie: `gitu_session=${adminToken}` },
      payload: { userId, modelId, unexpected: true },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error).toBe('invalid_entitlement')

    await app.close()
  })

  it('rejects invalid model identifiers and strict model payloads', async () => {
    const app = await createApp(pool as never)
    const headers = { cookie: `gitu_session=${adminToken}` }

    const invalidId = await app.inject({ method: 'GET', url: '/api/admin/models/not-a-uuid', headers })
    expect(invalidId.statusCode).toBe(400)
    expect(invalidId.json().error).toBe('invalid_model_id')

    const invalidPayload = await app.inject({
      method: 'POST',
      url: '/api/admin/models',
      headers,
      payload: { providerId, providerModelId: 'deepseek-chat', displayName: 'DeepSeek Chat', unexpected: true },
    })
    expect(invalidPayload.statusCode).toBe(400)
    expect(invalidPayload.json().error).toBe('invalid_model')

    await app.close()
  })
})
