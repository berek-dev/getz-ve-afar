# Getz ve-Afar (גץ ועפר)

Internal work tool for Yaal Hagai's metalwork and welding business: jobs, bill of quantities with cut list,
quotes the client approves from a WhatsApp link, material orders per supplier, calendar, photos, payments,
expenses and a monthly export for the accountant. It is a web app (PWA) that Yaal installs on his iPhone home screen.
The app's screens are in Hebrew; the code and docs are in English.

Everything runs on free tiers and **no credit card is needed at any step**: Cloudflare Pages, Workers, D1
and Workers KV for photos (set up automatically by the deploy). R2 and Zero Trust/Access are avoided on purpose because they can ask
for a payment method.

## Stack

| Layer | Tool |
| --- | --- |
| UI | Vite + React + TypeScript + Tailwind (Hebrew, right-to-left, phone-first) |
| Hosting | Cloudflare Pages – redeploys automatically on every push to `main` |
| API | Pages Functions + Hono (`functions/api/[[route]].ts` → `server/app.ts`) |
| Database | Cloudflare D1 (SQLite); schema in `migrations/` |
| Login | One app password + signed session cookie for 90 days (`server/auth.ts`), failed attempts throttled per IP |
| Pricing engine | `src/core/` – plain TypeScript with `node:test` tests |

## One-time setup (from a phone, no computer needed)

A GitHub Action does all the Cloudflare work. You only create the account, an access key, and three GitHub secrets.
About 10 minutes in a mobile browser.

### 1. Create a free Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up> and confirm your email. If asked to pick a plan, choose **Free**.
No payment method is needed for anything in this project.

### 2. Create an API token (the "access key" the Action uses)

1. In the Cloudflare dashboard tap the profile icon → **My Profile** → **API Tokens** → **Create Token**.
2. Scroll to **Create Custom Token** → **Get started**.
3. Token name: `getz-ve-afar`.
4. Permissions – add three rows:
   - **Account** · **D1** · **Edit**
   - **Account** · **Cloudflare Pages** · **Edit**
   - **Account** · **Workers KV Storage** · **Edit** (photos; without it the app works, just without photos)
5. Account Resources: **Include** · your account.
6. **Continue to summary** → **Create Token**, then **copy the token** (it is shown only once).

### 3. Copy your Account ID

It is the 32-character code in the dashboard address bar right after `dash.cloudflare.com/`,
and is also shown as **Account ID** on the **Workers & Pages** page.

### 4. Add three secrets to the GitHub repo

Open <https://github.com/berek-dev/getz-ve-afar/settings/secrets/actions> → **New repository secret**, three times:

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the id from step 3 |
| `APP_PASSWORD` | the password Yaal will use to log in (at least 12 characters; a short sentence works well) |

GitHub keeps secrets encrypted and hides them in logs. The app itself stores only a hash of the password.

### 5. Run the Setup workflow

Open <https://github.com/berek-dev/getz-ve-afar/actions/workflows/setup.yml> → **Run workflow** → **Run workflow**.
It creates the database and tables, loads the fictional demo jobs, creates the Pages project, sets the password and
deploys. When it turns green the app is live at `https://getz-ve-afar.pages.dev` (the run summary shows the address).

From then on every push to `main` deploys automatically (the **CI** workflow).
To change the password: update the `APP_PASSWORD` secret and run Setup again (this also logs everyone out).

### 6. Install on Yaal's iPhone

Open the site in **Chrome** (or Safari) → tap the **Share** button in the address bar → **Add to Home Screen**
(needs iOS 16.4 or newer). Open the app from the home-screen icon and log in with the password. The login lasts
90 days and renews itself while the app is in use.

### 7. Backups (recommended)

D1 keeps 7 days of point-in-time history on its own. For longer backups, make the repo private
(GitHub → **Settings** → **General** → **Danger Zone** → **Change visibility**). The weekly backup workflow
(`.github/workflows/backup.yml`) only runs in a private repo, because backup files contain client data.
It uses the same two Cloudflare secrets and keeps each Sunday's export for 90 days.

### 8. Optional: AI from a description (Gemini, free)

With a key, the job screen turns a dictated description ("double gate, 4 m opening, 80/80 posts...") into draft
BOQ lines for review, and the 3D tab builds and changes the model from text (and a photo or sketch). Without a key,
the BOQ draft is hidden and the 3D tab works by copy and paste through your own Claude or Gemini chat. To turn it on:

