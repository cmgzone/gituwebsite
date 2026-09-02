import { beforeEach, describe, expect, it } from 'vitest'
import type pg from 'pg'

import { createApp } from '../app.js'
import { digestToken } from '../security/crypto.js'

const adminId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const providerId = '33333333-3333-4333-8333-333333333333'
const adminToken = 'admin-session-token'
const userToken = 'user-session-token'

type Provider = {
  id: string
  name: string
  slug: string
  provider_kind: 'openrouter' | 'deepseek' | 'alibaba' | 'openai_compatible'
  base_url: string
  credential_nonce: Buffer
  credential_ciphertext: Buffer
  credential_auth_tag: Buffer
  enabled: boolean
  created_at: Date
  updated_at: Date
}

type Result<T> = { rows: T[] }

type SessionUser = { id: string; email: string; role: 'user' | 'admin' }

function valueKey(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  return String(value)
}

function responseRow(provider: Provider) {
  return {
    id: provider.id,
    name: provider.name,
    slug: provider.slug,
    provider_kind: provider.provider_kind,
    base_url: provider.base_url,
    has_credential: provider.credential_nonce.length > 0,
    enabled: provider.enabled,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  }
}

class MemoryPool {
  readonly providers: Provider[] = []
  readonly audits: Array<{ eventType: string; userId: string | null }> = []
  readonly users: Record<string, SessionUser> = {
    [adminId]: { id: adminId, email: 'admin@example.com', role: 'admin' },
    [userId]: { id: userId, email: 'user@example.com', role: 'user' },
  }

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<Result<T>> {
    const statement = sql.replace(/\s+/g, ' ').trim()

    if (statement.startsWith('SELECT users.id, users.email, users.role FROM sessions')) {
      const tokenHash = valueKey(values[0])
      const session = tokenHash === valueKey(digestToken(adminToken))
        ? this.users[adminId]
        : tokenHash === valueKey(digestToken(userToken))
          ? this.users[userId]
          : undefined
      return { rows: session ? [session as T] : [] }
    }

    if (statement.startsWith('INSERT INTO audit_events')) {
      this.audits.push({ eventType: String(values[3]), userId: values[1] ? String(values[1]) : null })
      return { rows: [] }
    }

    if (statement.startsWith('SELECT id, name, slug, provider_kind, base_url')) {
      const rows = this.providers.map(responseRow) as T[]
      if (statement.includes('WHERE id = $1')) {
        return { rows: rows.filter((row) => String((row as { id: string }).id) === String(values[0])) }
      }
      return { rows }
    }

    if (statement.startsWith('INSERT INTO providers')) {
      const [id, name, slug, providerKind, baseUrl, nonce, ciphertext, authTag, enabled] = values
      const now = new Date()
      const provider: Provider = {
        id: String(id),
        name: String(name),
        slug: String(slug),
        provider_kind: providerKind as Provider['provider_kind'],
        base_url: String(baseUrl),
        credential_nonce: Buffer.from(nonce as Uint8Array),
        credential_ciphertext: Buffer.from(ciphertext as Uint8Array),
        credential_auth_tag: Buffer.from(authTag as Uint8Array),
        enabled: Boolean(enabled),
        created_at: now,
        updated_at: now,
      }
      if (this.providers.some((candidate) => candidate.slug === provider.slug)) {
        const error = new Error('duplicate slug') as Error & { code: string }
        error.code = '23505'
        throw error
      }
      this.providers.push(provider)
      return { rows: [responseRow(provider)] as T[] }
    }

    if (statement.startsWith('UPDATE providers SET')) {
      const id = String(values[0])
      const provider = this.providers.find((candidate) => candidate.id === id)
      if (!provider) return { rows: [] }
      if (statement.includes('enabled = $2')) provider.enabled = Boolean(values[1])
      if (statement.includes('name = $2')) provider.name = String(values[1])
      if (statement.includes('slug = $2')) provider.slug = String(values[1])
      if (statement.includes('provider_kind = $2')) provider.provider_kind = values[1] as Provider['provider_kind']
      provider.updated_at = new Date()
      return { rows: [responseRow(provider)] as T[] }
    }

    if (statement.startsWith('DELETE FROM providers')) {
      const id = String(values[0])
      const index = this.providers.findIndex((candidate) => candidate.id === id)
      if (index === -1) return { rows: [] }
      this.providers.splice(index, 1)
      return { rows: [{ id } as T] }
    }

    throw new Error(`Unhandled SQL: ${statement}`)
  }

