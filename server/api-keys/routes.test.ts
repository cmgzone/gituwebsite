import { beforeEach, describe, expect, it } from 'vitest'
import type pg from 'pg'

import { createApp } from '../app.js'
import { digestToken } from '../security/crypto.js'

type User = { id: string; email: string }
type Session = { userId: string; tokenHash: string }
type Key = {
  id: string
  userId: string
  name: string
  prefix: string
  lastFour: string
  digest: string
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
  revokedAt: Date | null
  rotatedFromId: string | null
}
type Result<T> = { rows: T[] }

function valueKey(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  return String(value)
}

function row(key: Key) {
  return {
    id: key.id,
    user_id: key.userId,
    name: key.name,
    key_prefix: key.prefix,
    key_last_four: key.lastFour,
    created_at: key.createdAt,
    updated_at: key.updatedAt,
    last_used_at: key.lastUsedAt,
    expires_at: key.expiresAt,
    revoked_at: key.revokedAt,
    rotated_from_id: key.rotatedFromId,
  }
}

class MemoryPool {
  readonly users: User[] = [{ id: '11111111-1111-4111-8111-111111111111', email: 'one@example.com' }]
  readonly sessions: Session[] = []
  readonly keys: Key[] = []
  readonly audits: Array<{ eventType: string; metadata: string }> = []

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<Result<T>> {
    const statement = sql.replace(/\s+/g, ' ').trim()

    if (statement.startsWith('SELECT users.id, users.email, users.role FROM sessions')) {
      const session = this.sessions.find((candidate) => candidate.tokenHash === valueKey(values[0]))
      const user = session && this.users.find((candidate) => candidate.id === session.userId)
      return { rows: (user ? [user] : []) as T[] }
    }

    if (statement.startsWith('INSERT INTO audit_events')) {
      this.audits.push({ eventType: String(values[3]), metadata: String(values[4]) })
      return { rows: [] }
    }

    if (statement.startsWith('INSERT INTO api_keys')) {
      const [id, userId, name, prefix, lastFour, digest, expiresAt, rotatedFromId] = values
      const now = new Date()
      const key: Key = {
        id: String(id),
        userId: String(userId),
        name: String(name),
        prefix: String(prefix),
        lastFour: String(lastFour),
        digest: valueKey(digest),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        expiresAt: expiresAt ? new Date(String(expiresAt)) : null,
        revokedAt: null,
        rotatedFromId: rotatedFromId ? String(rotatedFromId) : null,
      }
      this.keys.push(key)
      return { rows: [row(key)] as T[] }
    }

    if (statement.startsWith('SELECT id, user_id, name, key_prefix') && statement.includes('FOR UPDATE')) {
      const key = this.keys.find((candidate) => candidate.id === values[0] && candidate.userId === values[1] && candidate.revokedAt === null)
      return { rows: (key ? [row(key)] : []) as T[] }
    }

    if (statement.startsWith('SELECT id, user_id, name, key_prefix')) {
      const keys = this.keys
        .filter((candidate) => candidate.userId === values[0])
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return { rows: keys.map(row) as T[] }
    }

    if (statement.startsWith('UPDATE api_keys SET name')) {
      const key = this.keys.find((candidate) => candidate.id === values[1] && candidate.userId === values[2] && candidate.revokedAt === null)
      if (!key) return { rows: [] }
      key.name = String(values[0])
      key.updatedAt = new Date()
      return { rows: [row(key)] as T[] }
    }

    if (statement.startsWith('UPDATE api_keys SET revoked_at')) {
      const key = this.keys.find((candidate) => candidate.id === values[0] && candidate.userId === values[1] && candidate.revokedAt === null)
      if (!key) return { rows: [] }
      key.revokedAt = new Date()
      key.updatedAt = new Date()
      return { rows: [row(key)] as T[] }
    }

    if (statement.startsWith('UPDATE api_keys SET last_used_at')) {
      const key = this.keys.find((candidate) => candidate.id === values[0] && candidate.revokedAt === null)
      if (key) {
        key.lastUsedAt = new Date()
        key.updatedAt = new Date()
      }
      return { rows: [] }
    }

    if (statement.startsWith('SELECT id, user_id, revoked_at, expires_at')) {
      const key = this.keys.find((candidate) => candidate.digest === valueKey(values[0]))
      return { rows: (key ? [{ id: key.id, user_id: key.userId, revoked_at: key.revokedAt, expires_at: key.expiresAt }] : []) as T[] }
    }

    return { rows: [] }
  }

