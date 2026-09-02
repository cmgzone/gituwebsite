import type { ChatMessage } from './contracts.js'

export type ProviderCompletionRequest = {
  baseUrl: string
  credential: string
  model: string
  messages: ChatMessage[]
  maxTokens: number
  timeoutMs?: number
}

export type ProviderCompletionResult = {
  response: Record<string, unknown>
  upstreamStatus: number
}

export class ProviderUpstreamError extends Error {
  constructor(readonly upstreamStatus: number) {
    super('Provider returned an unsuccessful response')
    this.name = 'ProviderUpstreamError'
  }
}

export class ProviderTimeoutError extends Error {
  constructor() {
    super('Provider request timed out')
    this.name = 'ProviderTimeoutError'
  }
}

export class ProviderUnavailableError extends Error {
  constructor() {
    super('Provider is unavailable')
    this.name = 'ProviderUnavailableError'
  }
}

export class ProviderResponseError extends Error {
  constructor() {
    super('Provider returned an invalid response')
    this.name = 'ProviderResponseError'
  }
}

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash
  ) throw new Error('invalid_provider_base_url')
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function requestProviderCompletion(
  request: ProviderCompletionRequest,
): Promise<ProviderCompletionResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 15_000)

  try {
    let response: Response
    try {
      response = await fetch(`${normalizeProviderBaseUrl(request.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${request.credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new ProviderTimeoutError()
      throw new ProviderUnavailableError()
    }

    if (!response.ok) throw new ProviderUpstreamError(response.status)

    let body: unknown
    try { body = await response.json() } catch { throw new ProviderResponseError() }
    if (!isRecord(body)) throw new ProviderResponseError()

    return { response: body, upstreamStatus: response.status }
  } finally {
    clearTimeout(timeout)
  }
}
