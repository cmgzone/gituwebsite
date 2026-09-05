import { useCallback, useEffect, useState, type FormEvent } from 'react'
import '../protected-platform.css'

type AuthUser = {
  id: string
  email: string
  role: 'user' | 'admin'
}

type AuthResponseUser = Pick<AuthUser, 'id' | 'email'>

type ProtectedDashboardPath = '/dashboard' | '/app' | '/admin'

type ApiKey = {
  id: string
  name: string
  prefix: string
  lastFour: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  rotatedFromId: string | null
}

type ApiError = {
  error?: string
}

type KeyResponse = {
  key: ApiKey
  token?: string
}

type ProviderKind = 'openrouter' | 'deepseek' | 'alibaba' | 'openai_compatible'

type Provider = {
  id: string
  name: string
  slug: string
  providerKind: ProviderKind
  baseUrl: string
  enabled: boolean
  hasCredential: boolean
  createdAt: string
  updatedAt: string
}

type ProviderListResponse = {
  providers: Provider[]
}

type ProviderMutationResponse = {
  provider: Provider
}

type ProviderFormValues = {
  name: string
  slug: string
  providerKind: ProviderKind
  baseUrl: string
  credential: string
  enabled: boolean
}

type ProviderFieldChange = <K extends keyof ProviderFormValues>(field: K, value: ProviderFormValues[K]) => void

type RegisteredModel = {
  id: string
  providerId: string
  providerModelId: string
  displayName: string
  description: string
  contextWindow: number
  maxOutputTokens: number
  inputPriceMicros: number
  outputPriceMicros: number
  metadata: Record<string, unknown>
  enabled: boolean
  provider: {
    name: string
    kind: string
    enabled: boolean
  }
  createdAt: string
  updatedAt: string
}

type ModelListResponse = {
  models: RegisteredModel[]
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

type ModelMutationResponse = {
  model: RegisteredModel
}

type ModelFormValues = {
  providerId: string
  providerModelId: string
  displayName: string
  description: string
  contextWindow: string
  maxOutputTokens: string
  inputPriceMicros: string
  outputPriceMicros: string
  metadata: string
  enabled: boolean
}

type ModelFieldChange = <K extends keyof ModelFormValues>(field: K, value: ModelFormValues[K]) => void

const PROVIDER_KIND_OPTIONS: Array<{ value: ProviderKind; label: string }> = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'alibaba', label: 'Alibaba' },
  { value: 'openai_compatible', label: 'OpenAI-compatible' },
]

function emptyProviderForm(): ProviderFormValues {
  return {
    name: '',
    slug: '',
    providerKind: 'openrouter',
    baseUrl: '',
    credential: '',
    enabled: true,
  }
}

function emptyModelForm(): ModelFormValues {
  return {
    providerId: '',
    providerModelId: '',
    displayName: '',
    description: '',
    contextWindow: '0',
    maxOutputTokens: '0',
    inputPriceMicros: '0',
    outputPriceMicros: '0',
    metadata: '{}',
    enabled: false,
  }
}

function modelFormFromModel(model: RegisteredModel): ModelFormValues {
  return {
    providerId: model.providerId,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    description: model.description,
    contextWindow: String(model.contextWindow),
    maxOutputTokens: String(model.maxOutputTokens),
    inputPriceMicros: String(model.inputPriceMicros),
    outputPriceMicros: String(model.outputPriceMicros),
    metadata: JSON.stringify(model.metadata, null, 2),
    enabled: model.enabled,
  }
}

function parseModelMetadata(value: string): Record<string, unknown> | null {
  if (!value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseNonNegativeInteger(value: string, max: number): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null
}

function validateModelForm(values: ModelFormValues): string {
  if (!values.providerId) return 'Choose a provider.'
  if (!values.providerModelId.trim()) return 'Provider model identifier is required.'
  if (values.providerModelId.trim().length > 160) return 'Provider model identifier must be 160 characters or fewer.'
  if (!values.displayName.trim()) return 'Display name is required.'
  if (values.displayName.trim().length > 120) return 'Display name must be 120 characters or fewer.'
  if (values.description.length > 10_000) return 'Description must be 10,000 characters or fewer.'
  if (parseNonNegativeInteger(values.contextWindow, 2_147_483_647) === null) {
    return 'Context window must be a non-negative whole number.'
  }
  if (parseNonNegativeInteger(values.maxOutputTokens, 2_147_483_647) === null) {
    return 'Max output tokens must be a non-negative whole number.'
  }
  if (parseNonNegativeInteger(values.inputPriceMicros, 9_000_000_000_000_000) === null) {
    return 'Input price must be a non-negative whole number of micros.'
  }
  if (parseNonNegativeInteger(values.outputPriceMicros, 9_000_000_000_000_000) === null) {
    return 'Output price must be a non-negative whole number of micros.'
  }
  if (!parseModelMetadata(values.metadata)) return 'Metadata must be a valid JSON object.'
  return ''
}

function modelWritePayload(values: ModelFormValues) {
  return {
    providerId: values.providerId,
    providerModelId: values.providerModelId.trim(),
    displayName: values.displayName.trim(),
    description: values.description,
    contextWindow: parseNonNegativeInteger(values.contextWindow, 2_147_483_647) ?? 0,
    maxOutputTokens: parseNonNegativeInteger(values.maxOutputTokens, 2_147_483_647) ?? 0,
    inputPriceMicros: parseNonNegativeInteger(values.inputPriceMicros, 9_000_000_000_000_000) ?? 0,
    outputPriceMicros: parseNonNegativeInteger(values.outputPriceMicros, 9_000_000_000_000_000) ?? 0,
    metadata: parseModelMetadata(values.metadata) ?? {},
    enabled: values.enabled,
  }
}

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? ''

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('request_failed')
  }

  const payload = (await response.json()) as T & ApiError
  if (!response.ok) {
    throw new Error(payload.error ?? 'request_failed')
  }
  return payload
}

function messageForError(error: unknown): string {
  const code = error instanceof Error ? error.message : 'request_failed'
  const messages: Record<string, string> = {
    account_unavailable: 'That email is already registered. Try signing in instead.',
    invalid_credentials: 'The email or password did not match.',
    invalid_request: 'Check the form fields and try again.',
    invalid_provider: 'Check the provider fields and try again.',
    invalid_provider_update: 'Check the provider fields and try again.',
    invalid_provider_id: 'That provider identifier is not valid.',
    invalid_model: 'Check the model fields and try again.',
    invalid_model_update: 'Check the model fields and try again.',
    key_name_conflict: 'A key with that name already exists.',
    not_found: 'That key is no longer available.',
    provider_not_found: 'That provider is no longer available.',
    provider_slug_conflict: 'A provider with that slug already exists.',
    provider_list_failed: 'Providers could not be loaded. Please try again.',
    provider_create_failed: 'The provider could not be added. Please try again.',
    provider_update_failed: 'The provider could not be updated. Please try again.',
    provider_status_update_failed: 'The provider status could not be changed. Please try again.',
    provider_delete_failed: 'The provider could not be deleted. Please try again.',
    provider_model_conflict: 'That provider model identifier is already registered.',
    model_list_failed: 'Models could not be loaded. Please try again.',
    model_read_failed: 'That model could not be loaded. Please try again.',
    model_not_found: 'That model is no longer available.',
    model_create_failed: 'The model could not be registered. Please try again.',
    model_update_failed: 'The model could not be updated. Please try again.',
    model_status_update_failed: 'The model availability could not be changed. Please try again.',
    model_delete_failed: 'The model could not be deleted. Please try again.',
    invalid_entitlement: 'Enter a valid client ID and choose a registered model.',
    user_or_model_not_found: 'That client or model could not be found.',
    entitlement_update_failed: 'The client model availability could not be changed. Please try again.',
    admin_required: 'Administrator access is required to manage providers.',
    authentication_required: 'Your session expired. Please sign in again.',
    invalid_expiry: 'The expiry date must be in the future.',
  }
  return messages[code] ?? 'Something went wrong. Please try again.'
}

