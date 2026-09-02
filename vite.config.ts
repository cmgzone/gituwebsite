import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssCodeSplit: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    restoreMocks: true,
    exclude: ['**/node_modules/**', '**/dist/**', '**/.hermes/**'],
  }
})
