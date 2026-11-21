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

## Structure and look
- Bottom bar: היום (what to do now) · עבודות · ＋ פנייה חדשה · יומן · עסק (money, price list, settings).
- A job is four phases of numbered steps (`src/core/phases.ts`): פנייה, תכנון והצעה, ביצוע, תשלום וסגירה. Steps tick
  themselves off from the job's data; `nextAction` says what to do next. Each step is its own screen, `#/jobs/:id/:step`,
  built in `src/components/JobSteps.tsx` from the existing sections. New features go into a step, not a new tab.
- Planning: שרטוט והדמיה (required for fabrication, optional otherwise) → מחיר וכתב כמויות → לוח זמנים → הצעת מחיר.
  Execution: שרטוט ייצור → הזמנת חומרים → חיתוך → ייצור והתקנה → מסירה. One short line of text per screen; details go behind a tap.
- Look "shop sheet": light, IBM Plex Sans Hebrew only, one orange (`accent`) for the main action of a screen, hairline
  cards (`plate`), steps numbered in circles (`mark`). Use the semantic colors in `src/styles.css`
  (page, card, sunken, line, ink, muted, faint, accent, ok, danger), never raw hex in components.

## 3D
- The AI writes layout JSON only (`src/core/scene.ts`); the viewer (`src/viewer3d/viewer.js`, plain JS shared with the
  prototype, types in `viewer.d.ts`), cut list and shop drawing (`src/core/drawing.ts`) are deterministic code.
  AI instructions: `src/core/layoutPrompt.ts`. `npm run build:3d` inlines `src/core` and the viewer into the prototype.
- three.js is loaded lazily (job tab, client quote page); keep it out of the main bundle.
- Building by hand ("לפי מידות" on the model step, `src/components/DesignBuilder.tsx`): a grid of typed spacings
  (X bays, Y levels, Z depth), members between grid points, base plates and infill bars (`src/core/design.ts`).
  `compileDesign` turns it into the normal layout (joints trimmed as a shop builds them: columns run through, beams
  stop at their faces) and keeps the design inside it as `design`; saved with source `builder`. Plates ("פח", `design.plates`) are placed by two
  opposite grid corners in any view and sit on the face of the frame pieces on their edges (its outside size), inside
  them, or on the grid lines; with nothing around them, on the lines. Blocks
  (`src/core/blocks.ts`: stairs, platform, railing, ladder, gate, tank) are placed by two grid points plus a few numbers;
  their frame pieces go through the same joint rules (a railing post stops on the beam under it). Levels are
  finished floor: stair tops and platform decks sit at the grid level. The grid pinches and pans
  (`src/core/viewport.ts`). Drawing mode ("ציור", `src/core/pen.ts`): a straight stroke is a member, ends between
  grid lines add a line there (`insertGridLine` keeps drawn parts in place), a scribble erases. With a finger (phone)
  two fingers pan; with a pen (tablet) fingers pan, and it switches to the pen by itself at the first pen touch.
  iPhone Safari ignores `touch-action` on SVG elements, so drawing canvases set it on their wrapper div too, and
  `canvasGestures.ts` cancels `touchmove` while a stroke, pinch or pan is on (otherwise the page scrolls mid-stroke).
  A scribble erases the piece it crosses back and forth most (`scribbleTarget`), not only one most points lie on.
  Drawing by hand first: an empty builder offers "לצייר ביד", a blank page (`SketchPad.tsx`, `src/core/sketch.ts`)
  where strokes straighten and snap to each other; "המשך למידות" turns them into a grid. Spacings placed by eye are
  guesses (`design.guess`, filled pills) until typed; the first number typed into an all-guess design scales all of
  it. Sizes are typed one number per field (`SIZE_FIELDS`): a phone's number pad has no "/". A hand sketch, tablet drawing or PDF is read by Gemini into the design format
  (`src/core/designPrompt.ts`, `POST /jobs/:id/model/sketch`, streamed) and opens as an unsaved draft; the same
  instructions can go to Yaal's own AI app. The builder's "גיליון" view shows the shop drawing while planning;
  in its 3D view a picked piece can be edited or deleted (`elementOf` maps a layout piece back to the design).
- The shop drawing (`src/core/drawing.ts`, an A3 sheet) is shared as a PDF on A4 or A3 or as a PNG: the browser draws
  the SVG into a canvas (so Hebrew text is right) and `src/core/pdf.ts` wraps the deflated gray pixels in a one-page PDF.
- Axes: mm, Y up, ground y = 0, X along the opening, +Z towards the street. Members are cut lengths (butt joints).
- "ההדמיה מוכנה" approves the newest version (`jobs.model_approved_id`, `POST /jobs/:id/model/approve`) and replaces
  the BOQ group "לפי ההדמיה" with its materials; labor, paint and installation are added by hand. A newer version
  means "changed since approval": the model, BOQ, drawing and cutting steps show it and offer re-approval.
- Gemini builds run in the background: each is a `model_runs` row; the request keeps going with `waitUntil` if the phone
  drops it, and `src/lib/modelRuns.ts` keeps the run (and the typed request) while Yaal moves around the app, polling
  when needed. `server/gemini.ts` streams Gemini's reply, retries 503 "overloaded" answers and falls back to lighter
  models. Cloudflare cuts any request silent for 100 seconds (524), so the build endpoint answers with server-sent
  events: pings every 15 seconds, the result last. Builds use `geminiHedged`: if the best model hasn't started writing
  after 12 seconds, the next one is asked too and the first to finish wins. The model step also offers Yaal's own
  Gemini/Claude/ChatGPT app: copy the instructions and open it in one tap, paste the answer back from the clipboard.

## Tests
- Unit tests next to the code (`*.test.ts`); `src/core/pipeline.test.ts` runs sketch/pen → design → layout → cut list →
  price lines → drawing → PDF end to end.
- Route integration tests (`server/routes/*.test.ts`) use `server/testing/harness.ts`: a D1 stand-in on `node:sqlite` with
  the real migrations, the route module's handlers run with the parts of Hono's context they use, and Google's API faked
  (`fakeGemini`). The harness is excluded from the typecheck.

## Commands
`npm test` · `npm run test:coverage` · `npm run typecheck` · `npm run build` · `npm run dev` + `npm run dev:api` ·
`npm run db:migrate:local|remote`