  async end() {}

  async connect() {
    return {
      query: <T>(sql: string, values: readonly unknown[] = []) => this.query<T>(sql, values),
      release: () => undefined,
    }
  }
}

function sessionCookie(token: string) {
  return `gitu_session=${token}`
}

async function setup() {
  const pool = new MemoryPool()
  const token = 'session-one-token'
  pool.sessions.push({ userId: pool.users[0].id, tokenHash: digestToken(token).toString('hex') })
  const app = await createApp(pool as unknown as pg.Pool)
  return { app, pool, cookie: sessionCookie(token) }
}

describe('API-key lifecycle routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let pool: MemoryPool
  let cookie: string

  beforeEach(async () => {
    const fixture = await setup()
    app = fixture.app
    pool = fixture.pool
    cookie = fixture.cookie
  })

  it('creates once, lists metadata only, rotates, validates, and revokes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: { cookie },
      payload: { name: 'agent runtime' },
    })
    expect(created.statusCode).toBe(201)
    const createdBody = created.json() as { key: Record<string, unknown>; token: string }
    expect(createdBody.token).toMatch(/^gitu_/)
    expect(createdBody.key).not.toHaveProperty('digest')
    expect(pool.keys[0].digest).toBe(digestToken(createdBody.token).toString('hex'))
    expect(pool.keys[0].digest).not.toContain(createdBody.token)

    const listed = await app.inject({ method: 'GET', url: '/api/keys', headers: { cookie } })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().keys[0]).not.toHaveProperty('token')
    expect(listed.json().keys[0]).not.toHaveProperty('digest')

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/keys/${createdBody.key.id}`,
      headers: { cookie },
      payload: { name: 'renamed runtime' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().key.name).toBe('renamed runtime')

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/keys/${createdBody.key.id}/rotate`,
      headers: { cookie },
    })
    expect(rotated.statusCode).toBe(200)
    const rotatedBody = rotated.json() as { key: Record<string, unknown>; token: string }
    expect(rotatedBody.token).toMatch(/^gitu_/)
    expect(rotatedBody.token).not.toBe(createdBody.token)
    expect(rotatedBody.key.rotatedFromId).toBe(createdBody.key.id)
    expect(pool.keys.find((key) => key.id === createdBody.key.id)?.revokedAt).not.toBeNull()

    const valid = await app.inject({ method: 'POST', url: '/api/keys/validate', payload: { token: rotatedBody.token } })
    expect(valid.statusCode).toBe(200)
    expect(valid.json()).toEqual({ valid: true, keyId: rotatedBody.key.id })

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/keys/${rotatedBody.key.id}/revoke`,
      headers: { cookie },
    })
    expect(revoked.statusCode).toBe(200)

    const invalid = await app.inject({ method: 'POST', url: '/api/keys/validate', payload: { token: rotatedBody.token } })
    expect(invalid.statusCode).toBe(200)
    expect(invalid.json()).toEqual({ valid: false })
    expect(pool.audits.every((audit) => !audit.metadata.includes(createdBody.token) && !audit.metadata.includes(rotatedBody.token))).toBe(true)

    await app.close()
  })

  it('enforces ownership and validates input without leaking key material', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie }, payload: { name: 'owner key' } })
    const keyId = (created.json() as { key: { id: string } }).key.id

    const otherToken = 'session-two-token'
    const otherUser = { id: '22222222-2222-4222-8222-222222222222', email: 'two@example.com' }
    pool.users.push(otherUser)
    pool.sessions.push({ userId: otherUser.id, tokenHash: digestToken(otherToken).toString('hex') })

    const otherCookie = sessionCookie(otherToken)
    const hidden = await app.inject({ method: 'GET', url: '/api/keys', headers: { cookie: otherCookie } })
    expect(hidden.statusCode).toBe(200)
    expect(hidden.json()).toEqual({ keys: [] })

    const denied = await app.inject({ method: 'POST', url: `/api/keys/${keyId}/revoke`, headers: { cookie: otherCookie } })
    expect(denied.statusCode).toBe(404)

    const invalid = await app.inject({ method: 'POST', url: '/api/keys', headers: { cookie }, payload: { name: '' } })
    expect(invalid.statusCode).toBe(400)

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/keys' })
    expect(unauthenticated.statusCode).toBe(401)

    await app.close()
  })
})
