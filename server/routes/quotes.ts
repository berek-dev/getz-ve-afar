/** Quotes: frozen snapshot + unguessable link for the client, who can approve it. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { buildQuoteSnapshot, effectiveQuoteStatus } from '../../src/core/quote.ts';
import type { QuoteLine, QuoteSnapshot } from '../../src/core/quote.ts';
import type { JobKind, Settings } from '../../src/core/types.ts';

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const today = () => new Date().toISOString().slice(0, 10);

const QUOTE_LIST_FIELDS =
  'id, job_id, version, token, status, subtotal, vat, total, valid_until, approved_at, approved_name, created_at';

export function registerQuotes(app: App): void {
  app.get('/jobs/:id/quotes', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const { results } = await c.env.DB.prepare(
      `SELECT ${QUOTE_LIST_FIELDS} FROM quotes WHERE job_id = ? ORDER BY version DESC`,
    )
      .bind(jobId)
      .all<{ status: string; valid_until: string | null }>();
    return c.json(results.map((q) => ({ ...q, status: effectiveQuoteStatus(q.status, q.valid_until, today()) })));
  });

  app.post('/jobs/:id/quotes', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const db = c.env.DB;
    const job = await db
      .prepare(
        `SELECT j.title, j.kind, j.status, j.site_address, j.description, cl.name AS client_name
           FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id WHERE j.id = ?`,
      )
      .bind(jobId)
      .first<{ title: string; kind: JobKind; status: string; site_address: string | null; description: string | null; client_name: string | null }>();
    if (!job) return c.json({ error: 'not found' }, 404);

    const { results: lines } = await db
      .prepare(
        `SELECT ji.*, e.name AS element_name, e.category, e.weight_kg_per_unit, e.stock_length_mm
           FROM job_items ji LEFT JOIN elements e ON e.id = ji.element_id
          WHERE ji.job_id = ? ORDER BY ji.sort_order, ji.id`,
      )
      .bind(jobId)
      .all<QuoteLine>();
    if (lines.length === 0) return c.json({ error: 'no_items' }, 400);

    const settings = await db.prepare('SELECT * FROM settings WHERE id = 1').first<Settings>();
    if (!settings) return c.json({ error: 'server_error' }, 500);

    const snapshot = buildQuoteSnapshot(job, lines, settings);
    const validDays = Math.max(1, Math.min(365, settings.quote_valid_days ?? 14));
    const token = newToken();

    // Older open versions are replaced by this one
    await db.prepare("UPDATE quotes SET status = 'expired' WHERE job_id = ? AND status = 'sent'").bind(jobId).run();
    const quote = await db
      .prepare(
        `INSERT INTO quotes (job_id, version, token, status, subtotal, vat, total, snapshot_json, valid_until)
         VALUES (?, (SELECT COALESCE(MAX(version), 0) + 1 FROM quotes WHERE job_id = ?), ?, 'sent', ?, ?, ?, ?,
                 date('now', ?))
         RETURNING ${QUOTE_LIST_FIELDS}`,
      )
      .bind(
        jobId,
        jobId,
        token,
        snapshot.totals.beforeVat,
        snapshot.totals.vat,
        snapshot.totals.total,
        JSON.stringify(snapshot),
        `+${validDays} days`,
      )
      .first();

    if (job.status === 'lead' || job.status === 'visit') {
      await db.prepare("UPDATE jobs SET status = 'quoted', updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
    }
    return c.json(quote, 201);
  });

  // --- Public (no login): the client's page
  app.get('/public/quotes/:token', async (c) => {
    const token = c.req.param('token');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return c.json({ error: 'not found' }, 404);
    const q = await c.env.DB.prepare(
      `SELECT job_id, version, status, snapshot_json, valid_until, approved_at, approved_name, created_at
         FROM quotes WHERE token = ?`,
    )
      .bind(token)
      .first<{
        job_id: number;
        version: number;
        status: string;
        snapshot_json: string;
        valid_until: string | null;
        approved_at: string | null;
        approved_name: string | null;
        created_at: string;
      }>();
    if (!q) return c.json({ error: 'not found' }, 404);
    return c.json({
      number: `${q.job_id}-${q.version}`,
      status: effectiveQuoteStatus(q.status, q.valid_until, today()),
      valid_until: q.valid_until,
      approved_at: q.approved_at,
      approved_name: q.approved_name,
      created_at: q.created_at,
      quote: JSON.parse(q.snapshot_json) as QuoteSnapshot,
    });
  });

  app.post('/public/quotes/:token/approve', async (c) => {
    const token = c.req.param('token');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({ name: undefined }));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (name.length < 2) return c.json({ error: 'name_required' }, 400);

    const updated = await c.env.DB.prepare(
      `UPDATE quotes SET status = 'approved', approved_at = datetime('now'), approved_name = ?
        WHERE token = ? AND status = 'sent' AND (valid_until IS NULL OR valid_until >= date('now'))
        RETURNING job_id, approved_at, approved_name`,
    )
      .bind(name, token)
      .first<{ job_id: number; approved_at: string; approved_name: string }>();
    if (!updated) return c.json({ error: 'not_approvable' }, 409);

    await c.env.DB.prepare(
      `UPDATE jobs SET status = 'approved', updated_at = datetime('now')
        WHERE id = ? AND status IN ('lead', 'visit', 'quoted')`,
    )
      .bind(updated.job_id)
      .run();
    return c.json({ ok: true, approved_at: updated.approved_at, approved_name: updated.approved_name });
  });
}
