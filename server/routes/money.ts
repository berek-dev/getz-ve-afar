/** Payments per job, expenses (with receipt photos), the monthly summary and CSV export. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, isValidDate, money, optionalText, randomToken } from '../sql.ts';
import { normalizePhone } from '../elements.ts';
import { EXPENSE_CATEGORIES, MONTH_RE, PAYMENT_METHODS, monthCsv, monthRange, vatFromGross } from '../../src/core/finance.ts';
import type { Expense, ExpenseCategory, Payment, PaymentMethod } from '../../src/core/finance.ts';

const PAYMENT_SELECT = `SELECT p.*, j.title AS job_title, cl.name AS client_name
  FROM payments p LEFT JOIN jobs j ON j.id = p.job_id LEFT JOIN clients cl ON cl.id = j.client_id`;
const EXPENSE_SELECT = `SELECT x.*, j.title AS job_title, s.name AS supplier_name
  FROM expenses x LEFT JOIN jobs j ON j.id = x.job_id LEFT JOIN suppliers s ON s.id = x.supplier_id`;

const today = () => new Date().toISOString().slice(0, 10);

/** Total of the latest approved quote – what the client agreed to pay. */
async function approvedDue(db: D1Database, jobId: number) {
  return db
    .prepare("SELECT total, version FROM quotes WHERE job_id = ? AND status = 'approved' ORDER BY version DESC LIMIT 1")
    .bind(jobId)
    .first<{ total: number; version: number }>();
}

