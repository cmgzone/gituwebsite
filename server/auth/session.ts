import { randomUUID } from 'node:crypto'
import '@fastify/cookie'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type pg from 'pg'

import { createOpaqueToken, digestToken } from '../security/crypto.js'

export const SESSION_COOKIE_NAME = 'gitu_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export type SessionUser = {
  id: string
  email: string
  role: 'user' | 'admin'
}

type SessionUserRow = {
  id: string
  email: string
  role: 'user' | 'admin'
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}

export async function createSession(
  pool: pg.Pool,
  userId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = createOpaqueToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)

  await pool.query(
    `INSERT INTO sessions
      (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      userId,
      digestToken(token),
      expiresAt,
      request.ip,
      request.headers['user-agent'] ?? null,
    ],
  )

  reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions())
}

export async function getSessionUser(
  pool: pg.Pool,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  const token = request.cookies[SESSION_COOKIE_NAME]

  if (!token) {
    return null
  }

  const result = await pool.query<SessionUserRow>(
    `SELECT users.id, users.email, users.role
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > now()
     LIMIT 1`,
    [digestToken(token)],
  )

  return result.rows[0] ?? null
}

export async function revokeSession(
  pool: pg.Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies[SESSION_COOKIE_NAME]

  if (token) {
    await pool.query(
      `UPDATE sessions
       SET revoked_at = now()
       WHERE token_hash = $1
         AND revoked_at IS NULL`,
      [digestToken(token)],
    )
  }

  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
}
