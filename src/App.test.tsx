import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  failWebGLRenderer: false,
  rendererCreated: false,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()

  class MockWebGLRenderer {
    constructor() {
      if (mockState.failWebGLRenderer) throw new Error('WebGL unavailable')
      mockState.rendererCreated = true
    }

    readonly domElement = Object.assign(document.createElement('canvas'), {
      'aria-label': 'AGENT GITU particle wordmark',
    })
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  }
})

import App from './App'
import ParticleWordmark from './components/ParticleWordmark'
import SiteHeader from './components/SiteHeader'

type MatchMediaListener = (event: MediaQueryListEvent) => void

const navigationLinks = [
  ['Product', '#product'],
  ['Models', '#models'],
  ['Capabilities', '#capabilities'],
  ['How it works', '#how-it-works'],
  ['Benchmarks', '#benchmarks'],
  ['Docs', '#docs'],
  ['GitHub', '#open-source'],
] as const

const sectionIds = [
  'top',
  'product',
  'capabilities',
  'how-it-works',
  'benchmarks',
  'why-gitu',
  'docs',
  'open-source',
  'download',
] as const

class TestResizeObserver implements ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe = (target: Element) => {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this,
    )
  }

  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = () => []
}

function installBrowserApiStubs() {
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const listeners = new Set<MatchMediaListener>()

    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') {
          listeners.add(listener as MatchMediaListener)
        }
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === 'function') {
          listeners.delete(listener as MatchMediaListener)
        }
      },
      addListener: (listener: MatchMediaListener) => {
        listeners.add(listener)
      },
      removeListener: (listener: MatchMediaListener) => {
        listeners.delete(listener)
      },
      dispatchEvent: (event: Event) => {
        listeners.forEach((listener) => listener(event as MediaQueryListEvent))
        return true
      },
    }
  })
}

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value,
  })
}

beforeEach(() => {
  installBrowserApiStubs()
  setScrollY(0)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('marketing site', () => {
  it('renders the hero, CTAs, background wordmark text, and all section anchors', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /ship software\.\s*not prompts\./i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Gitu understands your codebase, plans the work, delegates when necessary/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/executes changes, verifies its own results/i)).toBeInTheDocument()
    expect(screen.getByText(/is actually done\./i)).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /download gitu/i })).toHaveAttribute('href', '#download')
    expect(screen.getByRole('link', { name: /view on github/i })).toHaveAttribute('href', '#open-source')
    expect(screen.getAllByText('AGENT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GITU').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-renderer-contract="direct-three"]')).toBeInTheDocument()

    sectionIds.forEach((id) => {
      expect(document.getElementById(id)).toBeInTheDocument()
    })
  })

  it('renders the planned Gitu Models platform without claiming live availability', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: /one api\. powerful ai models\. built for agents\./i }),
    ).toBeInTheDocument()
    expect(screen.getByText('https://api.gitu.ai/v1')).toBeInTheDocument()
    expect(screen.getByText(/developer preview — endpoint and model availability are coming soon/i)).toBeInTheDocument()
    expect(screen.getByText('Gitu Coder')).toBeInTheDocument()
    expect(screen.getByText('Gitu Reasoner')).toBeInTheDocument()
    expect(screen.getByText('Open Models')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /switch without rewriting your application/i })).toBeInTheDocument()
    expect(screen.getByText('Pricing coming soon')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /join early access/i })).toHaveAttribute('href', '/register')
  })

  it('copies the API preview through the local clipboard interaction', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<App />)

    await user.click(screen.getByRole('button', { name: /copy code/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('https://api.gitu.ai/v1'))
    })
    expect(screen.getByText(/api preview copied to your clipboard/i)).toBeInTheDocument()
  })

  it('renders every header navigation target and the Download link', () => {
    render(<SiteHeader />)

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }))
    const navigation = screen.getByRole('navigation', { name: /primary navigation/i })
    navigationLinks.forEach(([label, href]) => {
      expect(within(navigation).getByRole('link', { name: label })).toHaveAttribute('href', href)
    })
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', '#download')
  })

  it('toggles the mobile menu state and restores focus when Escape closes it', async () => {
    const user = userEvent.setup()
    render(<SiteHeader />)

    const menuButton = screen.getByRole('button', { name: /open navigation menu/i })
    const header = menuButton.closest('header')

    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveAttribute('data-menu-open', 'false')

    await user.click(menuButton)
    expect(screen.getByRole('button', { name: /close navigation menu/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(header).toHaveAttribute('data-menu-open', 'true')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /open navigation menu/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(header).toHaveAttribute('data-menu-open', 'false')
    expect(menuButton).toHaveFocus()
  })

  it('sets the scrolled header state only after window.scrollY crosses 24', async () => {
    render(<SiteHeader />)

    const header = screen.getByRole('banner')
    expect(header).toHaveAttribute('data-scrolled', 'false')
    expect(header).not.toHaveClass('site-header--scrolled')

    setScrollY(25)
    fireEvent.scroll(window)

    await waitFor(() => {
      expect(header).toHaveAttribute('data-scrolled', 'true')
      expect(header).toHaveClass('site-header--scrolled')
    })
  })

  it('exposes ParticleWordmark as an accessible scatter control', async () => {
    const user = userEvent.setup()
    render(<ParticleWordmark />)

    const wordmark = screen.getByRole('button', { name: /interactive agent gitu particle wordmark/i })
    expect(wordmark).toHaveAttribute('tabindex', '0')

    await user.click(wordmark)
    wordmark.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(wordmark).toHaveFocus()
  })

  it('shows the ParticleWordmark fallback when WebGLRenderer construction fails', () => {
    mockState.failWebGLRenderer = true

    try {
      render(<ParticleWordmark />)

      expect(screen.getByRole('button', { name: /interactive agent gitu particle wordmark/i })).toBeInTheDocument()
      expect(screen.getByLabelText(/gitu particle wordmark fallback/i)).toHaveTextContent(/GITU/i)
      expect(screen.getByText(/WebGL fallback \/ AGENT GITU signal stable/i)).toBeInTheDocument()
    } finally {
      mockState.failWebGLRenderer = false
    }
  })
})