1. Open [aistudio.google.com/apikey](https://aistudio.google.com/apikey) with a Google account → **Create API key**.
   No card is needed on the free tier.
2. GitHub → this repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**,
   name `GEMINI_API_KEY`, paste the key → **Add secret**. (Or set it directly as a Secret in the Cloudflare Pages
   project's **Variables and Secrets**.)
3. The next deploy copies it to Cloudflare and turns the AI on: any push, or **Actions** → **CI** → the last run →
   **Re-run all jobs**.

On the free tier Google may use the text to improve its models, so the app sends only the job title and notes, the
bill of quantities, the price list and the photo you attach – never client names or phone numbers.
`GEMINI_MODEL` (optional variable) overrides the model.

### Manual setup from a computer (alternative)

```bash
npm install && npx wrangler login
npx wrangler d1 create getz-ve-afar           # paste the database_id into wrangler.toml, commit, push
npm run db:migrate:remote && npm run db:seed:remote
node scripts/hash-password.ts "your long password"   # prints APP_PASSWORD_HASH and SESSION_SECRET
npx wrangler pages project create getz-ve-afar --production-branch main
npx wrangler pages secret put APP_PASSWORD_HASH --project-name getz-ve-afar
npx wrangler pages secret put SESSION_SECRET --project-name getz-ve-afar
npm run deploy
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # skips the password login locally
npm run db:migrate:local
npm run db:seed:local            # fictional demo data
npm run build                    # once, so `pages dev` finds dist/
npm run dev:api                  # terminal 1: API + local D1 on port 8788
npm run dev                      # terminal 2: UI with hot reload on port 5173
npm test                         # pricing engine and login tests
```

## Layout

```
src/            UI (React)
src/core/       pricing engine – no dependencies, shared by UI and server
server/         API (Hono) + password login
functions/      Cloudflare Pages Functions entry point
migrations/     D1 schema (new numbered file per change)
seed/           fictional demo data
scripts/        helpers (password hash)
```

## Roadmap

- ✅ Jobs, clients, stages, login, deployment
- ✅ Price list with suppliers, bill of quantities, cut list from stock bars (priced by bars actually bought), weight
- ✅ Built-in catalog (`src/core/catalog.ts`, ~500 items): profiles, bars, tubes, water pipes, beams and plate in black,
  galvanized, stainless and aluminium, priced by one price per kg per material; fittings, hardware, consumables, finishing.
  Add sizes there (keys must stay stable) and tap "add the catalog" in the price list to pick them up
- ✅ Quotes: client page, WhatsApp, approval, print / PDF
- ✅ Material orders per supplier (WhatsApp), job dates, calendar view, Google Calendar / .ics, Waze
- ✅ Photos per job and receipt photos (compressed on the phone, Workers KV)
- ✅ Payments and balances, expenses, monthly CSV for the accountant
- ✅ Templates, draft lines from a description (Gemini, optional)
- ✅ 3D model per job: built and changed by talking to it, undo, check against the BOQ, lines from the model,
  shop drawing to share, and the model in the client's quote
- Next: offline mode, Android tablet + Bluetooth laser, earthworks pricing

## 3D visualization

An AI turns a description (and optionally the bill of quantities, a photo or a sketch) into a **layout**: JSON data,
not code. Everything else is drawn from that data by our own code, so it is consistent and can be corrected:

- `src/core/scene.ts`: the layout format (members on centre lines with catalog sections, arcs, repeats, trims,
  plates, hardware, surroundings, swing/slide groups), validation, cut list with piece marks.
- `src/core/drawing.ts`: A3 shop drawing (front view, dimensions, marks, cut list).
- `src/core/layoutPrompt.ts`: the instructions for the AI and the prompt around them (job, BOQ, current layout,
  earlier changes). `src/core/modelBoq.ts`: model against the BOQ, and BOQ lines from the model.
- `src/viewer3d/viewer.js`: the three.js viewer, shared by the app and the prototype page.
- In the app, the job's **הדמיה** tab (`src/components/ModelSection.tsx`): every change is a saved version
  (`job_models`, last 30), so undo is one tap. `server/routes/model.ts` sends the prompt to Gemini, checks the reply
  with `prepareScene` and gives the errors back to the model once if it is invalid. A quote carries the newest model
  unless the box is cleared, and the client's page shows it (three.js loads only there and in the tab).
- `prototype/3d/`: a standalone page with four gate examples from DIY builds. `npm run build:3d` writes it to
  `public/3d/index.html`; it is served at `/3d/` and also published as a Claude artifact, where its chat asks Claude
  to build and edit the model (the chat only works inside Claude).
