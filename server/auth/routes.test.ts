import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../app.js'
import { requireAdmin } from './routes.js'


type StoredUser = {
  id: string
  email: string
  passwordHash: string
  role: 'user' | 'admin'
  lastLoginAt: Date | null
}

type StoredSession = {
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
}

type QueryResult<T> = {
  rows: T[]
}

function valueKey(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('hex')
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex')
  }

  return String(value)
}

class MemoryPool {
  readonly users: StoredUser[] = []
  readonly sessions: StoredSession[] = []
  readonly auditEvents: Array<{ eventType: string; userId: string | null }> = []

  async query<T>(sql: string, values: readonly unknown[] = []): Promise<QueryResult<T>> {
    const statement = sql.replace(/\s+/g, ' ').trim()

    if (statement.startsWith('INSERT INTO users')) {
      const [id, email, , passwordHash] = values
      this.users.push({
        id: String(id),
        email: String(email),
        passwordHash: String(passwordHash),
        role: 'user',
        lastLoginAt: null,
      })
      return { rows: [] }
    }

    if (statement.startsWith('SELECT id, email, password_hash FROM users')) {
      const user = this.users.find((candidate) => candidate.email === values[0])
      return {
        rows: user
          ? ([
              {
                id: user.id,
                email: user.email,
                password_hash: user.passwordHash,
              },
            ] as T[])
          : [],
      }
    }

    if (statement.startsWith('UPDATE users SET last_login_at')) {
      const user = this.users.find((candidate) => candidate.id === values[0])
      if (user) {
        user.lastLoginAt = new Date()
      }
      return { rows: [] }
    }

    if (statement.startsWith('INSERT INTO sessions')) {
      const [, userId, tokenHash, expiresAt] = values
      this.sessions.push({
        userId: String(userId),
        tokenHash: valueKey(tokenHash),
        expiresAt: new Date(String(expiresAt)),
        revokedAt: null,
      })
      return { rows: [] }
    }

    if (statement.startsWith('WITH bootstrap_lock AS')) {
      if (this.users.some((candidate) => candidate.role === 'admin')) {
        return { rows: [] }
      }

      const [id, email, passwordHash] = values
      this.users.push({
        id: String(id),
        email: String(email),
        passwordHash: String(passwordHash),
        role: 'admin',
        lastLoginAt: null,
      })
      return {
        rows: [{ id: String(id), email: String(email), role: 'admin' }] as T[],
      }
    }

    if (statement.startsWith('SELECT users.id, users.email, users.role FROM sessions')) {
      const session = this.sessions.find(
        (candidate) =>
          candidate.tokenHash === valueKey(values[0]) &&
          candidate.revokedAt === null &&
          candidate.expiresAt.getTime() > Date.now(),
      )
      const user = session
        ? this.users.find((candidate) => candidate.id === session.userId)
        : undefined

      return {
        rows: user
          ? ([{ id: user.id, email: user.email, role: user.role }] as T[])
          : [],
      }
    }

    if (statement.startsWith('UPDATE sessions SET revoked_at')) {
      const session = this.sessions.find(
        (candidate) =>
          candidate.tokenHash === valueKey(values[0]) && candidate.revokedAt === null,
      )
      if (session) {
        session.revokedAt = new Date()
      }
      return { rows: [] }
    }

    if (statement.startsWith('INSERT INTO audit_events')) {
      this.auditEvents.push({
        eventType: String(values[3]),
        userId: values[1] === null ? null : String(values[1]),
      })
      return { rows: [] }
    }

    throw new Error(`Unhandled test query: ${statement}`)
  }

  async end(): Promise<void> {}
}

function cookieFrom(response: { headers: Record<string, number | string | string[] | undefined> }): string {
  const header = response.headers['set-cookie']
  return Array.isArray(header) ? header[0] ?? '' : String(header ?? '')
}