function formatDate(value: string | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function goTo(path: string) {
  window.location.assign(path)
}

function isProtectedDashboardPath(path: string): path is ProtectedDashboardPath {
  return path === '/dashboard' || path === '/app' || path === '/admin'
}

function validateProviderForm(values: ProviderFormValues, isEditing: boolean): string {
  const name = values.name.trim()
  const slug = values.slug.trim().toLowerCase()
  const baseUrl = values.baseUrl.trim()

  if (!name) return 'Provider name is required.'
  if (name.length > 80) return 'Provider name must be 80 characters or fewer.'
  if (!slug) return 'Provider slug is required.'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, numbers, and single hyphens for the slug.'
  }
  if (slug.length > 80) return 'Provider slug must be 80 characters or fewer.'
  if (!PROVIDER_KIND_OPTIONS.some((option) => option.value === values.providerKind)) {
    return 'Choose a supported provider kind.'
  }
  if (!baseUrl) return 'Base URL is required.'

  try {
    const url = new URL(baseUrl)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return 'Use an http(s) base URL without credentials, a query, or a fragment.'
    }
  } catch {
    return 'Enter a valid http(s) base URL.'
  }

  if (!isEditing && !values.credential) return 'Credential is required when adding a provider.'
  if (values.credential.length > 10_000) return 'Credential must be 10,000 characters or fewer.'
  return ''
}

function providerWritePayload(values: ProviderFormValues, includeCredential: boolean) {
  const payload: {
    name: string
    slug: string
    providerKind: ProviderKind
    baseUrl: string
    enabled: boolean
    credential?: string
  } = {
    name: values.name.trim(),
    slug: values.slug.trim().toLowerCase(),
    providerKind: values.providerKind,
    baseUrl: values.baseUrl.trim(),
    enabled: values.enabled,
  }
  if (includeCredential && values.credential) payload.credential = values.credential
  return payload
}

