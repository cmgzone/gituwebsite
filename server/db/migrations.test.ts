import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

describe('database migrations', () => {
  it('keeps migrations lexically ordered and wraps the reseller schema in a transaction', () => {
    const migrationFiles = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort()

    expect(migrationFiles).toEqual(['001_initial.sql', '002_reseller_platform.sql'])

    const resellerMigration = readFileSync(
      join(migrationsDirectory, '002_reseller_platform.sql'),
      'utf8',
    )

    expect(resellerMigration.trimStart().startsWith('BEGIN;')).toBe(true)
    expect(resellerMigration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(resellerMigration).toContain("VALUES ('002_reseller_platform')")
  })

  it('defines role, entitlement, usage, and encrypted provider storage contracts', () => {
    const resellerMigration = readFileSync(
      join(migrationsDirectory, '002_reseller_platform.sql'),
      'utf8',
    )

    expect(resellerMigration).toContain(
      "ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'",
    )
    expect(resellerMigration).toContain("role IN ('user', 'admin')")
    expect(resellerMigration).toContain('CREATE TABLE IF NOT EXISTS providers')
    expect(resellerMigration).toContain('CREATE TABLE IF NOT EXISTS models')
    expect(resellerMigration).toContain('CREATE TABLE IF NOT EXISTS client_model_entitlements')
    expect(resellerMigration).toContain('CREATE TABLE IF NOT EXISTS inference_usage')
    expect(resellerMigration).toContain('credential_nonce bytea NOT NULL')
    expect(resellerMigration).toContain('credential_ciphertext bytea NOT NULL')
    expect(resellerMigration).toContain('credential_auth_tag bytea NOT NULL')
    expect(resellerMigration).not.toMatch(/provider_api_key|api_key text|secret text/i)
  })
})