describe('authentication routes', () => {
  let pool: MemoryPool

  beforeEach(() => {
    pool = new MemoryPool()
  })

  it('registers users, hashes passwords, creates an HttpOnly session, and protects /me', async () => {
    const app = await createApp(pool as never)

    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: '  DEV@example.com ',
        password: 'correct horse battery staple',
      },
    })

    expect(registration.statusCode).toBe(201)
    expect(registration.json()).toMatchObject({
      user: { email: 'dev@example.com' },
    })
    expect(pool.users).toHaveLength(1)
    expect(pool.users[0]?.passwordHash).not.toBe('correct horse battery staple')

    const sessionCookie = cookieFrom(registration)
    expect(sessionCookie).toContain('gitu_session=')
    expect(sessionCookie.toLowerCase()).toContain('httponly')

    const currentUser = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie.split(';')[0] },
    })

    expect(currentUser.statusCode).toBe(200)
    expect(currentUser.json()).toEqual({
      user: { id: pool.users[0]?.id, email: 'dev@example.com', role: 'user' },
    })

    await app.close()
  }, 20000)

  it('rejects unauthenticated and incorrect credential requests', async () => {
    const app = await createApp(pool as never)

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    })
    expect(unauthenticated.statusCode).toBe(401)

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'dev@example.com',
        password: 'correct horse battery staple',
      },
    })

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'dev@example.com',
        password: 'wrong password entirely',
      },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual({ error: 'invalid_credentials' })

    await app.close()
  })

  it('revokes sessions on logout and keeps two users isolated', async () => {
    const app = await createApp(pool as never)

    const firstRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'first@example.com',
        password: 'first user secure password',
      },
    })
    const firstCookie = cookieFrom(firstRegistration).split(';')[0]

    const secondRegistration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'second@example.com',
        password: 'second user secure password',
      },
    })
    const secondCookie = cookieFrom(secondRegistration).split(';')[0]

    const firstUser = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: firstCookie },
    })
    const secondUser = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: secondCookie },
    })

    expect(firstUser.json().user.email).toBe('first@example.com')
    expect(secondUser.json().user.email).toBe('second@example.com')
    expect(firstUser.json().user.id).not.toBe(secondUser.json().user.id)

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: firstCookie },
    })
    expect(logout.statusCode).toBe(200)
    expect(cookieFrom(logout).toLowerCase()).toContain('max-age=0')

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: firstCookie },
    })
    const stillAuthenticatedSecondUser = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: secondCookie },
    })

    expect(revokedSession.statusCode).toBe(401)
    expect(stillAuthenticatedSecondUser.statusCode).toBe(200)
    expect(stillAuthenticatedSecondUser.json().user.email).toBe('second@example.com')
    expect(pool.auditEvents.map((event) => event.eventType)).toEqual([
      'auth.registered',
      'auth.registered',
      'auth.logged_out',
    ])

    await app.close()
  })

  it('denies unauthenticated and non-admin access while preserving admin roles', async () => {
    const app = await createApp(pool as never)
    app.get('/test/admin', async (request, reply) => {
      const user = await requireAdmin(pool as never, request, reply)
      if (!user) return
      return { user: { id: user.id, email: user.email, role: user.role } }
    })

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/test/admin',
    })
    expect(unauthenticated.statusCode).toBe(401)
    expect(unauthenticated.json()).toEqual({ error: 'authentication_required' })

    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'client@example.com',
        password: 'client secure password',
      },
    })
    const clientAccess = await app.inject({
      method: 'GET',
      url: '/test/admin',
      headers: { cookie: cookieFrom(registration).split(';')[0] },
    })
    expect(clientAccess.statusCode).toBe(403)
    expect(clientAccess.json()).toEqual({ error: 'admin_required' })

    await app.close()
  })

  it('bootstraps one admin, returns no credential material, and rejects replay', async () => {
    const previousSecret = process.env.ADMIN_BOOTSTRAP_SECRET
    process.env.ADMIN_BOOTSTRAP_SECRET = 'b'.repeat(32)

    try {
      const app = await createApp(pool as never)

      const invalidSecret = await app.inject({
        method: 'POST',
        url: '/api/auth/bootstrap-admin',
        headers: { 'x-admin-bootstrap-secret': 'incorrect' },
        payload: {
          email: 'admin@example.com',
          password: 'admin secure password',
        },
      })
      expect(invalidSecret.statusCode).toBe(403)
      expect(pool.users).toHaveLength(0)

      const bootstrap = await app.inject({
        method: 'POST',
        url: '/api/auth/bootstrap-admin',
        headers: { 'x-admin-bootstrap-secret': process.env.ADMIN_BOOTSTRAP_SECRET },
        payload: {
          email: 'admin@example.com',
          password: 'admin secure password',
        },
      })
      expect(bootstrap.statusCode).toBe(201)
      expect(bootstrap.json()).toEqual({
        user: {
          id: pool.users[0]?.id,
          email: 'admin@example.com',
          role: 'admin',
        },
      })
      expect(bootstrap.json()).not.toHaveProperty('user.password_hash')
      expect(bootstrap.json()).not.toHaveProperty('user.password')
      expect(pool.users[0]?.role).toBe('admin')
      expect(pool.auditEvents.map((event) => event.eventType)).toContain(
        'auth.bootstrap_completed',
      )

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'admin@example.com',
          password: 'admin secure password',
        },
      })
      const adminMe = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieFrom(login).split(';')[0] },
      })
      expect(adminMe.statusCode).toBe(200)
      expect(adminMe.json()).toEqual({
        user: {
          id: pool.users[0]?.id,
          email: 'admin@example.com',
          role: 'admin',
        },
      })

      const replay = await app.inject({
        method: 'POST',
        url: '/api/auth/bootstrap-admin',
        headers: { 'x-admin-bootstrap-secret': process.env.ADMIN_BOOTSTRAP_SECRET },
        payload: {
          email: 'second-admin@example.com',
          password: 'second admin secure password',
        },
      })
      expect(replay.statusCode).toBe(409)
      expect(replay.json()).toEqual({ error: 'admin_bootstrap_already_completed' })
      expect(pool.users).toHaveLength(1)

      await app.close()
    } finally {
      if (previousSecret === undefined) {
        delete process.env.ADMIN_BOOTSTRAP_SECRET
      } else {
        process.env.ADMIN_BOOTSTRAP_SECRET = previousSecret
      }
    }
  })
})
