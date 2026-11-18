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

### 8. Optional: draft lines from a description (Gemini, free)

The job screen can turn a dictated description ("double gate, 4 m opening, 80/80 posts...") into draft lines
for review. It stays hidden until a key is set:

1. Open [aistudio.google.com](https://aistudio.google.com) with a Google account → **Get API key** → **Create API key**.
   No card is needed on the free tier.
2. Cloudflare dashboard → **Workers & Pages** → **getz-ve-afar** → **Settings** → **Variables and Secrets** →
   **Add** → type **Secret**, name `GEMINI_API_KEY`, paste the key → **Save**.
3. The next deploy picks it up (any push, or re-run the last CI run).

On the free tier Google may use the text to improve its models, so the app sends only the job text and the
price list – never client names or phone numbers. `GEMINI_MODEL` (optional variable) overrides the model.

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
- Next: offline mode, Android tablet + Bluetooth laser, earthworks pricing, 3D preview
