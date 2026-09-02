# Gitu marketing

The repository contains the Gitu marketing site and the PostgreSQL-backed foundation for the future Gitu Models developer platform.

## Local PostgreSQL setup

The server requires Node.js 20.19 or newer and PostgreSQL.

1. Create a local database, for example:

   ```powershell
   createdb gitu_marketing
   ```

2. Set `DATABASE_URL` in the process environment. Keep credentials out of source control:

   ```powershell
   $env:DATABASE_URL = "postgres://USER:PASSWORD@localhost:5432/gitu_marketing"
   ```

3. Apply versioned migrations:

   ```powershell
   npm run db:migrate
   ```

Migrations are stored in `server/db/migrations/` and are tracked in the `schema_migrations` table. The initial migration creates users, server-side sessions, API-key metadata and digests, and audit events. Plaintext passwords and API keys are not stored by the schema.

## Commands

```powershell
npm run dev             # Vite development server
npm run build           # Typecheck and build the marketing site
npm run lint            # ESLint
npm run test            # Vitest
npm run typecheck       # All TypeScript project references
npm run typecheck:server
npm run db:migrate
npm run server
```

Do not commit `.env` files, database credentials, session values, or API-key material. API keys should be displayed only at creation time once the management flow is enabled.

## Production deployment

Build the SPA and run the Fastify server as one service:

```powershell
npm run build
npm run server
```

The production server listens on `0.0.0.0` and defaults to port `8787` (override with `PORT`). It applies pending PostgreSQL migrations before listening, serves `dist/` and the API from one origin, and exposes `GET /health` for readiness checks. Set `DATABASE_URL` and a stable `PROVIDER_ENCRYPTION_KEY` in the runtime environment; the latter must decode from base64url to exactly 32 bytes.

For the complete Coolify service settings, PostgreSQL sequencing, provider configuration contract, first-admin bootstrap procedure, route smoke checks, and unresolved deployment prerequisites, see [COOLIFY-DEPLOYMENT.md](COOLIFY-DEPLOYMENT.md).
