import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env.ts';
import type { AppEnv } from './types.ts';
import { parseId } from './types.ts';
import { validateItem } from './items.ts';
import { normalizePhone } from './elements.ts';
import { registerCatalog } from './routes/catalog.ts';
import { registerQuotes } from './routes/quotes.ts';
import { registerSchedule } from './routes/schedule.ts';
import { registerMoney } from './routes/money.ts';
import { deleteJobPhotos, registerPhotos } from './routes/photos.ts';
import { registerTemplates, templateLines } from './routes/templates.ts';
import { registerAi } from './routes/ai.ts';
import { ITEM_SELECT, insertItems, touchJob } from './sql.ts';
import {
  SESSION_COOKIE,
  SESSION_RENEW_BELOW_MS,
  SESSION_TTL_MS,
  createSession,
  verifyPassword,
  verifySession,
} from './auth.ts';

export const app = new Hono<AppEnv>().basePath('/api');

const JOB_KINDS = ['fabrication', 'pipe', 'service', 'earthworks'] as const;
const JOB_STATUSES = ['lead', 'visit', 'quoted', 'approved', 'in_progress', 'done', 'paid', 'lost'] as const;

const MAX_FAILED_LOGINS = 10; // per IP
const FAILED_LOGIN_WINDOW = '-15 minutes';

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/api/health' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname.startsWith('/api/public/')
  );
}

function authConfigured(env: Env): env is Env & { APP_PASSWORD_HASH: string; SESSION_SECRET: string } {
  return Boolean(env.APP_PASSWORD_HASH && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32);
}

async function issueSessionCookie(c: Context<AppEnv>, secret: string): Promise<void> {
  const { token } = await createSession(secret, Date.now(), SESSION_TTL_MS);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

// --- Auth: every route except the public ones requires a valid session cookie.
app.use('*', async (c, next) => {
  if (isPublicPath(new URL(c.req.url).pathname)) return next();
  if (c.env.DEV_BYPASS_AUTH === 'true') return next();
  if (!authConfigured(c.env)) return c.json({ error: 'auth_not_configured' }, 503);

  const now = Date.now();
  const exp = await verifySession(getCookie(c, SESSION_COOKIE), c.env.SESSION_SECRET, now);
  if (exp === null) return c.json({ error: 'unauthorized' }, 401);
  if (exp - now < SESSION_RENEW_BELOW_MS) await issueSessionCookie(c, c.env.SESSION_SECRET);
  return next();
});

app.post('/auth/login', async (c) => {
  if (!authConfigured(c.env)) return c.json({ error: 'auth_not_configured' }, 503);
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const db = c.env.DB;

  await db.prepare("DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-1 day')").run();
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > datetime(\'now\', ?)')
    .bind(ip, FAILED_LOGIN_WINDOW)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_FAILED_LOGINS) return c.json({ error: 'too_many_attempts' }, 429);

  const body = await c.req.json<{ password?: unknown }>().catch(() => ({ password: undefined }));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || !(await verifyPassword(password, c.env.APP_PASSWORD_HASH))) {
    await db.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(ip).run();
    return c.json({ error: 'wrong_password' }, 401);
  }

  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  await issueSessionCookie(c, c.env.SESSION_SECRET);
  return c.json({ ok: true });
});

app.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
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

