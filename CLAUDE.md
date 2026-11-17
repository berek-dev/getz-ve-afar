# Notes for AI coding sessions

Private internal tool for "גץ ועפר" (Yael Hagai's metalwork/welding business). Single business, 1–2 users. Free tiers only.

## Stack
- UI: Vite + React 19 + TypeScript + Tailwind v4. Hebrew, `dir="rtl"`, mobile-first (iPhone PWA).
- API: Hono on Cloudflare Pages Functions. Entry `functions/api/[[route]].ts` → `server/app.ts`.
- DB: Cloudflare D1. Schema changes = new numbered file in `migrations/` (never edit applied migrations).
- Auth: Cloudflare Access at the edge + `server/access.ts` verifies the JWT on every non-public API route.
  Public routes: `/api/health`, `/api/public/*`, and the client quote page `/q/:token`.

## Conventions
- Relative imports include the `.ts`/`.tsx` extension; only erasable TS syntax (no enums, no parameter properties) –
  tests run directly with `node --test` (Node ≥ 22.18 type stripping), no test framework.
- `src/core/` is pure and dependency-free (pricing, quantities, cut lists). Put business logic there, with tests.
- UI strings are Hebrew; code and comments in English unless user-facing.
- Never commit secrets, real client data or real price lists – the repo may be public.

## Commands
`npm test` · `npm run typecheck` · `npm run build` · `npm run dev` + `npm run dev:api` · `npm run db:migrate:local|remote`
