import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './env.ts';
import { verifyAccessJwt } from './access.ts';

type AppEnv = { Bindings: Env; Variables: { userEmail: string } };

export const app = new Hono<AppEnv>().basePath('/api');

const JOB_KINDS = ['fabrication', 'pipe', 'service', 'earthworks'] as const;
const JOB_STATUSES = ['lead', 'visit', 'quoted', 'approved', 'in_progress', 'done', 'paid', 'lost'] as const;

function isPublicPath(pathname: string): boolean {
  return pathname === '/api/health' || pathname.startsWith('/api/public/');
}

// --- Auth: every route except /api/health and /api/public/* requires a valid Cloudflare Access token.
app.use('*', async (c, next) => {
  if (isPublicPath(new URL(c.req.url).pathname)) return next();

  if (c.env.DEV_BYPASS_AUTH === 'true') {
    c.set('userEmail', 'dev@local');
    return next();
  }
  if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) {
    return c.json({ error: 'auth_not_configured' }, 503);
  }
  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
  const result = await verifyAccessJwt(token, { teamDomain: c.env.ACCESS_TEAM_DOMAIN, aud: c.env.ACCESS_AUD });
  if (!result.ok) return c.json({ error: 'unauthorized' }, 401);
  c.set('userEmail', result.email);
  return next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error' }, 500);
});

// --- Health
app.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: true });
  } catch {
    return c.json({ ok: false, db: false }, 500);
  }
});

app.get('/me', (c) => c.json({ email: c.get('userEmail') }));

// --- Settings (single row)
app.get('/settings', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM settings WHERE id = 1').first();
  return c.json(row);
});

const SETTINGS_NUMBERS = ['hourly_rate', 'overhead_pct', 'margin_pct', 'vat_pct', 'bar_length_mm', 'kerf_mm'] as const;

app.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const key of SETTINGS_NUMBERS) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) return c.json({ error: `invalid ${key}` }, 400);
    sets.push(`${key} = ?`);
    values.push(n);
  }
  if (typeof body.business_name === 'string' && body.business_name.trim()) {
    sets.push('business_name = ?');
    values.push(body.business_name.trim());
  }
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 1`).bind(...values).run();
  const row = await c.env.DB.prepare('SELECT * FROM settings WHERE id = 1').first();
  return c.json(row);
});

// --- Clients
app.get('/clients', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM clients ORDER BY name').all();
  return c.json(results);
});

app.post('/clients', async (c) => {
  const body = await c.req.json<{ name?: string; phone?: string; address?: string; notes?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);
  const row = await c.env.DB.prepare(
    'INSERT INTO clients (name, phone, address, notes) VALUES (?, ?, ?, ?) RETURNING *',
  )
    .bind(name, body.phone?.trim() || null, body.address?.trim() || null, body.notes?.trim() || null)
    .first();
  return c.json(row, 201);
});

// --- Jobs
app.get('/jobs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT j.*, cl.name AS client_name
       FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id
      ORDER BY j.updated_at DESC
      LIMIT 200`,
  ).all();
  return c.json(results);
});

app.get('/jobs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
  const job = await c.env.DB.prepare(
    `SELECT j.*, cl.name AS client_name FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id WHERE j.id = ?`,
  )
    .bind(id)
    .first();
  if (!job) return c.json({ error: 'not found' }, 404);
  const { results: items } = await c.env.DB.prepare(
    'SELECT * FROM job_items WHERE job_id = ? ORDER BY sort_order, id',
  )
    .bind(id)
    .all();
  return c.json({ ...job, items });
});

app.post('/jobs', async (c) => {
  const body = await c.req.json<{
    title?: string;
    kind?: string;
    client_id?: number | null;
    client_name?: string;
    site_address?: string;
    description?: string;
  }>();
  const title = body.title?.trim();
  if (!title) return c.json({ error: 'title is required' }, 400);
  const kind = body.kind ?? 'fabrication';
  if (!(JOB_KINDS as readonly string[]).includes(kind)) return c.json({ error: 'invalid kind' }, 400);

  let clientId: number | null = body.client_id ?? null;
  const clientName = body.client_name?.trim();
  if (!clientId && clientName) {
    const client = await c.env.DB.prepare('INSERT INTO clients (name) VALUES (?) RETURNING id')
      .bind(clientName)
      .first<{ id: number }>();
    clientId = client?.id ?? null;
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO jobs (title, kind, client_id, site_address, description)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(title, kind, clientId, body.site_address?.trim() || null, body.description?.trim() || null)
    .first();
  return c.json(row, 201);
});

app.patch('/jobs/:id/status', async (c) => {
  const id = Number(c.req.param('id'));
  const { status } = await c.req.json<{ status?: string }>();
  if (!status || !(JOB_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: 'invalid status' }, 400);
  }
  const row = await c.env.DB.prepare(
    "UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *",
  )
    .bind(status, id)
    .first();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

// --- Public: quote page for the client (filled in M3)
app.get('/public/quotes/:token', async (c) => {
  const token = c.req.param('token');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return c.json({ error: 'not found' }, 404);
  const quote = await c.env.DB.prepare(
    `SELECT token, status, subtotal, vat, total, snapshot_json, valid_until, approved_at
       FROM quotes WHERE token = ? AND status != 'draft'`,
  )
    .bind(token)
    .first();
  if (!quote) return c.json({ error: 'not found' }, 404);
  return c.json(quote);
});