function AuthView({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isRegistering = mode === 'register'

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      await requestJson<{ user: AuthResponseUser }>(`/api/auth/${isRegistering ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      goTo('/dashboard')
    } catch (submitError) {
      setError(messageForError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="platform-shell platform-shell--auth">
      <div className="platform-noise" aria-hidden="true" />
      <section className="auth-layout" aria-labelledby="auth-title">
        <div className="auth-intro">
          <a className="platform-wordmark" href="/" aria-label="Gitu home">
            <span className="platform-mark">G</span>
            <span>gitu</span>
          </a>
          <p className="platform-kicker">Gitu Models · developer preview</p>
          <h1 id="auth-title">Build with the agent. Connect through the API.</h1>
          <p className="platform-lede">
            Create a secure workspace for the upcoming Gitu developer platform. Hosted models and
            OpenAI-compatible inference are planned for early access.
          </p>
          <div className="auth-signal" aria-label="Platform status">
            <span className="status-dot" aria-hidden="true" />
            <span>API access is coming soon</span>
          </div>
        </div>

        <div className="auth-card platform-card">
          <div className="auth-card__header">
            <div>
              <p className="platform-eyebrow">{isRegistering ? 'Create workspace' : 'Welcome back'}</p>
              <h2>{isRegistering ? 'Start your preview' : 'Sign in to Gitu'}</h2>
            </div>
            <span className="auth-card__index">01 / 02</span>
          </div>

          {error && (
            <p className="form-alert form-alert--error" role="alert">
              {error}
            </p>
          )}

          <form className="platform-form" onSubmit={handleSubmit}>
            <label htmlFor="platform-email">Email address</label>
            <input
              id="platform-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
            />

            <label htmlFor="platform-password">Password</label>
            <input
              id="platform-password"
              name="password"
              type="password"
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 12 characters"
              required
            />
            <p className="field-hint">Use 12 or more characters for your workspace password.</p>

            <button className="platform-button platform-button--primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Connecting…' : isRegistering ? 'Create workspace' : 'Sign in'}
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <p className="auth-switch">
            {isRegistering ? 'Already have a workspace?' : 'New to the preview?'}{' '}
            <a href={isRegistering ? '/login' : '/register'}>
              {isRegistering ? 'Sign in' : 'Create one'}
            </a>
          </p>
        </div>
      </section>
    </main>
  )
}

function TokenNotice({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <aside className="token-notice platform-card" role="status" aria-labelledby="token-title">
      <div className="token-notice__header">
        <div>
          <p className="platform-eyebrow">Save this key now</p>
          <h2 id="token-title">Your secret is shown once.</h2>
        </div>
        <span className="token-warning" aria-hidden="true">!</span>
      </div>
      <p>
        Gitu stores only a secure digest. Copy this value to your secret manager before closing this
        notice; it cannot be revealed again.
      </p>
      <code className="token-value">{token}</code>
      <div className="token-actions">
        <button className="platform-button platform-button--primary" type="button" onClick={copyToken}>
          {copied ? 'Copied' : 'Copy secret'}
        </button>
        <button className="platform-button platform-button--quiet" type="button" onClick={onDismiss}>
          I saved it
        </button>
      </div>
    </aside>
  )
}

function ModelEntry({ path }: { path: '/app' | '/admin' }) {
  const isAdmin = path === '/admin'

  if (!isAdmin) return <ClientModelCatalog />

  return (
    <section className="dashboard-grid" aria-label={isAdmin ? 'Admin workspace' : 'Model workspace'}>
      <div className="platform-card model-entry-card">
        <div className="card-heading">
          <div>
            <p className="platform-eyebrow">{isAdmin ? 'Administration' : 'Model workspace'}</p>
            <h2>{isAdmin ? 'Admin console' : 'Available models'}</h2>
          </div>
          <span className="card-number">{isAdmin ? '04' : '03'}</span>
        </div>
        <p className="card-copy">
          {isAdmin
            ? 'Manage provider connections, registered models, and client availability from this workspace.'
            : 'Your authenticated model entry point is ready. Available models and inference controls will appear here next.'}
        </p>
        <div className="model-entry__status" role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>{isAdmin ? 'Admin access confirmed' : 'Client catalog next'}</span>
        </div>
      </div>
    </section>
  )
}

function ClientModelCatalog() {
  const [models, setModels] = useState<RegisteredModel[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [inferenceError, setInferenceError] = useState('')
  const [responseText, setResponseText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleInferenceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const content = prompt.trim()
    const modelId = selectedModelId || models[0]?.id || ''
    setInferenceError('')
    setResponseText('')

    if (!modelId) {
      setInferenceError('Choose an available model before submitting.')
      return
    }
    if (!content) {
      setInferenceError('Enter a prompt before submitting.')
      return
    }

    setIsSubmitting(true)
    try {
      const result = await requestJson<ChatCompletionResponse>('/api/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content }],
          max_tokens: 1024,
        }),
      })
      const assistantContent = result.choices?.[0]?.message?.content?.trim()
      if (!assistantContent) throw new Error('inference_empty')
      setResponseText(assistantContent)
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message === 'authentication_required') {
        goTo('/login')
        return
      }
      setInferenceError(messageForError(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const loadModels = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const result = await requestJson<ModelListResponse>('/api/models')
      if (!Array.isArray(result.models)) throw new Error('model_list_failed')
      setModels(result.models)
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === 'authentication_required') {
        goTo('/login')
        return
      }
      setError(messageForError(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  return (
    <section className="models-section client-catalog-section" aria-labelledby="client-models-title">
      <div className="section-heading">
        <div>
          <p className="platform-kicker">Client catalog / 03</p>
          <h2 id="client-models-title">Available models</h2>
        </div>
        <span className="model-list-count" aria-label={`${models.length} available models`}>
          {!isLoading && !error ? models.length : '—'}
        </span>
      </div>
      <p className="client-catalog__lede">
        Only enabled models from enabled providers with an active client entitlement appear here.
      </p>

      {isLoading ? (
        <div className="client-catalog-state" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" />
          <p>Loading available models…</p>
        </div>
      ) : error ? (
        <div className="client-catalog-state client-catalog-state--error" role="alert">
          <h3>Catalog unavailable.</h3>
          <p>{error}</p>
          <button className="platform-button platform-button--quiet" type="button" onClick={() => void loadModels()}>
            Try again
          </button>
        </div>
      ) : models.length === 0 ? (
        <div className="client-catalog-state client-catalog-state--empty" role="status">
          <span className="empty-state__glyph" aria-hidden="true">∅</span>
          <div>
            <h3>No models available yet.</h3>
            <p>Ask an administrator to enable a model for this client.</p>
          </div>
        </div>
      ) : (
        <ul className="client-model-list">
          {models.map((model) => (
            <li className="client-model-row" key={model.id}>
              <div className="client-model-row__heading">
                <div>
                  <h3>{model.displayName}</h3>
                  <p className="client-model-provider">{model.provider.name} · {model.provider.kind}</p>
                </div>
                <span className="key-status key-status--active">Available</span>
              </div>
              {model.description && <p className="client-model-description">{model.description}</p>}
              <dl className="client-model-details">
                <div>
                  <dt>Identifier</dt>
                  <dd><code>{model.providerModelId}</code></dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{formatNumber(model.contextWindow)} tokens</dd>
                </div>
                <div>
                  <dt>Max output</dt>
                  <dd>{formatNumber(model.maxOutputTokens)} tokens</dd>
                </div>
                <div>
                  <dt>Input price</dt>
                  <dd>{formatNumber(model.inputPriceMicros)} micros / token</dd>
                </div>
                <div>
                  <dt>Output price</dt>
                  <dd>{formatNumber(model.outputPriceMicros)} micros / token</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {models.length > 0 && (
        <section className="client-inference" aria-labelledby="client-inference-title">
          <div className="client-inference__intro">
            <p className="platform-kicker">Inference console</p>
            <h3 id="client-inference-title">Send a bounded request</h3>
            <p>Choose one of your entitled models and submit a short prompt through the protected provider proxy.</p>
          </div>

          <form className="client-inference__form" onSubmit={handleInferenceSubmit}>
            <div className="client-inference__field">
              <label htmlFor="client-model-select">Model</label>
              <select
                id="client-model-select"
                name="model"
                value={selectedModelId || models[0]?.id || ''}
                onChange={(event) => setSelectedModelId(event.target.value)}
                disabled={isSubmitting}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName} · {model.provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="client-inference__field">
              <label htmlFor="client-prompt">Prompt</label>
              <textarea
                id="client-prompt"
                name="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={4000}
                placeholder="Ask the selected model something…"
                disabled={isSubmitting}
              />
              <span className="client-inference__hint">
                {prompt.length}/4000 characters · only your prompt is sent
              </span>
            </div>

            <div className="client-inference__actions">
              <button className="platform-button" type="submit" disabled={isSubmitting || !prompt.trim()}>
                {isSubmitting ? 'Running…' : 'Run inference'}
              </button>
              {isSubmitting && (
                <p className="client-inference__status" role="status" aria-live="polite">
                  Waiting for the provider response…
                </p>
              )}
            </div>

            {inferenceError && (
              <p className="client-inference__status client-inference__status--error" role="alert">
                {inferenceError}
              </p>
            )}
            {responseText && (
              <div className="client-inference__response" role="status" aria-live="polite">
                <h4>Assistant response</h4>
                <p>{responseText}</p>
              </div>
            )}
          </form>
        </section>
      )}
    </section>
  )
}

function ProviderFields({
  values,
  idPrefix,
  onChange,
  isEditing,
}: {
  values: ProviderFormValues
  idPrefix: string
  onChange: ProviderFieldChange
  isEditing: boolean
}) {
  const credentialHintId = `${idPrefix}-credential-hint`

  return (
    <div className="provider-form-grid">
      <div className="provider-field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          name={`${idPrefix}-name`}
          value={values.name}
          onChange={(event) => onChange('name', event.target.value)}
          placeholder="OpenRouter production"
          maxLength={80}
          autoComplete="organization"
          required
        />
      </div>

      <div className="provider-field">
        <label htmlFor={`${idPrefix}-slug`}>Slug</label>
        <input
          id={`${idPrefix}-slug`}
          name={`${idPrefix}-slug`}
          value={values.slug}
          onChange={(event) => onChange('slug', event.target.value)}
          placeholder="openrouter"
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>

      <div className="provider-field">
        <label htmlFor={`${idPrefix}-kind`}>Provider kind</label>
        <select
          id={`${idPrefix}-kind`}
          name={`${idPrefix}-kind`}
          value={values.providerKind}
          onChange={(event) => onChange('providerKind', event.target.value as ProviderKind)}
          required
        >
          {PROVIDER_KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="provider-field">
        <label htmlFor={`${idPrefix}-base-url`}>Base URL</label>
        <input
          id={`${idPrefix}-base-url`}
          name={`${idPrefix}-base-url`}
          type="url"
          inputMode="url"
          value={values.baseUrl}
          onChange={(event) => onChange('baseUrl', event.target.value)}
          placeholder="https://openrouter.example/v1"
          maxLength={500}
          autoComplete="url"
          spellCheck={false}
          required
        />
      </div>

      <div className="provider-field provider-field--wide">
        <label htmlFor={`${idPrefix}-credential`}>
          Credential{isEditing ? ' (optional replacement)' : ''}
        </label>
        <input
          id={`${idPrefix}-credential`}
          name={`${idPrefix}-credential`}
          type="password"
          value={values.credential}
          onChange={(event) => onChange('credential', event.target.value)}
          placeholder={isEditing ? 'Leave blank to keep the current credential' : 'Enter provider credential'}
          maxLength={10_000}
          autoComplete="new-password"
          aria-describedby={credentialHintId}
          required={!isEditing}
        />
        <p id={credentialHintId} className="field-hint">
          {isEditing
            ? 'Leave blank to keep the current credential. Credentials are never shown again.'
            : 'Stored encrypted and never returned to the browser after saving.'}
        </p>
      </div>

      <label className="provider-checkbox provider-field--wide" htmlFor={`${idPrefix}-enabled`}>
        <input
          id={`${idPrefix}-enabled`}
          name={`${idPrefix}-enabled`}
          type="checkbox"
          checked={values.enabled}
          onChange={(event) => onChange('enabled', event.target.checked)}
        />
        <span>
          <strong>Enabled</strong>
          <small>Allow this provider to be used by the platform.</small>
        </span>
      </label>
    </div>
  )
}

function ModelFields({
  values,
  idPrefix,
  onChange,
  isEditing,
  providers,
}: {
  values: ModelFormValues
  idPrefix: string
  onChange: ModelFieldChange
  isEditing: boolean
  providers: Provider[]
}) {
  const metadataHintId = `${idPrefix}-metadata-hint`
  const providerHintId = `${idPrefix}-provider-hint`

  return (
    <div className="model-form-grid">
      <div className="model-field model-field--wide">
        <label htmlFor={`${idPrefix}-provider`}>Provider</label>
        <select
          id={`${idPrefix}-provider`}
          name={`${idPrefix}-provider`}
          value={values.providerId}
          onChange={(event) => onChange('providerId', event.target.value)}
          aria-describedby={providerHintId}
          disabled={providers.length === 0}
          required
        >
          <option value="">Select a provider</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} · {provider.slug}{provider.enabled ? '' : ' (disabled)'}
            </option>
          ))}
        </select>
        <p id={providerHintId} className="field-hint">
          {providers.length > 0
            ? 'Credentials stay with the provider and are never included in model requests.'
            : 'Add a provider before registering a model.'}
        </p>
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-provider-model-id`}>Provider model identifier</label>
        <input
          id={`${idPrefix}-provider-model-id`}
          name={`${idPrefix}-provider-model-id`}
          value={values.providerModelId}
          onChange={(event) => onChange('providerModelId', event.target.value)}
          placeholder="openai/gpt-4o"
          maxLength={160}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-display-name`}>Display name</label>
        <input
          id={`${idPrefix}-display-name`}
          name={`${idPrefix}-display-name`}
          value={values.displayName}
          onChange={(event) => onChange('displayName', event.target.value)}
          placeholder="Gitu GPT-4o"
          maxLength={120}
          required
        />
      </div>

      <div className="model-field model-field--wide">
        <label htmlFor={`${idPrefix}-description`}>Description</label>
        <textarea
          id={`${idPrefix}-description`}
          name={`${idPrefix}-description`}
          value={values.description}
          onChange={(event) => onChange('description', event.target.value)}
          placeholder="A short description for the model catalog."
          maxLength={10_000}
          rows={3}
        />
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-context-window`}>Context window (tokens)</label>
        <input
          id={`${idPrefix}-context-window`}
          name={`${idPrefix}-context-window`}
          type="number"
          inputMode="numeric"
          min="0"
          max="2147483647"
          step="1"
          value={values.contextWindow}
          onChange={(event) => onChange('contextWindow', event.target.value)}
          required
        />
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-max-output-tokens`}>Max output tokens</label>
        <input
          id={`${idPrefix}-max-output-tokens`}
          name={`${idPrefix}-max-output-tokens`}
          type="number"
          inputMode="numeric"
          min="0"
          max="2147483647"
          step="1"
          value={values.maxOutputTokens}
          onChange={(event) => onChange('maxOutputTokens', event.target.value)}
          required
        />
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-input-price`}>Input price (micros)</label>
        <input
          id={`${idPrefix}-input-price`}
          name={`${idPrefix}-input-price`}
          type="number"
          inputMode="numeric"
          min="0"
          max="9000000000000000"
          step="1"
          value={values.inputPriceMicros}
          onChange={(event) => onChange('inputPriceMicros', event.target.value)}
          required
        />
      </div>

      <div className="model-field">
        <label htmlFor={`${idPrefix}-output-price`}>Output price (micros)</label>
        <input
          id={`${idPrefix}-output-price`}
          name={`${idPrefix}-output-price`}
          type="number"
          inputMode="numeric"
          min="0"
          max="9000000000000000"
          step="1"
          value={values.outputPriceMicros}
          onChange={(event) => onChange('outputPriceMicros', event.target.value)}
          required
        />
      </div>

      <div className="model-field model-field--wide">
        <label htmlFor={`${idPrefix}-metadata`}>Metadata (JSON)</label>
        <textarea
          id={`${idPrefix}-metadata`}
          name={`${idPrefix}-metadata`}
          value={values.metadata}
          onChange={(event) => onChange('metadata', event.target.value)}
          aria-describedby={metadataHintId}
          placeholder={'{"modalities":["text"]}'}
          rows={4}
          spellCheck={false}
          required
        />
        <p id={metadataHintId} className="field-hint">
          Supported metadata is a JSON object for capabilities or routing. Do not include credentials.
        </p>
      </div>

      <label className="model-checkbox model-field--wide" htmlFor={`${idPrefix}-enabled`}>
        <input
          id={`${idPrefix}-enabled`}
          name={`${idPrefix}-enabled`}
          type="checkbox"
          checked={values.enabled}
          onChange={(event) => onChange('enabled', event.target.checked)}
        />
        <span>
          <strong>{isEditing ? 'Available' : 'Register as available'}</strong>
          <small>Allow entitled clients to use this model when its provider is enabled.</small>
        </span>
      </label>
    </div>
  )
}

