# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Next.js 16 breaking changes

This project uses Next.js 16, which has breaking changes from prior versions — APIs, conventions, and file structure may differ from training data. Before writing any Next.js-specific code, check `node_modules/next/dist/docs/` for current API guidance. Heed deprecation notices in compiler output.

## Commands

```bash
npm run dev          # start dev server on http://localhost:3000
npm run build        # production build (also runs typecheck via tsc)
npm run typecheck    # tsc --noEmit only
npm run lint         # eslint
npm run format       # prettier --write .
npm run format:check # prettier --check .
npm run test         # vitest run (all tests once)
npm run test:watch   # vitest (watch mode)
```

Run a single test file: `npx vitest run src/lib/whatsapp/encryption.test.ts`

## Architecture

**Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + RLS + Realtime) · Meta Cloud API (WhatsApp Business)

### Route layout (`src/app/`)

- `(auth)/` — unauthenticated pages: login, signup, forgot-password
- `(dashboard)/` — protected pages: inbox, contacts, pipelines, broadcasts, automations, settings, flows
- `api/whatsapp/` — Meta webhook receiver + send/media/template/broadcast/config endpoints
- `api/account/` — team members, invitations, API keys, ownership transfer
- `api/v1/` — public REST API (scoped, revocable API keys)
- `api/ai/`, `api/flows/`, `api/automations/` — internal server actions

Auth routing is enforced in `src/middleware.ts`: protected paths redirect to `/login`, authenticated users hitting `/login`/`/signup` redirect to `/dashboard`. Session token refresh cookies are propagated on every response branch (see inline comment about issue #288).

### Domain logic (`src/lib/`)

Each subdirectory is a self-contained module:

| Directory | What lives there |
|---|---|
| `supabase/` | `client.ts` (browser) and `server.ts` (SSR) Supabase client factories |
| `whatsapp/` | Meta API client, webhook HMAC verification, AES-256-GCM token encryption, template lifecycle/status/validators, phone utils |
| `automations/` | Trigger engine, step execution, meta-send adapter, flow validation |
| `flows/` | Visual flow builder engine, edge/node layout, fallback handling |
| `auth/` | Account management, invitations, role definitions, API context helpers |
| `api-keys/` | Key generation, scope enforcement, storage |
| `contacts/` | CSV import, deduplication, tag resolution |
| `dashboard/` | Query helpers, date utilities |
| `ai/` | Anthropic SDK integration |
| `storage/` | Supabase Storage helpers |

Tests are colocated next to source files as `*.test.ts` / `*.test.tsx`. Vitest uses `environment: "node"` and injects dummy `ENCRYPTION_KEY` + `META_APP_SECRET` env vars so tests never need a real Supabase/Meta connection.

### Key security primitives

- **Token encryption:** `src/lib/whatsapp/encryption.ts` — AES-256-GCM, key from `ENCRYPTION_KEY` env var (64-char hex = 32 bytes)
- **Webhook verification:** `src/lib/whatsapp/webhook-signature.ts` — HMAC-SHA256 using `META_APP_SECRET`
- **Rate limiting:** `src/lib/rate-limit.ts`
- **RLS:** every Supabase table has Row Level Security; all data access is account-scoped

### Required environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (64-char hex), `META_APP_SECRET`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`

### Supabase migrations

Schema migrations live in `supabase/migrations/`. Run them via the Supabase CLI (`supabase db push`) against your project.

### Components (`src/components/`)

Feature-scoped UI components organized under `automations/`, `broadcasts/`, `contacts/`, `flows/`, `inbox/`, `pipelines/`, `settings/`, etc. Shared primitives are under `ui/` (shadcn-based) and `tremor/`. `themed-toaster.tsx` wraps `sonner`.
