# Getz ve-Afar (גץ ועפר)

Internal work tool for Yaal Hagai's metalwork and welding business: jobs, clients, bill of quantities,
quotes and payment tracking. It is a web app (PWA) that Yaal installs on his iPhone home screen.
The app's screens are in Hebrew; the code and docs are in English.

Everything runs on free tiers and **no credit card is needed at any step**: Cloudflare Pages, Workers, D1
and (later) Workers KV for photos. R2 and Zero Trust/Access are avoided on purpose because they can ask
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

## One-time setup

You need Node.js 22.18 or newer on your computer.

### 1. Create a free Cloudflare account

Sign up at <https://dash.cloudflare.com/sign-up>. If you are asked to pick a plan, choose **Free**.
You do not need to add a payment method for anything in this project.

### 2. Install and log in

```bash
git clone https://github.com/berek-dev/getz-ve-afar.git
cd getz-ve-afar
npm install
npx wrangler login        # opens the browser – approve access to your Cloudflare account
```

### 3. Create the database

```bash
npx wrangler d1 create getz-ve-afar
```

The output includes a line like `database_id = "1234abcd-..."`. Open `wrangler.toml`, replace
`REPLACE_WITH_D1_DATABASE_ID` with that id, then create the tables and push:

```bash
npm run db:migrate:remote
git commit -am "Set D1 database id"
git push
```

Optional – load the fictional demo jobs (a gate, a pipe repair and a service call):

```bash
npm run db:seed:remote
```

### 4. Connect the repo to Cloudflare Pages

1. In the Cloudflare dashboard open **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize GitHub and pick the `getz-ve-afar` repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Click **Save and Deploy**. The site will be at `https://getz-ve-afar.pages.dev`
   (Cloudflare may add a suffix if the name is taken – use whatever address it shows).

The database connection comes from `wrangler.toml`, so there is nothing else to configure here.

### 5. Set the app password

Pick a long password (at least 12 characters; a short sentence works well) and run:

```bash
node scripts/hash-password.ts "your long password here"
```

It prints two lines:

```
APP_PASSWORD_HASH=pbkdf2-sha256$20000$...
SESSION_SECRET=...
```

Store both as secrets in the Pages project. Either from the command line (paste the value after the `=` when asked):

```bash
npx wrangler pages secret put APP_PASSWORD_HASH --project-name getz-ve-afar
npx wrangler pages secret put SESSION_SECRET --project-name getz-ve-afar
```

or in the dashboard: **Workers & Pages** → `getz-ve-afar` → **Settings** → **Variables and Secrets** → **Add**,
type **Secret**, environment **Production**.

Then redeploy so the secrets take effect: **Deployments** → latest deployment → **Retry deployment**
(or just push any commit).

The password itself is never stored anywhere – only its hash. Forgot the password, or want to log everyone
out? Run the script again with a new password and replace both secrets.

### 6. Install on Yaal's iPhone

Open the site in **Safari** → **Share** → **Add to Home Screen**. Open the app from the home screen and log in
with the password. The login lasts 90 days and renews itself while the app is in use.

### 7. Backups (recommended)

D1 keeps 7 days of point-in-time history on its own. For longer backups:

1. Make the repo private: GitHub → **Settings** → **General** → **Danger Zone** → **Change visibility**.
   (The weekly backup only runs in a private repo, because backup files contain client data.)
2. Create a Cloudflare API token with **D1 Edit** permission (My Profile → API Tokens → Create Token).
3. In GitHub → **Settings** → **Secrets and variables** → **Actions**, add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` (the account id is shown on the right side of the Cloudflare dashboard home page).

The workflow in `.github/workflows/backup.yml` then saves a database export every Sunday (kept 90 days).

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
migrations/     D1 schema
seed/           fictional demo data
scripts/        helpers (password hash)
```

## Roadmap

- **M0 – skeleton** ✅ jobs, clients, pricing settings, login, deployment
- **M1 – pricing engine:** elements, pricing methods (fabrication / pipe welding / service),
  bill of quantities, cut list from 6 m bars (price by bars actually bought)
- **M2 – job builder:** element library, free-form building with groups, photos (compressed on the phone, stored in Workers KV)
- **M3 – quotes:** client page, WhatsApp sharing, approval
- **Demo:** + dictation → draft elements (Gemini), visual cut list, 3D gate
- **M4** purchasing and calendar · **M5** payments and receipts · **M6** templates, offline mode, tablet + laser, earthworks