function ProviderManagement() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [form, setForm] = useState<ProviderFormValues>(() => emptyProviderForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState<ProviderFormValues>(() => emptyProviderForm())
  const [formError, setFormError] = useState('')
  const [editingError, setEditingError] = useState('')
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isForbidden, setIsForbidden] = useState(false)
  const [isMutating, setIsMutating] = useState(false)

  const handleProviderFailure = useCallback((providerError: unknown, listFailure = false) => {
    const code = providerError instanceof Error ? providerError.message : 'request_failed'
    const message = messageForError(providerError)
    if (code === 'authentication_required') {
      goTo('/login')
      return
    }
    if (code === 'admin_required') setIsForbidden(true)
    if (listFailure) setListError(message)
    setError(message)
  }, [])

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setListError('')
    try {
      const result = await requestJson<ProviderListResponse>('/api/admin/providers')
      if (!Array.isArray(result.providers)) throw new Error('provider_list_failed')
      setProviders(result.providers)
    } catch (loadError) {
      handleProviderFailure(loadError, true)
    } finally {
      setIsLoading(false)
    }
  }, [handleProviderFailure])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  function updateForm<K extends keyof ProviderFormValues>(field: K, value: ProviderFormValues[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateEditingForm<K extends keyof ProviderFormValues>(field: K, value: ProviderFormValues[K]) {
    setEditingForm((current) => ({ ...current, [field]: value }))
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setError('')
    setNotice('')
    const validationError = validateProviderForm(form, false)
    if (validationError) {
      setFormError(validationError)
      return
    }

    setIsMutating(true)
    try {
      const result = await requestJson<ProviderMutationResponse>('/api/admin/providers', {
        method: 'POST',
        body: JSON.stringify(providerWritePayload(form, true)),
      })
      if (!result.provider) throw new Error('provider_create_failed')
      setProviders((current) => [result.provider, ...current])
      setForm(emptyProviderForm())
      setNotice('Provider added successfully.')
    } catch (createError) {
      handleProviderFailure(createError)
    } finally {
      setIsMutating(false)
    }
  }

  function beginEdit(provider: Provider) {
    setEditingId(provider.id)
    setEditingForm({
      name: provider.name,
      slug: provider.slug,
      providerKind: provider.providerKind,
      baseUrl: provider.baseUrl,
      credential: '',
      enabled: provider.enabled,
    })
    setEditingError('')
    setError('')
    setNotice('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingForm(emptyProviderForm())
    setEditingError('')
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    setEditingError('')
    setError('')
    setNotice('')
    const validationError = validateProviderForm(editingForm, true)
    if (validationError) {
      setEditingError(validationError)
      return
    }

    setIsMutating(true)
    try {
      const result = await requestJson<ProviderMutationResponse>(`/api/admin/providers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(providerWritePayload(editingForm, Boolean(editingForm.credential))),
      })
      if (!result.provider) throw new Error('provider_update_failed')
      setProviders((current) => current.map((provider) => (provider.id === id ? result.provider : provider)))
      cancelEdit()
      setNotice('Provider updated successfully.')
    } catch (updateError) {
      handleProviderFailure(updateError)
    } finally {
      setIsMutating(false)
    }
  }

  async function handleSetEnabled(provider: Provider, enabled: boolean) {
    const action = enabled ? 'Enable' : 'Disable'
    if (!window.confirm(`${action} ${provider.name}?`)) return
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      const result = await requestJson<ProviderMutationResponse>(
        `/api/admin/providers/${provider.id}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
      )
      if (!result.provider) throw new Error('provider_status_update_failed')
      setProviders((current) => current.map((candidate) => (candidate.id === provider.id ? result.provider : candidate)))
      setNotice(`Provider ${enabled ? 'enabled' : 'disabled'} successfully.`)
    } catch (statusError) {
      handleProviderFailure(statusError)
    } finally {
      setIsMutating(false)
    }
  }

  async function handleDelete(provider: Provider) {
    if (!window.confirm(`Delete ${provider.name}? This cannot be undone.`)) return
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      await requestJson<{ ok: true }>(`/api/admin/providers/${provider.id}`, { method: 'DELETE' })
      setProviders((current) => current.filter((candidate) => candidate.id !== provider.id))
      if (editingId === provider.id) cancelEdit()
      setNotice('Provider deleted successfully.')
    } catch (deleteError) {
      handleProviderFailure(deleteError)
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <>
      <section className="providers-section" aria-labelledby="providers-title">
      <div className="section-heading">
        <div>
          <p className="platform-kicker">Operations / 03</p>
          <h2 id="providers-title">Providers</h2>
        </div>
        <span className="section-count">{providers.length.toString().padStart(2, '0')} total</span>
      </div>

      {notice && <p className="form-alert form-alert--success provider-feedback" role="status">{notice}</p>}
      {error && !isForbidden && <p className="form-alert form-alert--error provider-feedback" role="alert">{error}</p>}

      {isForbidden ? (
        <div className="provider-state provider-state--error platform-card" role="alert">
          <p className="platform-eyebrow">Access control</p>
          <h3>Admin access required.</h3>
          <p>{error || 'Administrator access is required to manage providers.'}</p>
        </div>
      ) : (
        <div className="provider-management-grid">
          <div className="platform-card provider-form-card">
            <div className="card-heading">
              <div>
                <p className="platform-eyebrow">Provider registry</p>
                <h3>Add provider</h3>
              </div>
              <span className="endpoint-method">NEW</span>
            </div>

            {formError && <p className="form-alert form-alert--error provider-feedback" role="alert">{formError}</p>}
            <form className="platform-form provider-form" onSubmit={handleCreate}>
              <fieldset className="provider-fieldset" disabled={isMutating}>
                <legend className="sr-only">Add a provider</legend>
                <ProviderFields values={form} idPrefix="new-provider" onChange={updateForm} isEditing={false} />
                <div className="provider-form__actions">
                  <button className="platform-button platform-button--primary" type="submit">
                    {isMutating ? 'Adding provider…' : 'Add provider'}
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </fieldset>
            </form>
          </div>

          <div className="platform-card provider-list-card">
            <div className="card-heading">
              <div>
                <p className="platform-eyebrow">Connected services</p>
                <h3>Configured providers</h3>
              </div>
              <span className="provider-list-count">{providers.length}</span>
            </div>

            {isLoading ? (
              <div className="provider-state" role="status">
                <span className="status-dot" aria-hidden="true" />
                <p>Loading providers…</p>
              </div>
            ) : listError ? (
              <div className="provider-state provider-state--error">
                <h3>Provider list unavailable.</h3>
                <p>We could not load the provider registry.</p>
                <button className="platform-button platform-button--quiet" type="button" onClick={() => void loadProviders()}>
                  Try again
                </button>
              </div>
            ) : providers.length === 0 ? (
              <div className="provider-state">
                <span className="empty-state__glyph" aria-hidden="true">+</span>
                <h3>No providers yet</h3>
                <p>Add a provider to make a credentialed model service available to the platform.</p>
              </div>
            ) : (
              <ul className="provider-list" aria-label="Configured providers">
                {providers.map((provider) => (
                  <li className="provider-row" key={provider.id}>
                    <div className="provider-row__heading">
                      <div>
                        <h3>{provider.name}</h3>
                        <p className="provider-slug"><code>{provider.slug}</code></p>
                      </div>
                      <span className={`key-status ${provider.enabled ? 'key-status--active' : 'key-status--revoked'}`}>
                        {provider.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    <dl className="provider-details">
                      <div>
                        <dt>Kind</dt>
                        <dd><code>{provider.providerKind}</code></dd>
                      </div>
                      <div>
                        <dt>Base URL</dt>
                        <dd><code>{provider.baseUrl}</code></dd>
                      </div>
                      <div>
                        <dt>Credential</dt>
                        <dd>{provider.hasCredential ? 'Configured' : 'Not configured'}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{formatDate(provider.updatedAt)}</dd>
                      </div>
                    </dl>

                    <div className="provider-actions">
                      <button
                        className="platform-button platform-button--quiet"
                        type="button"
                        onClick={() => beginEdit(provider)}
                        disabled={isMutating}
                      >
                        Edit
                      </button>
                      <button
                        className="platform-button platform-button--quiet"
                        type="button"
                        onClick={() => void handleSetEnabled(provider, !provider.enabled)}
                        disabled={isMutating}
                      >
                        {provider.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        className="platform-button platform-button--quiet provider-button--danger"
                        type="button"
                        onClick={() => void handleDelete(provider)}
                        disabled={isMutating}
                      >
                        Delete
                      </button>
                    </div>

                    {editingId === provider.id && (
                      <form className="platform-form provider-form provider-edit-form" onSubmit={(event) => void handleUpdate(event, provider.id)}>
                        <div className="provider-edit-form__heading">
                          <p className="platform-eyebrow">Edit provider</p>
                          <button className="text-button" type="button" onClick={cancelEdit} disabled={isMutating}>
                            Cancel
                          </button>
                        </div>
                        {editingError && <p className="form-alert form-alert--error provider-feedback" role="alert">{editingError}</p>}
                        <fieldset className="provider-fieldset" disabled={isMutating}>
                          <legend className="sr-only">Edit {provider.name}</legend>
                          <ProviderFields
                            values={editingForm}
                            idPrefix={`edit-provider-${provider.id}`}
                            onChange={updateEditingForm}
                            isEditing
                          />
                          <div className="provider-form__actions">
                            <button className="platform-button platform-button--primary" type="submit">
                              {isMutating ? 'Saving provider…' : 'Save changes'}
                            </button>
                          </div>
                        </fieldset>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      </section>
      <ModelManagement providers={providers} />
    </>
  )
}

function ModelManagement({ providers }: { providers: Provider[] }) {
  const [models, setModels] = useState<RegisteredModel[]>([])
  const [form, setForm] = useState<ModelFormValues>(() => emptyModelForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState<ModelFormValues>(() => emptyModelForm())
  const [formError, setFormError] = useState('')
  const [editingError, setEditingError] = useState('')
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isForbidden, setIsForbidden] = useState(false)
  const [isMutating, setIsMutating] = useState(false)

  const handleModelFailure = useCallback((modelError: unknown, listFailure = false) => {
    const code = modelError instanceof Error ? modelError.message : 'request_failed'
    if (code === 'authentication_required') {
      goTo('/login')
      return
    }
    const message = code === 'admin_required' ? 'Administrator access is required to manage models.' : messageForError(modelError)
    if (code === 'admin_required') setIsForbidden(true)
    if (listFailure) setListError(message)
    setError(message)
  }, [])

  const loadModels = useCallback(async () => {
    setIsLoading(true)
    setError('')
    setListError('')
    try {
      const result = await requestJson<ModelListResponse>('/api/admin/models')
      if (!Array.isArray(result.models)) throw new Error('model_list_failed')
      setModels(result.models)
    } catch (loadError) {
      handleModelFailure(loadError, true)
    } finally {
      setIsLoading(false)
    }
  }, [handleModelFailure])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  function updateForm<K extends keyof ModelFormValues>(field: K, value: ModelFormValues[K]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updateEditingForm<K extends keyof ModelFormValues>(field: K, value: ModelFormValues[K]) {
    setEditingForm((current) => ({ ...current, [field]: value }))
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setError('')
    setNotice('')
    if (providers.length === 0) {
      setFormError('Add a provider before registering a model.')
      return
    }
    const validationError = validateModelForm(form)
    if (validationError) {
      setFormError(validationError)
      return
    }

    setIsMutating(true)
    try {
      const result = await requestJson<ModelMutationResponse>('/api/admin/models', {
        method: 'POST',
        body: JSON.stringify(modelWritePayload(form)),
      })
      if (!result.model) throw new Error('model_create_failed')
      setModels((current) => [result.model, ...current])
      setForm(emptyModelForm())
      setNotice('Model registered successfully.')
    } catch (createError) {
      handleModelFailure(createError)
    } finally {
      setIsMutating(false)
    }
  }

  function beginEdit(model: RegisteredModel) {
    setEditingId(model.id)
    setEditingForm(modelFormFromModel(model))
    setEditingError('')
    setError('')
    setNotice('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingForm(emptyModelForm())
    setEditingError('')
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    setEditingError('')
    setError('')
    setNotice('')
    const validationError = validateModelForm(editingForm)
    if (validationError) {
      setEditingError(validationError)
      return
    }

    setIsMutating(true)
    try {
      const result = await requestJson<ModelMutationResponse>(`/api/admin/models/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(modelWritePayload(editingForm)),
      })
      if (!result.model) throw new Error('model_update_failed')
      setModels((current) => current.map((model) => (model.id === id ? result.model : model)))
      cancelEdit()
      setNotice('Model updated successfully.')
    } catch (updateError) {
      handleModelFailure(updateError)
    } finally {
      setIsMutating(false)
    }
  }

  async function handleSetEnabled(model: RegisteredModel, enabled: boolean) {
    const action = enabled ? 'Enable' : 'Disable'
    if (!window.confirm(`${action} ${model.displayName}?`)) return
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      const result = await requestJson<ModelMutationResponse>(
        `/api/admin/models/${model.id}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
      )
      if (!result.model) throw new Error('model_status_update_failed')
      setModels((current) => current.map((candidate) => (candidate.id === model.id ? result.model : candidate)))
      setNotice(`Model ${enabled ? 'enabled' : 'disabled'} successfully.`)
    } catch (statusError) {
      handleModelFailure(statusError)
    } finally {
      setIsMutating(false)
    }
  }

  async function handleDelete(model: RegisteredModel) {
    if (!window.confirm(`Delete ${model.displayName}? This cannot be undone.`)) return
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      await requestJson<{ ok: true }>(`/api/admin/models/${model.id}`, { method: 'DELETE' })
      setModels((current) => current.filter((candidate) => candidate.id !== model.id))
      if (editingId === model.id) cancelEdit()
      setNotice('Model deleted successfully.')
    } catch (deleteError) {
      handleModelFailure(deleteError)
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <>
      <section className="models-section" aria-labelledby="models-title">
      <div className="section-heading">
        <div>
          <p className="platform-kicker">Operations / 04</p>
          <h2 id="models-title">Models</h2>
        </div>
        <span className="section-count">{models.length.toString().padStart(2, '0')} total</span>
      </div>

      {notice && <p className="form-alert form-alert--success model-feedback" role="status">{notice}</p>}
      {error && !isForbidden && <p className="form-alert form-alert--error model-feedback" role="alert">{error}</p>}

      {isForbidden ? (
        <div className="model-state model-state--error platform-card" role="alert">
          <p className="platform-eyebrow">Access control</p>
          <h3>Admin access required.</h3>
          <p>{error || 'Administrator access is required to manage models.'}</p>
        </div>
      ) : (
        <div className="model-management-grid">
          <div className="platform-card model-form-card">
            <div className="card-heading">
              <div>
                <p className="platform-eyebrow">Model registry</p>
                <h3>Register model</h3>
              </div>
              <span className="endpoint-method">NEW</span>
            </div>

            {formError && <p className="form-alert form-alert--error model-feedback" role="alert">{formError}</p>}
            <form className="platform-form model-form" onSubmit={handleCreate}>
              <fieldset className="model-fieldset" disabled={isMutating}>
                <legend className="sr-only">Register a model</legend>
                <ModelFields values={form} idPrefix="new-model" onChange={updateForm} isEditing={false} providers={providers} />
                <div className="model-form__actions">
                  <button className="platform-button platform-button--primary" type="submit" disabled={providers.length === 0}>
                    {isMutating ? 'Registering model…' : 'Register model'}
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </fieldset>
            </form>
          </div>

          <div className="platform-card model-list-card">
            <div className="card-heading">
              <div>
                <p className="platform-eyebrow">Catalog entries</p>
                <h3>Registered models</h3>
              </div>
              <span className="model-list-count">{models.length}</span>
            </div>

            {isLoading ? (
              <div className="model-state" role="status">
                <span className="status-dot" aria-hidden="true" />
                <p>Loading models…</p>
              </div>
            ) : listError ? (
              <div className="model-state model-state--error">
                <h3>Model registry unavailable.</h3>
                <p>We could not load the registered models.</p>
                <button className="platform-button platform-button--quiet" type="button" onClick={() => void loadModels()}>
                  Try again
                </button>
              </div>
            ) : models.length === 0 ? (
              <div className="model-state">
                <span className="empty-state__glyph" aria-hidden="true">+</span>
                <h3>No models registered</h3>
                <p>Register a model and associate it with a configured provider to build the catalog.</p>
              </div>
            ) : (
              <ul className="model-list" aria-label="Registered models">
                {models.map((model) => (
                  <li className="model-row" key={model.id}>
                    <div className="model-row__heading">
                      <div>
                        <h3>{model.displayName}</h3>
                        <p className="model-identifier"><code>{model.providerModelId}</code></p>
                      </div>
                      <span className={`key-status ${model.enabled ? 'key-status--active' : 'key-status--revoked'}`}>
                        {model.enabled ? 'Available' : 'Disabled'}
                      </span>
                    </div>

                    <p className="model-description">{model.description || 'No description provided.'}</p>

                    <dl className="model-details">
                      <div>
                        <dt>Provider</dt>
                        <dd>{model.provider.name} <code>({model.provider.kind})</code>{model.provider.enabled ? '' : ' · disabled'}</dd>
                      </div>
                      <div>
                        <dt>Context window</dt>
                        <dd>{formatNumber(model.contextWindow)} tokens</dd>
                      </div>
                      <div>
                        <dt>Max output</dt>
                        <dd>{formatNumber(model.maxOutputTokens)} tokens</dd>
                      </div>
                      <div>
                        <dt>Input price</dt>
                        <dd>{formatNumber(model.inputPriceMicros)} micros</dd>
                      </div>
                      <div>
                        <dt>Output price</dt>
                        <dd>{formatNumber(model.outputPriceMicros)} micros</dd>
                      </div>
                      <div className="model-detail--wide">
                        <dt>Metadata</dt>
                        <dd><code className="model-metadata">{JSON.stringify(model.metadata) || '{}'}</code></dd>
                      </div>
                    </dl>

                    <div className="model-actions">
                      <button className="platform-button platform-button--quiet" type="button" onClick={() => beginEdit(model)} disabled={isMutating}>
                        Edit
                      </button>
                      <button className="platform-button platform-button--quiet" type="button" onClick={() => void handleSetEnabled(model, !model.enabled)} disabled={isMutating}>
                        {model.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button className="platform-button platform-button--quiet model-button--danger" type="button" onClick={() => void handleDelete(model)} disabled={isMutating}>
                        Delete
                      </button>
                    </div>

                    {editingId === model.id && (
                      <form className="platform-form model-form model-edit-form" onSubmit={(event) => void handleUpdate(event, model.id)}>
                        <div className="model-edit-form__heading">
                          <p className="platform-eyebrow">Edit model</p>
                          <button className="text-button" type="button" onClick={cancelEdit} disabled={isMutating}>
                            Cancel
                          </button>
                        </div>
                        {editingError && <p className="form-alert form-alert--error model-feedback" role="alert">{editingError}</p>}
                        <fieldset className="model-fieldset" disabled={isMutating}>
                          <legend className="sr-only">Edit {model.displayName}</legend>
                          <ModelFields
                            values={editingForm}
                            idPrefix={`edit-model-${model.id}`}
                            onChange={updateEditingForm}
                            isEditing
                            providers={providers}
                          />
                          <div className="model-form__actions">
                            <button className="platform-button platform-button--primary" type="submit">
                              {isMutating ? 'Saving model…' : 'Save changes'}
                            </button>
                          </div>
                        </fieldset>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
    <EntitlementManagement models={models} />
    </>
  )
}

function EntitlementManagement({ models }: { models: RegisteredModel[] }) {
  const [userId, setUserId] = useState('')
  const [modelId, setModelId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isMutating, setIsMutating] = useState(false)

  const selectedModel = models.find((model) => model.id === modelId)

  function validateEntitlement(): string {
    const normalizedUserId = userId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUserId)) {
      return 'Enter a valid client user ID in UUID format.'
    }
    if (!modelId) return 'Choose a registered model.'
    if (!models.some((model) => model.id === modelId)) return 'Choose a registered model.'
    return ''
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    const validationError = validateEntitlement()
    if (validationError) {
      setError(validationError)
      return
    }

    setIsMutating(true)
    try {
      const result = await requestJson<{
        entitlement: {
          user_id: string
          model_id: string
          enabled: boolean
          updated_at: string
        }
      }>('/api/admin/model-entitlements', {
        method: 'PUT',
        body: JSON.stringify({ userId: userId.trim(), modelId, enabled }),
      })
      if (!result.entitlement) throw new Error('entitlement_update_failed')
      setNotice(`${enabled ? 'Enabled' : 'Disabled'} ${selectedModel?.displayName ?? 'the model'} for this client.`)
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message === 'authentication_required') {
        goTo('/login')
        return
      }
      setError(messageForError(submitError))
    } finally {
      setIsMutating(false)
    }
  }

  return (
    <section className="entitlements-section" aria-labelledby="entitlements-title">
      <div className="section-heading">
        <div>
          <p className="platform-kicker">Access policy / 05</p>
          <h2 id="entitlements-title">Client availability</h2>
        </div>
        <span className="endpoint-method">PUT</span>
      </div>
      <div className="platform-card entitlement-card">
        <p className="card-copy">
          Set the enabled state for one client and one registered model. This uses the server&apos;s entitlement upsert; no client directory endpoint is assumed.
        </p>
        {notice && <p className="form-alert form-alert--success entitlement-feedback" role="status">{notice}</p>}
        {error && <p className="form-alert form-alert--error entitlement-feedback" role="alert">{error}</p>}

        {models.length === 0 ? (
          <div className="entitlement-state" role="status">
            <span className="empty-state__glyph" aria-hidden="true">∅</span>
            <div>
              <h3>Register a model first.</h3>
              <p>Client availability can be assigned after at least one model is registered.</p>
            </div>
          </div>
        ) : (
          <form className="platform-form entitlement-form" onSubmit={handleSubmit}>
            <fieldset className="entitlement-fieldset" disabled={isMutating}>
              <legend className="sr-only">Client model availability</legend>
              <div className="entitlement-form-grid">
                <div className="entitlement-field">
                  <label htmlFor="entitlement-user-id">Client user ID</label>
                  <input
                    id="entitlement-user-id"
                    name="entitlement-user-id"
                    type="text"
                    value={userId}
                    onChange={(event) => setUserId(event.target.value)}
                    placeholder="xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={36}
                    pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
                    aria-describedby="entitlement-user-hint"
                    required
                  />
                  <p id="entitlement-user-hint" className="field-hint">Use the client account UUID. The server validates it before writing.</p>
                </div>
                <div className="entitlement-field">
                  <label htmlFor="entitlement-model-id">Registered model</label>
                  <select
                    id="entitlement-model-id"
                    name="entitlement-model-id"
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    required
                  >
                    <option value="">Choose a registered model</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName} · {model.provider.name}{!model.enabled || !model.provider.enabled ? ' (currently unavailable)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">The client catalog also requires the model and provider to be enabled.</p>
                </div>
              </div>
              <label className="entitlement-checkbox" htmlFor="entitlement-enabled">
                <input
                  id="entitlement-enabled"
                  name="entitlement-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span>
                  <strong>Available to this client</strong>
                  <small>Enabled writes an active entitlement; clearing it writes enabled: false.</small>
                </span>
              </label>
              <p className="field-hint entitlement-endpoint-hint">PUT /api/admin/model-entitlements upserts the selected client/model pair.</p>
              <div className="entitlement-form__actions">
                <button className="platform-button platform-button--primary" type="submit" disabled={isMutating}>
                  {isMutating ? 'Saving availability…' : 'Save availability'}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  )
}

function Dashboard({ path }: { path: ProtectedDashboardPath }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isForbidden, setIsForbidden] = useState(false)
  const [isMutating, setIsMutating] = useState(false)

  const loadDashboard = useCallback(async () => {
    try {
      const [{ user: currentUser }, { keys: currentKeys }] = await Promise.all([
        requestJson<{ user: AuthUser }>('/api/auth/me'),
        requestJson<{ keys: ApiKey[] }>('/api/keys'),
      ])
      if (!currentUser || !Array.isArray(currentKeys)) {
        throw new Error('request_failed')
      }
      if (path === '/admin' && currentUser.role !== 'admin') {
        setIsForbidden(true)
        return
      }
      setUser(currentUser)
      setKeys(currentKeys)
    } catch (loadError) {
      if (loadError instanceof Error && loadError.message === 'authentication_required') {
        goTo('/login')
        return
      }
      setError(messageForError(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [path])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      const result = await requestJson<KeyResponse>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      })
      setKeys((current) => [result.key, ...current])
      setName('')
      setToken(result.token ?? null)
    } catch (createError) {
      setError(messageForError(createError))
    } finally {
      setIsMutating(false)
    }
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) return
    setError('')
    setIsMutating(true)
    try {
      const result = await requestJson<{ key: ApiKey }>(`/api/keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editingName.trim() }),
      })
      setKeys((current) => current.map((key) => (key.id === id ? result.key : key)))
      setEditingId(null)
      setEditingName('')
      setNotice('Key name updated.')
    } catch (renameError) {
      setError(messageForError(renameError))
    } finally {
      setIsMutating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm('Revoke this API key? Applications using it will stop authenticating.')) return
    setError('')
    setIsMutating(true)
    try {
      const result = await requestJson<{ key: ApiKey }>(`/api/keys/${id}/revoke`, { method: 'POST' })
      setKeys((current) => current.map((key) => (key.id === id ? result.key : key)))
      setNotice('Key revoked. It can no longer authenticate requests.')
    } catch (revokeError) {
      setError(messageForError(revokeError))
    } finally {
      setIsMutating(false)
    }
  }

  async function handleRotate(id: string) {
    setError('')
    setNotice('')
    setIsMutating(true)
    try {
      const result = await requestJson<KeyResponse>(`/api/keys/${id}/rotate`, { method: 'POST' })
      setKeys((current) => [result.key, ...current.map((key) => (key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key))])
      setToken(result.token ?? null)
    } catch (rotateError) {
      setError(messageForError(rotateError))
    } finally {
      setIsMutating(false)
    }
  }

  async function handleLogout() {
    setIsMutating(true)
    try {
      await requestJson<{ ok: true }>('/api/auth/logout', { method: 'POST' })
    } finally {
      goTo('/login')
    }
  }

  if (isLoading) {
    return (
      <main className="platform-shell platform-shell--loading">
        <div className="loading-mark" aria-label="Loading dashboard" role="status">G</div>
      </main>
    )
  }

  if (isForbidden) {
    return (
      <main className="platform-shell platform-shell--dashboard">
        <div className="platform-noise" aria-hidden="true" />
        <section className="dashboard-hero" aria-labelledby="forbidden-title">
          <div>
            <p className="platform-kicker">Access control / 03</p>
            <h1 id="forbidden-title">Admin access required.</h1>
            <p className="platform-lede">
              This workspace is limited to administrator accounts. Return to your client dashboard to continue.
            </p>
            <a className="platform-button platform-button--primary" href="/dashboard">
              Back to dashboard
            </a>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="platform-shell platform-shell--dashboard">
      <div className="platform-noise" aria-hidden="true" />
      <header className="platform-nav">
        <a className="platform-wordmark" href="/" aria-label="Gitu home">
          <span className="platform-mark">G</span>
          <span>gitu</span>
        </a>
        <div className="platform-nav__product">
          <span className="platform-nav__active">Gitu Models</span>
          <span className="platform-badge">Preview</span>
        </div>
        <nav className="platform-nav__links" aria-label="Workspace navigation">
          <a
            className={path === '/app' ? 'platform-nav__link platform-nav__link--active' : 'platform-nav__link'}
            href="/app"
            aria-current={path === '/app' ? 'page' : undefined}
          >
            App
          </a>
          {user?.role === 'admin' && (
            <a
              className={path === '/admin' ? 'platform-nav__link platform-nav__link--active' : 'platform-nav__link'}
              href="/admin"
              aria-current={path === '/admin' ? 'page' : undefined}
            >
              Admin
            </a>
          )}
        </nav>
        <div className="platform-nav__account">
          <span className="platform-user">{user?.email}</span>
          <button className="platform-button platform-button--quiet" type="button" onClick={handleLogout} disabled={isMutating}>
            Sign out
          </button>
        </div>
      </header>

      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div>
          <p className="platform-kicker">Developer workspace / 01</p>
          <h1 id="dashboard-title">Your API surface, ready when the models are.</h1>
          <p className="platform-lede">
            Manage credentials for the upcoming OpenAI-compatible endpoint. Inference, billing, and model
            routing remain planned features—not live services yet.
          </p>
        </div>
        <div className="dashboard-signal">
          <span className="status-dot" aria-hidden="true" />
          <span>Early access queue open</span>
        </div>
      </section>

      {path === '/app' && <ModelEntry path="/app" />}
      {path === '/admin' && <ModelEntry path="/admin" />}
      {path === '/admin' && user?.role === 'admin' && <ProviderManagement />}

      {token && <TokenNotice token={token} onDismiss={() => setToken(null)} />}
      {error && <p className="form-alert form-alert--error dashboard-alert" role="alert">{error}</p>}
      {notice && <p className="form-alert form-alert--success dashboard-alert" role="status">{notice}</p>}

      <section className="dashboard-grid" aria-label="API workspace">
        <div className="platform-card create-key-card">
          <div className="card-heading">
            <div>
              <p className="platform-eyebrow">Credentials</p>
              <h2>Create an API key</h2>
            </div>
            <span className="card-number">02</span>
          </div>
          <p className="card-copy">Keys are displayed once, then only their safe metadata remains visible here.</p>
          <form className="platform-form" onSubmit={handleCreate}>
            <label htmlFor="key-name">Key name</label>
            <input
              id="key-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Local development"
              maxLength={80}
              required
            />
            <button className="platform-button platform-button--primary" type="submit" disabled={isMutating || !name.trim()}>
              {isMutating ? 'Creating…' : 'Create secret key'}
              <span aria-hidden="true">+</span>
            </button>
          </form>
        </div>

        <div className="platform-card endpoint-card">
          <div className="card-heading">
            <div>
              <p className="platform-eyebrow">Planned endpoint</p>
              <h2>One base URL for agents.</h2>
            </div>
            <span className="endpoint-method">POST</span>
          </div>
          <code className="endpoint-url">https://api.gitu.ai/v1</code>
          <div className="endpoint-flow" aria-label="Planned API routing flow">
            <span>Your app</span><i aria-hidden="true">→</i><span>Gitu API</span><i aria-hidden="true">→</i><span>Models</span>
          </div>
          <p className="card-copy">Developer preview only. No inference requests are processed from this workspace yet.</p>
        </div>
      </section>

      <section className="keys-section" aria-labelledby="keys-title">
        <div className="section-heading">
          <div>
            <p className="platform-kicker">Access control / 02</p>
            <h2 id="keys-title">API keys</h2>
          </div>
          <span className="section-count">{keys.length.toString().padStart(2, '0')} total</span>
        </div>

        {keys.length === 0 ? (
          <div className="empty-state platform-card">
            <span className="empty-state__glyph" aria-hidden="true">+</span>
            <div>
              <h3>No keys yet</h3>
              <p>Create a named key when you are ready to connect a local agent or application.</p>
            </div>
          </div>
        ) : (
          <div className="keys-table-wrap platform-card">
            <table className="keys-table">
              <caption className="sr-only">Your Gitu API keys</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const isRevoked = Boolean(key.revokedAt)
                  const isEditing = editingId === key.id
                  return (
                    <tr key={key.id} className={isRevoked ? 'is-revoked' : undefined}>
                      <th scope="row">
                        {isEditing ? (
                          <form className="inline-rename" onSubmit={(event) => { event.preventDefault(); void handleRename(key.id) }}>
                            <label className="sr-only" htmlFor={`rename-${key.id}`}>Rename {key.name}</label>
                            <input id={`rename-${key.id}`} value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={80} autoFocus />
                            <button type="submit" className="text-button">Save</button>
                          </form>
                        ) : (
                          <span className="key-name">{key.name}</span>
                        )}
                      </th>
                      <td><code>{key.prefix}••••{key.lastFour}</code></td>
                      <td>{formatDate(key.createdAt)}</td>
                      <td>{formatDate(key.lastUsedAt)}</td>
                      <td><span className={`key-status ${isRevoked ? 'key-status--revoked' : 'key-status--active'}`}>{isRevoked ? 'Revoked' : 'Active'}</span></td>
                      <td>
                        <div className="key-actions">
                          {!isRevoked && !isEditing && <button type="button" className="text-button" onClick={() => { setEditingId(key.id); setEditingName(key.name) }}>Rename</button>}
                          {!isRevoked && <button type="button" className="text-button" onClick={() => void handleRotate(key.id)} disabled={isMutating}>Rotate</button>}
                          {!isRevoked && <button type="button" className="text-button text-button--danger" onClick={() => void handleRevoke(key.id)} disabled={isMutating}>Revoke</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="platform-footer">
        <span>Gitu Models is a planned developer platform.</span>
        <a href="/">Back to gitu.ai</a>
      </footer>
    </main>
  )
}

export default function ProtectedPlatform() {
  const path = window.location.pathname
  if (isProtectedDashboardPath(path)) return <Dashboard path={path} />
  return <AuthView mode={path === '/register' ? 'register' : 'login'} />
}
