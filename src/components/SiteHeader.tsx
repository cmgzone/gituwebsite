import { useEffect, useRef, useState } from 'react'

type NavigationLink = {
  label: string
  href: `#${string}`
}

const navigationLinks: readonly NavigationLink[] = [
  { label: 'Product', href: '#product' },
  { label: 'Models', href: '#models' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Benchmarks', href: '#benchmarks' },
  { label: 'Docs', href: '#docs' },
  { label: 'GitHub', href: '#open-source' },
]

function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const updateScrollState = () => {
      setIsScrolled(window.scrollY > 24)
    }

    updateScrollState()
    window.addEventListener('scroll', updateScrollState, { passive: true })

    return () => window.removeEventListener('scroll', updateScrollState)
  }, [])

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isMenuOpen])

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1153px)')
    const updateDesktopState = () => setIsDesktop(desktopQuery.matches)
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches)
      if (event.matches) {
        setIsMenuOpen(false)
      }
    }

    updateDesktopState()
    desktopQuery.addEventListener('change', closeOnDesktop)
    return () => desktopQuery.removeEventListener('change', closeOnDesktop)
  }, [])

  const closeMenu = () => setIsMenuOpen(false)

  const headerClassName = [
    'site-header',
    isScrolled ? 'site-header--scrolled' : '',
    isMenuOpen ? 'site-header--menu-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header
      className={headerClassName}
      data-menu-open={isMenuOpen}
      data-scrolled={isScrolled}
      data-verify-surface="primary-navigation"
    >
      <div className="site-header__inner shell">
        <a className="brand-lockup" href="#top" aria-label="Gitu home" onClick={closeMenu}>
          <span className="brand-lockup__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Gitu</span>
        </a>

        <button
          className="site-nav__toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setIsMenuOpen((current) => !current)}
          ref={menuButtonRef}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>

        <div
          className="site-nav__panel"
          id="primary-navigation"
          inert={!(isMenuOpen || isDesktop)}
        >
          {(isMenuOpen || isDesktop) && (
            <>
              <nav className="site-nav" aria-label="Primary navigation">
                <ul>
                  {navigationLinks.map((link) => (
                    <li key={link.href}>
                      <a href={link.href} onClick={closeMenu}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <a className="site-nav__download" href="#download" onClick={closeMenu}>
                <span>Download</span>
                <span aria-hidden="true">↓</span>
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default SiteHeader
