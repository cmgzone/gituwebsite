import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ProtectedPlatform from './components/ProtectedPlatform'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Gitu could not start because the application root is missing.')
}

rootElement.dataset.gituApp = 'react-spa'

const protectedPaths = new Set(['/login', '/register', '/dashboard', '/app', '/admin'])
const isProtectedPath = protectedPaths.has(window.location.pathname)

createRoot(rootElement).render(
  <StrictMode>
    {isProtectedPath ? <ProtectedPlatform /> : <App />}
  </StrictMode>,
)
