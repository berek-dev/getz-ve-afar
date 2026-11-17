/** Price list (elements) and suppliers. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { validateElement, validateSupplier } from '../elements.ts';

const ELEMENT_SELECT = `SELECT e.*, s.name AS supplier_name
  FROM elements e LEFT JOIN suppliers s ON s.id = e.supplier_id`;

export function registerCatalog(app: App): void {
  app.get('/elements', async (c) => {
    const { results } = await c.env.DB.prepare(`${ELEMENT_SELECT} WHERE e.active = 1 ORDER BY e.category, e.name`).all();
    return c.json(results);
  });

  /** Body may carry `supplier_name` (+ `supplier_phone`) to create a new supplier on the fly. */
  async function resolveSupplier(db: D1Database, body: Record<string, unknown>): Promise<number | null | 'invalid'> {
    const name = typeof body.supplier_name === 'string' ? body.supplier_name.trim() : '';
    if (!name) return null;
    const v = validateSupplier({ name, phone: body.supplier_phone });
    if (!v.ok) return 'invalid';
    const row = await db
      .prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?) RETURNING id')
      .bind(v.value.name, v.value.phone)
      .first<{ id: number }>();
    return row?.id ?? null;
  }

  app.post('/elements', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const newSupplier = await resolveSupplier(c.env.DB, body);
    if (newSupplier === 'invalid') return c.json({ error: 'invalid supplier' }, 400);
    const v = validateElement(newSupplier ? { ...body, supplier_id: newSupplier } : body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const e = v.value;
    const created = await c.env.DB.prepare(
      `INSERT INTO elements (category, name, unit, unit_cost, weight_kg_per_unit, stock_length_mm, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(e.category, e.name, e.unit, e.unit_cost, e.weight_kg_per_unit, e.stock_length_mm, e.supplier_id)
      .first<{ id: number }>();
    const row = await c.env.DB.prepare(`${ELEMENT_SELECT} WHERE e.id = ?`).bind(created?.id).first();
    return c.json(row, 201);
  });

  app.patch('/elements/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const newSupplier = await resolveSupplier(c.env.DB, body);
    if (newSupplier === 'invalid') return c.json({ error: 'invalid supplier' }, 400);
    const v = validateElement(newSupplier ? { ...body, supplier_id: newSupplier } : body);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const e = v.value;
    const updated = await c.env.DB.prepare(
      `UPDATE elements SET category = ?, name = ?, unit = ?, unit_cost = ?, weight_kg_per_unit = ?,
              stock_length_mm = ?, supplier_id = ?
        WHERE id = ? AND active = 1 RETURNING id`,
    )
      .bind(e.category, e.name, e.unit, e.unit_cost, e.weight_kg_per_unit, e.stock_length_mm, e.supplier_id, id)
      .first();
    if (!updated) return c.json({ error: 'not found' }, 404);
    const row = await c.env.DB.prepare(`${ELEMENT_SELECT} WHERE e.id = ?`).bind(id).first();
    return c.json(row);
  });

  // Soft delete: job lines keep pointing at it, but it leaves the price list.
  app.delete('/elements/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const row = await c.env.DB.prepare('UPDATE elements SET active = 0 WHERE id = ? RETURNING id').bind(id).first();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  app.get('/suppliers', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM suppliers ORDER BY name').all();
    return c.json(results);
  });

  app.post('/suppliers', async (c) => {
    const v = validateSupplier(await c.req.json<Record<string, unknown>>());
    if (!v.ok) return c.json({ error: v.error }, 400);
    const row = await c.env.DB.prepare('INSERT INTO suppliers (name, phone, notes) VALUES (?, ?, ?) RETURNING *')
      .bind(v.value.name, v.value.phone, v.value.notes)
      .first();
    return c.json(row, 201);
  });

  app.patch('/suppliers/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const v = validateSupplier(await c.req.json<Record<string, unknown>>());
    if (!v.ok) return c.json({ error: v.error }, 400);
    const row = await c.env.DB.prepare('UPDATE suppliers SET name = ?, phone = ?, notes = ? WHERE id = ? RETURNING *')
      .bind(v.value.name, v.value.phone, v.value.notes, id)
      .first();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });
}
