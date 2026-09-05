import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProtectedPlatform from './ProtectedPlatform'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const clientUser = {
  id: 'user-1',
  email: 'client@example.com',
  role: 'user' as const,
}

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin' as const,
}

const model = {
  id: 'model-1',
  providerId: 'provider-1',
  providerModelId: 'provider/model-1',
  displayName: 'Model One',
  description: 'Test model',
  contextWindow: 8192,
  maxOutputTokens: 1024,
  inputPriceMicros: 1,
  outputPriceMicros: 2,
  metadata: {},
  enabled: true,
  provider: {
    name: 'Test Provider',
    kind: 'openai_compatible',
    enabled: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function installDashboardFetch(user: typeof clientUser | typeof adminUser = clientUser, models: unknown[] = []) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input)

    if (url === '/api/auth/me') return jsonResponse({ user })
    if (url === '/api/keys') return jsonResponse({ keys: [] })
    if (url === '/api/models') return jsonResponse({ models })
    if (url === '/api/chat/completions') {
      return jsonResponse({
        choices: [{ message: { content: '  bounded response  ' } }],
      })
    }

    throw new Error(`Unexpected request: ${url}`)
  })
}

describe('ProtectedPlatform client and admin routes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    window.history.pushState({}, '', '/app')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('denies non-admin users on the admin route', async () => {
    window.history.pushState({}, '', '/admin')
    installDashboardFetch(clientUser)

    render(<ProtectedPlatform />)

    expect(await screen.findByRole('heading', { name: 'Admin access required.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByText(/Manage provider connections/i)).not.toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/providers')
    })
  })

  it('renders the empty entitled model catalog state', async () => {
    installDashboardFetch(clientUser, [])

    render(<ProtectedPlatform />)

    expect(await screen.findByRole('heading', { name: 'No models available yet.' })).toBeInTheDocument()
    expect(screen.getByText('Ask an administrator to enable a model for this client.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/models', expect.anything())
  })

  it('submits a bounded inference request for the selected model', async () => {
    installDashboardFetch(clientUser, [model])

    render(<ProtectedPlatform />)

    const select = await screen.findByRole('combobox', { name: 'Model' })
    const prompt = screen.getByRole('textbox', { name: /prompt/i })

    fireEvent.change(select, { target: { value: model.id } })
    fireEvent.change(prompt, { target: { value: 'Explain bounded requests' } })
    fireEvent.submit(prompt.closest('form') as HTMLFormElement)

    expect(await screen.findByText('bounded response')).toBeInTheDocument()

    const completionCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/chat/completions')
    expect(completionCall).toBeDefined()

    const requestInit = completionCall?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: model.id,
      messages: [{ role: 'user', content: 'Explain bounded requests' }],
      max_tokens: 1024,
    })
  })

  it('rejects an empty inference prompt without calling the provider proxy', async () => {
    installDashboardFetch(adminUser, [model])

    render(<ProtectedPlatform />)

    const prompt = await screen.findByRole('textbox', { name: /prompt/i })
    fireEvent.submit(prompt.closest('form') as HTMLFormElement)

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a prompt before submitting.')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('/api/chat/completions')
  })

  it('submits login credentials to the authentication endpoint', async () => {
    window.history.pushState({}, '', '/login')
    fetchMock.mockResolvedValueOnce(jsonResponse({ user: { id: clientUser.id, email: clientUser.email } }))

    render(<ProtectedPlatform />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: clientUser.email },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-valid-password' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /sign in/i }).closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.anything())
    })

    const loginCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/login')
    const requestInit = loginCall?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      email: clientUser.email,
      password: 'a-valid-password',
    })
  })

  it('keeps an actionable error visible when dashboard bootstrap fails', async () => {
    window.history.pushState({}, '', '/app')
    fetchMock.mockImplementation((url) => {
      if (String(url) === '/api/auth/me') return Promise.resolve(jsonResponse({ error: 'request_failed' }, 500))
      if (String(url) === '/api/keys') return Promise.resolve(jsonResponse({ keys: [] }))
      return Promise.reject(new Error(`Unexpected request: ${String(url)}`))
    })

    render(<ProtectedPlatform />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Please try again.')
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