  async end(): Promise<void> {}
}

function poolAsPg(pool: MemoryPool): pg.Pool {
  return pool as unknown as pg.Pool
}

describe('provider administration routes', () => {
  beforeEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url')
  })

  it('requires an admin session and validates provider creation without exposing credentials', async () => {
    const pool = new MemoryPool()
    const app = await createApp(poolAsPg(pool))

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/admin/providers' })
    expect(unauthenticated.statusCode).toBe(401)

    const nonAdmin = await app.inject({
      method: 'GET',
      url: '/api/admin/providers',
      headers: { cookie: `gitu_session=${userToken}` },
    })
    expect(nonAdmin.statusCode).toBe(403)

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      headers: { cookie: `gitu_session=${adminToken}` },
      payload: {
        name: 'OpenRouter',
        slug: 'not valid',
        providerKind: 'openrouter',
        baseUrl: 'ftp://provider.example',
        credential: 'secret-key',
      },
    })
    expect(invalid.statusCode).toBe(400)

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      headers: { cookie: `gitu_session=${adminToken}` },
      payload: {
        name: 'OpenRouter',
        slug: 'openrouter',
        providerKind: 'openrouter',
        baseUrl: 'https://openrouter.example/v1/',
        credential: 'secret-key',
      },
    })

    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual({
      provider: expect.objectContaining({
        id: expect.any(String),
        slug: 'openrouter',
        providerKind: 'openrouter',
        baseUrl: 'https://openrouter.example/v1',
        hasCredential: true,
      }),
    })
    expect(created.body).not.toContain('secret-key')
    expect(pool.providers[0]?.credential_ciphertext.toString()).not.toBe('secret-key')
    expect(pool.audits.map((audit) => audit.eventType)).toContain('provider.created')

    await app.close()
  })

  it('supports enable, disable, update, list, and delete with audit events', async () => {
    const pool = new MemoryPool()
    const now = new Date()
    pool.providers.push({
      id: providerId,
      name: 'DeepSeek',
      slug: 'deepseek',
      provider_kind: 'deepseek',
      base_url: 'https://api.deepseek.example',
      credential_nonce: Buffer.from('nonce'),
      credential_ciphertext: Buffer.from('ciphertext'),
      credential_auth_tag: Buffer.from('tag'),
      enabled: true,
      created_at: now,
      updated_at: now,
    })
    const app = await createApp(poolAsPg(pool))
    const headers = { cookie: `gitu_session=${adminToken}` }

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/admin/providers/${providerId}`,
      headers,
      payload: { name: 'DeepSeek Production' },
    })
    expect(updated.statusCode).toBe(200)

    const disabled = await app.inject({ method: 'POST', url: `/api/admin/providers/${providerId}/disable`, headers })
    expect(disabled.statusCode).toBe(200)
    expect(disabled.json().provider.enabled).toBe(false)

    const enabled = await app.inject({ method: 'POST', url: `/api/admin/providers/${providerId}/enable`, headers })
    expect(enabled.statusCode).toBe(200)
    expect(enabled.json().provider.enabled).toBe(true)

    const listed = await app.inject({ method: 'GET', url: '/api/admin/providers', headers })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().providers[0]).not.toHaveProperty('credential_ciphertext')

    const deleted = await app.inject({ method: 'DELETE', url: `/api/admin/providers/${providerId}`, headers })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ ok: true })

    expect(pool.audits.map((audit) => audit.eventType)).toEqual([
      'provider.updated',
      'provider.disabled',
      'provider.enabled',
      'provider.deleted',
    ])

    await app.close()
  })

  it('returns a conflict for duplicate provider slugs and rate limits repeated reads', async () => {
    const pool = new MemoryPool()
    const app = await createApp(poolAsPg(pool))
    const headers = { cookie: `gitu_session=${adminToken}` }
    const payload = {
      name: 'Alibaba',
      slug: 'alibaba',
      providerKind: 'alibaba',
      baseUrl: 'https://alibaba.example/v1',
      credential: 'secret-key',
    }

    const first = await app.inject({ method: 'POST', url: '/api/admin/providers', headers, payload })
    expect(first.statusCode).toBe(201)
    const duplicate = await app.inject({ method: 'POST', url: '/api/admin/providers', headers, payload })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toEqual({ error: 'provider_slug_conflict' })

    const statuses: number[] = []
    for (let index = 0; index < 31; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/admin/providers', headers })
      statuses.push(response.statusCode)
    }
    expect(statuses).toContain(429)

    await app.close()
  })
})
