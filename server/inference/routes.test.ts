import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../app.js'
import { digestToken, encryptProviderSecret } from '../security/crypto.js'
import { ProviderTimeoutError, normalizeProviderBaseUrl } from './adapter.js'

const userId = '22222222-2222-4222-8222-222222222222'
const modelId = '33333333-3333-4333-8333-333333333333'
const userToken = 'user-session-token'
const providerSecret = 'server-only-provider-secret'

class InferencePool {
  readonly usage: Array<Record<string, unknown>> = []
  readonly row: Record<string, unknown>
  entitled = true

  constructor() {
    const encrypted = encryptProviderSecret(providerSecret)
    this.row = {
      model_id: modelId,
      provider_id: '44444444-4444-4444-8444-444444444444',
      provider_model_id: 'provider/model-1',
      base_url: 'https://provider.example/v1/',
      credential_nonce: encrypted.nonce,
      credential_ciphertext: encrypted.ciphertext,
      credential_auth_tag: encrypted.authTag,
    }
  }

  async end(): Promise<void> {}

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    const statement = sql.replace(/\s+/g, ' ').trim()
    if (statement.startsWith('SELECT users.id, users.email, users.role FROM sessions')) {
      return { rows: valueKey(values[0]) === valueKey(digestToken(userToken))
        ? [{ id: userId, email: 'user@example.com', role: 'user' } as T] : [] }
    }
    if (statement.startsWith('SELECT m.id AS model_id')) {
      return { rows: this.entitled ? [this.row as T] : [] }
    }
    if (statement.startsWith('INSERT INTO inference_usage')) {
      this.usage.push({ values })
      return { rows: [] }
    }
    return { rows: [] }
  }
}

function valueKey(value: unknown): string {
  return Buffer.isBuffer(value) ? value.toString('hex') : String(value)
}

beforeEach(() => {
  process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
  vi.restoreAllMocks()
})

describe('inference route', () => {
  it('resolves the entitled model and keeps provider credentials server-side', async () => {
    const pool = new InferencePool()
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'completion-1',
      choices: [{ message: { role: 'assistant', content: 'hello' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), { status: 200 }))
    const app = await createApp(pool as never)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      headers: { cookie: `gitu_session=${userToken}` },
      payload: { model: modelId, messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().choices[0].message.content).toBe('hello')
    expect(upstream).toHaveBeenCalledOnce()
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://provider.example/v1/chat/completions')
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${providerSecret}`)
    expect(JSON.stringify(init?.body)).not.toContain(providerSecret)
    expect(pool.usage[0].values).toContain(5)
    await app.close()
  })

  it('rejects an authenticated user without an enabled entitlement', async () => {
    const pool = new InferencePool()
    pool.entitled = false
    const upstream = vi.spyOn(globalThis, 'fetch')
    const app = await createApp(pool as never)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/completions',
      headers: { cookie: `gitu_session=${userToken}` },
      payload: { model: modelId, messages: [{ role: 'user', content: 'hello' }] },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'model_not_available' })
    expect(upstream).not.toHaveBeenCalled()
    await app.close()
  })

  it('normalizes timeout failures without returning upstream details', async () => {
    expect(normalizeProviderBaseUrl('https://provider.example/v1/')).toBe('https://provider.example/v1')
    expect(new ProviderTimeoutError().message).toBe('Provider request timed out')
  })
})