app.get('/me', (c) =>
  c.json({ loggedIn: true, features: { photos: Boolean(c.env.PHOTOS), ai: Boolean(c.env.GEMINI_API_KEY) } }),
);

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
    values.push(body.business_name.trim().slice(0, 80));
  }
  if (body.business_phone !== undefined) {
    const phone = normalizePhone(body.business_phone);
    if (phone === 'invalid') return c.json({ error: 'invalid phone' }, 400);
    sets.push('business_phone = ?');
    values.push(phone ?? '');
  }
  if (typeof body.quote_terms === 'string') {
    sets.push('quote_terms = ?');
    values.push(body.quote_terms.trim().slice(0, 1500));
  }
  if (body.quote_valid_days !== undefined) {
    const days = Number(body.quote_valid_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return c.json({ error: 'invalid quote_valid_days' }, 400);
    sets.push('quote_valid_days = ?');
    values.push(days);
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
    `SELECT j.*, cl.name AS client_name, cl.phone AS client_phone
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
    `SELECT j.*, cl.name AS client_name, cl.phone AS client_phone FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id WHERE j.id = ?`,
  )
    .bind(id)
    .first();
  if (!job) return c.json({ error: 'not found' }, 404);
  const { results: items } = await c.env.DB.prepare(`${ITEM_SELECT} WHERE ji.job_id = ? ORDER BY ji.sort_order, ji.id`)
    .bind(id)
    .all();
  return c.json({ ...job, items });
});

// --- Job lines (bill of quantities)

app.post('/jobs/:id/items', async (c) => {
  const jobId = Number(c.req.param('id'));
  if (!Number.isInteger(jobId)) return c.json({ error: 'bad id' }, 400);
  const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return c.json({ error: 'not found' }, 404);

  const v = validateItem(await c.req.json<Record<string, unknown>>());
  if (!v.ok) return c.json({ error: v.error }, 400);
  const it = v.item;

  const inserted = await c.env.DB.prepare(
    `INSERT INTO job_items (job_id, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual',
             (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM job_items WHERE job_id = ?))
     RETURNING id`,
  )
    .bind(jobId, it.element_id, it.group_name, it.description, it.quantity, it.unit, it.unit_cost, it.length_mm, it.pieces, jobId)
    .first<{ id: number }>();
  await touchJob(c.env.DB, jobId);
  const row = await c.env.DB.prepare(`${ITEM_SELECT} WHERE ji.id = ?`).bind(inserted?.id).first();
  return c.json(row, 201);
});

app.patch('/jobs/:id/items/:itemId', async (c) => {
  const jobId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  if (!Number.isInteger(jobId) || !Number.isInteger(itemId)) return c.json({ error: 'bad id' }, 400);

  const v = validateItem(await c.req.json<Record<string, unknown>>());
  if (!v.ok) return c.json({ error: v.error }, 400);
  const it = v.item;

  const updated = await c.env.DB.prepare(
    `UPDATE job_items
        SET element_id = ?, group_name = ?, description = ?, quantity = ?, unit = ?, unit_cost = ?, length_mm = ?, pieces = ?
      WHERE id = ? AND job_id = ?
      RETURNING id`,
  )
    .bind(it.element_id, it.group_name, it.description, it.quantity, it.unit, it.unit_cost, it.length_mm, it.pieces, itemId, jobId)
    .first();
  if (!updated) return c.json({ error: 'not found' }, 404);
  await touchJob(c.env.DB, jobId);
  const row = await c.env.DB.prepare(`${ITEM_SELECT} WHERE ji.id = ?`).bind(itemId).first();
  return c.json(row);
});

app.delete('/jobs/:id/items/:itemId', async (c) => {
  const jobId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const deleted = await c.env.DB.prepare('DELETE FROM job_items WHERE id = ? AND job_id = ? RETURNING id')
    .bind(itemId, jobId)
    .first();
  if (!deleted) return c.json({ error: 'not found' }, 404);
  await touchJob(c.env.DB, jobId);
  return c.json({ ok: true });
});

app.post('/jobs', async (c) => {
  const body = await c.req.json<{
    title?: string;
    kind?: string;
    client_id?: number | null;
    client_name?: string;
    client_phone?: string;
    site_address?: string;
    description?: string;
    template_id?: number | null;
  }>();
  const title = body.title?.trim();
  const phone = normalizePhone(body.client_phone);
  if (phone === 'invalid') return c.json({ error: 'invalid phone' }, 400);
  if (!title) return c.json({ error: 'title is required' }, 400);
  const kind = body.kind ?? 'fabrication';
  if (!(JOB_KINDS as readonly string[]).includes(kind)) return c.json({ error: 'invalid kind' }, 400);

  let clientId: number | null = body.client_id ?? null;
  const clientName = body.client_name?.trim();
  if (!clientId && clientName) {
    const client = await c.env.DB.prepare('INSERT INTO clients (name, phone) VALUES (?, ?) RETURNING id')
      .bind(clientName, phone)
      .first<{ id: number }>();
    clientId = client?.id ?? null;
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO jobs (title, kind, client_id, site_address, description)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(title, kind, clientId, body.site_address?.trim() || null, body.description?.trim() || null)
    .first<{ id: number }>();
  if (row && body.template_id) {
    const lines = await templateLines(c.env.DB, Number(body.template_id));
    if (lines) await insertItems(c.env.DB, row.id, lines, 'template');
  }
  return c.json(row, 201);
});

app.patch('/jobs/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'bad id' }, 400);
  const body = await c.req.json<{
    title?: string;
    kind?: string;
    client_name?: string;
    client_phone?: string;
    site_address?: string;
    description?: string;
  }>();
  const title = body.title?.trim();
  if (!title) return c.json({ error: 'title is required' }, 400);
  const kind = body.kind ?? 'fabrication';
  if (!(JOB_KINDS as readonly string[]).includes(kind)) return c.json({ error: 'invalid kind' }, 400);
  const phone = normalizePhone(body.client_phone);
  if (phone === 'invalid') return c.json({ error: 'invalid phone' }, 400);

  const job = await c.env.DB.prepare('SELECT client_id FROM jobs WHERE id = ?').bind(id).first<{ client_id: number | null }>();
  if (!job) return c.json({ error: 'not found' }, 404);

  let clientId = job.client_id;
  const clientName = body.client_name?.trim();
  if (clientName && clientId) {
    await c.env.DB.prepare('UPDATE clients SET name = ?, phone = ? WHERE id = ?').bind(clientName, phone, clientId).run();
  } else if (clientName) {
    const client = await c.env.DB.prepare('INSERT INTO clients (name, phone) VALUES (?, ?) RETURNING id')
      .bind(clientName, phone)
      .first<{ id: number }>();
    clientId = client?.id ?? null;
  } else {
    clientId = null;
  }

  await c.env.DB.prepare(
    `UPDATE jobs SET title = ?, kind = ?, client_id = ?, site_address = ?, description = ?, updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(title, kind, clientId, body.site_address?.trim() || null, body.description?.trim() || null, id)
    .run();
  const row = await c.env.DB.prepare(
    `SELECT j.*, cl.name AS client_name, cl.phone AS client_phone FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id WHERE j.id = ?`,
  )
    .bind(id)
    .first();
  return c.json(row);
});

app.delete('/jobs/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'bad id' }, 400);
  await deleteJobPhotos(c.env.DB, c.env.PHOTOS, id);
  const row = await c.env.DB.prepare('DELETE FROM jobs WHERE id = ? RETURNING id').bind(id).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
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



registerCatalog(app);
registerQuotes(app);
registerSchedule(app);
registerMoney(app);
registerPhotos(app);
registerTemplates(app);
registerAi(app);
