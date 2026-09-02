import { describe, expect, it } from 'vitest'
import type pg from 'pg'

import { createApp } from './app.js'

class NoopPool {
  async query<T>(): Promise<{ rows: T[] }> {
    return { rows: [] }
  }

  async end(): Promise<void> {}
}

describe('production app shell', () => {
  it('serves the SPA, preserves deep links, exposes health, and keeps API misses JSON', async () => {
    const app = await createApp(new NoopPool() as unknown as pg.Pool)

    const home = await app.inject({ method: 'GET', url: '/' })
    expect(home.statusCode).toBe(200)
    expect(home.headers['content-type']).toContain('text/html')
    expect(home.body).toContain('<div id="root">')

    const deepLink = await app.inject({ method: 'GET', url: '/admin' })
    expect(deepLink.statusCode).toBe(200)
    expect(deepLink.headers['content-type']).toContain('text/html')
    expect(deepLink.body).toContain('<div id="root">')

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json()).toEqual({ ok: true })

    const unknownApi = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(unknownApi.statusCode).toBe(404)
    expect(unknownApi.json()).toEqual({ error: 'not_found' })

    await app.close()
  })
})
