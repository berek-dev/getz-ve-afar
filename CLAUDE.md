# Notes for AI coding sessions

Private internal tool for "גץ ועפר" (Yaal Hagai's metalwork/welding business). Single business, 1–2 users. Free tiers only.

## Stack
- UI: Vite + React 19 + TypeScript + Tailwind v4. Hebrew, `dir="rtl"`, mobile-first (iPhone PWA).
- API: Hono on Cloudflare Pages Functions. Entry `functions/api/[[route]].ts` → `server/app.ts`.
- DB: Cloudflare D1. Schema changes = new numbered file in `migrations/` (never edit applied migrations).
- Auth: one app password (PBKDF2 hash in secret `APP_PASSWORD_HASH`) → HMAC-signed session cookie (`SESSION_SECRET`),
  see `server/auth.ts`; failed logins throttled per IP in D1. Public routes: `/api/health`, `/api/auth/*`,
  `/api/public/*`, and the client quote page `/q/:token`.
- No service that needs a credit card (so no R2, no Zero Trust/Access). Photos go to Workers KV (M2).

## Conventions
- Relative imports include the `.ts`/`.tsx` extension; only erasable TS syntax (no enums, no parameter properties) –
  tests run directly with `node --test` (Node ≥ 22.18 type stripping), no test framework.
- `src/core/` is pure and dependency-free (pricing, quantities, cut lists). Put business logic there, with tests.
- UI strings are Hebrew; code, comments and docs (README, setup instructions) in English.
- Write dimensions as `60/40/2`, never `60×40×2`: in right-to-left text `×`, `°`, `"` and `½` next to digits flip the
  number's order. Inches are written `8 צול`, angles `90 מעלות`.
- Never commit secrets, real client data or real price lists – the repo may be public.

## 3D
- The AI writes layout JSON only (`src/core/scene.ts`); the viewer (`prototype/3d/viewer.js`), cut list and shop
  drawing (`src/core/drawing.ts`) are deterministic code. `npm run build:3d` inlines `src/core` into the page.
- Axes: mm, Y up, ground y = 0, X along the opening, +Z towards the street. Members are cut lengths (butt joints).

## Commands
`npm test` · `npm run typecheck` · `npm run build` · `npm run dev` + `npm run dev:api` · `npm run db:migrate:local|remote`