export function registerMoney(app: App): void {
  // --- Per job
  app.get('/jobs/:id/money', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const db = c.env.DB;
    const [due, payments, expenses] = await Promise.all([
      approvedDue(db, jobId),
      db.prepare(`${PAYMENT_SELECT} WHERE p.job_id = ? ORDER BY p.paid_at DESC, p.id DESC`).bind(jobId).all<Payment>(),
      db.prepare(`${EXPENSE_SELECT} WHERE x.job_id = ? ORDER BY x.spent_at DESC, x.id DESC`).bind(jobId).all<Expense>(),
    ]);
    return c.json({
      due: due?.total ?? null,
      due_version: due?.version ?? null,
      payments: payments.results,
      expenses: expenses.results,
    });
  });

  app.post('/jobs/:id/payments', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const amount = money(body.amount);
    if (amount === null) return c.json({ error: 'invalid amount' }, 400);
    const paidAt = body.paid_at ? body.paid_at : today();
    if (!isValidDate(paidAt)) return c.json({ error: 'invalid date' }, 400);
    const method = PAYMENT_METHODS.includes(body.method as PaymentMethod) ? (body.method as PaymentMethod) : null;
    const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
    if (!job) return c.json({ error: 'not found' }, 404);
    const row = await c.env.DB.prepare(
      'INSERT INTO payments (job_id, amount, method, paid_at, notes) VALUES (?, ?, ?, ?, ?) RETURNING id',
    )
      .bind(jobId, amount, method, paidAt, optionalText(body.notes, 300))
      .first<{ id: number }>();
    return c.json(await c.env.DB.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).bind(row?.id).first(), 201);
  });

  app.delete('/payments/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const row = await c.env.DB.prepare('DELETE FROM payments WHERE id = ? RETURNING id').bind(id).first();
    return row ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });

  // --- Expenses
  app.post('/expenses', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const db = c.env.DB;
    const amount = money(body.amount);
    if (amount === null) return c.json({ error: 'invalid amount' }, 400);
    const spentAt = body.spent_at ? body.spent_at : today();
    if (!isValidDate(spentAt)) return c.json({ error: 'invalid date' }, 400);
    const category = EXPENSE_CATEGORIES.includes(body.category as ExpenseCategory) ? (body.category as ExpenseCategory) : 'other';
    const jobId = body.job_id == null || body.job_id === '' ? null : parseId(String(body.job_id));
    if (body.job_id != null && body.job_id !== '' && !jobId) return c.json({ error: 'bad job' }, 400);

    let supplierId = body.supplier_id == null || body.supplier_id === '' ? null : parseId(String(body.supplier_id));
    const supplierName = optionalText(body.supplier_name, 120);
    if (!supplierId && supplierName) {
      const existing = await db.prepare('SELECT id FROM suppliers WHERE name = ?').bind(supplierName).first<{ id: number }>();
      const phone = normalizePhone(typeof body.supplier_phone === 'string' ? body.supplier_phone : undefined);
      supplierId =
        existing?.id ??
        (
          await db
            .prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?) RETURNING id')
            .bind(supplierName, phone === 'invalid' ? null : phone)
            .first<{ id: number }>()
        )?.id ??
        null;
    }

    const settings = await db.prepare('SELECT vat_pct FROM settings WHERE id = 1').first<{ vat_pct: number }>();
    const vat = body.has_vat === false ? 0 : vatFromGross(amount, settings?.vat_pct ?? 18);
    const row = await db
      .prepare(
        `INSERT INTO expenses (job_id, supplier_id, category, amount, vat, spent_at, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(jobId, supplierId, category, amount, vat, spentAt, optionalText(body.notes, 300))
      .first<{ id: number }>();
    return c.json(await db.prepare(`${EXPENSE_SELECT} WHERE x.id = ?`).bind(row?.id).first(), 201);
  });

  app.delete('/expenses/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const row = await c.env.DB.prepare('DELETE FROM expenses WHERE id = ? RETURNING receipt_key').bind(id).first<{ receipt_key: string | null }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.receipt_key && c.env.PHOTOS) await c.env.PHOTOS.delete(row.receipt_key);
    return c.json({ ok: true });
  });

  app.put('/expenses/:id/receipt', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    if (!c.env.PHOTOS) return c.json({ error: 'photos_not_configured' }, 503);
    const type = c.req.header('content-type')?.split(';')[0] ?? '';
    if (!IMAGE_TYPES.includes(type)) return c.json({ error: 'not_an_image' }, 415);
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'image_too_large' }, 413);
    const old = await c.env.DB.prepare('SELECT receipt_key FROM expenses WHERE id = ?').bind(id).first<{ receipt_key: string | null }>();
    if (!old) return c.json({ error: 'not found' }, 404);
    const key = `receipt/${id}/${randomToken(12)}`;
    await c.env.PHOTOS.put(key, data, { metadata: { type } });
    await c.env.DB.prepare('UPDATE expenses SET receipt_key = ? WHERE id = ?').bind(key, id).run();
    if (old.receipt_key) await c.env.PHOTOS.delete(old.receipt_key);
    return c.json(await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE x.id = ?`).bind(id).first());
  });

  app.get('/expenses/:id/receipt', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id || !c.env.PHOTOS) return c.json({ error: 'not found' }, 404);
    const row = await c.env.DB.prepare('SELECT receipt_key FROM expenses WHERE id = ?').bind(id).first<{ receipt_key: string | null }>();
    if (!row?.receipt_key) return c.json({ error: 'not found' }, 404);
    const obj = await c.env.PHOTOS.getWithMetadata<{ type?: string }>(row.receipt_key, 'arrayBuffer');
    if (!obj.value) return c.json({ error: 'not found' }, 404);
    return c.body(obj.value, 200, {
      'content-type': obj.metadata?.type ?? 'image/jpeg',
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  // --- Month overview
  app.get('/finance', async (c) => {
    const month = c.req.query('month') ?? today().slice(0, 7);
    if (!MONTH_RE.test(month)) return c.json({ error: 'invalid month' }, 400);
    const [from, to] = monthRange(month);
    const db = c.env.DB;
    const [payments, expenses, open] = await Promise.all([
      db.prepare(`${PAYMENT_SELECT} WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC, p.id DESC`).bind(from, to).all<Payment>(),
      db.prepare(`${EXPENSE_SELECT} WHERE x.spent_at >= ? AND x.spent_at < ? ORDER BY x.spent_at DESC, x.id DESC`).bind(from, to).all<Expense>(),
      db
        .prepare(
          `SELECT j.id, j.title, j.status, cl.name AS client_name, cl.phone AS client_phone,
                  (SELECT q.total FROM quotes q WHERE q.job_id = j.id AND q.status = 'approved' ORDER BY q.version DESC LIMIT 1) AS due,
                  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.job_id = j.id), 0) AS paid
             FROM jobs j LEFT JOIN clients cl ON cl.id = j.client_id
            WHERE j.status IN ('approved', 'in_progress', 'done')`,
        )
        .all<{ id: number; due: number | null; paid: number }>(),
    ]);
    const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return c.json({
      month,
      payments: payments.results,
      expenses: expenses.results,
      totals: {
        income: sum(payments.results),
        expenses: sum(expenses.results),
        expensesVat: Math.round(expenses.results.reduce((s, e) => s + (e.vat ?? 0), 0) * 100) / 100,
      },
      open: open.results
        .filter((j) => j.due != null && j.due - j.paid > 0.5)
        .map((j) => ({ ...j, balance: Math.round(((j.due ?? 0) - j.paid) * 100) / 100 }))
        .sort((a, b) => b.balance - a.balance),
    });
  });

  app.get('/export', async (c) => {
    const month = c.req.query('month') ?? '';
    if (!MONTH_RE.test(month)) return c.json({ error: 'invalid month' }, 400);
    const [from, to] = monthRange(month);
    const db = c.env.DB;
    const [payments, expenses] = await Promise.all([
      db.prepare(`${PAYMENT_SELECT} WHERE p.paid_at >= ? AND p.paid_at < ?`).bind(from, to).all<Payment>(),
      db.prepare(`${EXPENSE_SELECT} WHERE x.spent_at >= ? AND x.spent_at < ?`).bind(from, to).all<Expense>(),
    ]);
    return c.body(monthCsv(payments.results, expenses.results), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="getz-ve-afar-${month}.csv"`,
      'cache-control': 'no-store',
    });
  });
}
