/** Shared queries and helpers for route modules. */
import type { ItemInput } from './items.ts';
import { effectiveQuoteStatus } from '../src/core/quote.ts';

/** Job lines with their price-list element and supplier joined in. */
export const ITEM_SELECT = `SELECT ji.*, e.name AS element_name, e.category, e.weight_kg_per_unit, e.stock_length_mm,
       e.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone
  FROM job_items ji
  LEFT JOIN elements e ON e.id = ji.element_id
  LEFT JOIN suppliers s ON s.id = e.supplier_id`;

/** A job with its client and what its steps need to know (src/core/phases.ts). */
export const JOB_SELECT = `SELECT j.*, cl.name AS client_name, cl.phone AS client_phone,
    (SELECT COUNT(*) FROM job_items ji WHERE ji.job_id = j.id) AS item_count,
    (SELECT COUNT(*) FROM job_models m WHERE m.job_id = j.id) AS model_versions,
    (SELECT MAX(m.id) FROM job_models m WHERE m.job_id = j.id) AS model_latest_id,
    (SELECT COUNT(*) FROM photos ph WHERE ph.job_id = j.id) AS photo_count,
    (SELECT COUNT(*) FROM expenses x WHERE x.job_id = j.id) AS expense_count,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.job_id = j.id) AS paid_total,
    q.status AS quote_status, q.created_at AS quote_created_at, q.total AS quote_total, q.valid_until AS quote_valid_until
  FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id
  LEFT JOIN quotes q ON q.id = (SELECT q2.id FROM quotes q2 WHERE q2.job_id = j.id ORDER BY q2.version DESC LIMIT 1)`;

/** The quote status as the client sees it (a sent quote past its date is expired). */
export function withQuoteStatus<T extends { quote_status?: unknown; quote_valid_until?: unknown }>(row: T): T {
  if (row.quote_status === 'sent' && typeof row.quote_valid_until === 'string') {
    return { ...row, quote_status: effectiveQuoteStatus('sent', row.quote_valid_until, new Date().toISOString().slice(0, 10)) };
  }
  return row;
}

export async function touchJob(db: D1Database, jobId: number): Promise<void> {
  await db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").bind(jobId).run();
}

export async function jobItems(db: D1Database, jobId: number) {
  const { results } = await db.prepare(`${ITEM_SELECT} WHERE ji.job_id = ? ORDER BY ji.sort_order, ji.id`).bind(jobId).all();
  return results;
}

/** Appends lines after the job's existing ones, in one batch. */
export async function insertItems(
  db: D1Database,
  jobId: number,
  items: ItemInput[],
  source: 'manual' | 'template' | 'ai',
): Promise<void> {
  if (items.length === 0) return;
  const top = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS top FROM job_items WHERE job_id = ?')
    .bind(jobId)
    .first<{ top: number }>();
  const base = top?.top ?? 0;
  const stmt = db.prepare(
    `INSERT INTO job_items (job_id, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(
    items.map((it, i) =>
      stmt.bind(jobId, it.element_id, it.group_name, it.description, it.quantity, it.unit, it.unit_cost, it.length_mm, it.pieces, source, base + (i + 1) * 10),
    ),
  );
  await touchJob(db, jobId);
}

export function randomToken(bytes = 18): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function money(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null;
}

export function optionalText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
