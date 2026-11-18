/** Price list (elements) and suppliers. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { validateElement, validateSupplier } from '../elements.ts';
import type { ElementInput } from '../elements.ts';
import { catalogItems } from '../../src/core/catalog.ts';

/** Price by weight overrides the typed price: weight × the material's price per kg. */
async function effectiveCost(db: D1Database, e: ElementInput): Promise<number> {
  if (!e.price_by_kg || !e.material || !e.weight_kg_per_unit) return e.unit_cost;
  const m = await db.prepare('SELECT price_per_kg FROM materials WHERE key = ?').bind(e.material).first<{ price_per_kg: number }>();
  return Math.round(e.weight_kg_per_unit * (m?.price_per_kg ?? 0) * 100) / 100;
}

/** The catalog as rows for json_each() – one bound parameter instead of hundreds of statements. */
const CATALOG_ROWS = `SELECT json_extract(value, '$.key') AS key, json_extract(value, '$.category') AS category,
         json_extract(value, '$.family') AS family, json_extract(value, '$.name') AS name,
         json_extract(value, '$.size') AS size, json_extract(value, '$.unit') AS unit,
         json_extract(value, '$.material') AS material, json_extract(value, '$.weight') AS weight,
         json_extract(value, '$.stock') AS stock, json_extract(value, '$.by_kg') AS by_kg
    FROM json_each(?1)`;

const ELEMENT_SELECT = `SELECT e.*, s.name AS supplier_name
  FROM elements e LEFT JOIN suppliers s ON s.id = e.supplier_id`;

export function registerCatalog(app: App): void {
  app.get('/elements', async (c) => {
    const { results } = await c.env.DB.prepare(`${ELEMENT_SELECT} WHERE e.active = 1 ORDER BY e.category, e.family, e.name`).all();
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
    const cost = await effectiveCost(c.env.DB, e);
    const created = await c.env.DB.prepare(
      `INSERT INTO elements (category, name, unit, unit_cost, weight_kg_per_unit, stock_length_mm, supplier_id,
                             family, material, size, price_by_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(e.category, e.name, e.unit, cost, e.weight_kg_per_unit, e.stock_length_mm, e.supplier_id, e.family, e.material, e.size, e.price_by_kg ? 1 : 0)
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
    const cost = await effectiveCost(c.env.DB, e);
    const updated = await c.env.DB.prepare(
      `UPDATE elements SET category = ?, name = ?, unit = ?, unit_cost = ?, weight_kg_per_unit = ?,
              stock_length_mm = ?, supplier_id = ?, family = ?, material = ?, size = ?, price_by_kg = ?
        WHERE id = ? AND active = 1 RETURNING id`,
    )
      .bind(e.category, e.name, e.unit, cost, e.weight_kg_per_unit, e.stock_length_mm, e.supplier_id, e.family, e.material, e.size, e.price_by_kg ? 1 : 0, id)
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

  // --- Materials: one price per kg drives every size priced by weight
  app.get('/materials', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM materials ORDER BY sort_order').all();
    return c.json(results);
  });

  app.put('/materials/:key', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<{ price_per_kg?: unknown }>();
    const price = Number(body.price_per_kg);
    if (!Number.isFinite(price) || price < 0 || price > 10_000) return c.json({ error: 'invalid price' }, 400);
    const db = c.env.DB;
    const row = await db.prepare('UPDATE materials SET price_per_kg = ? WHERE key = ? RETURNING *').bind(price, key).first();
    if (!row) return c.json({ error: 'not found' }, 404);
    const res = await db
      .prepare(
        `UPDATE elements SET unit_cost = ROUND(weight_kg_per_unit * ?, 2)
          WHERE material = ? AND price_by_kg = 1 AND weight_kg_per_unit IS NOT NULL`,
      )
      .bind(price, key)
      .run();
    return c.json({ material: row, repriced: res.meta.changes ?? 0 });
  });

  // --- Built-in catalog: how many standard items are not in the price list yet, and adding them
  app.get('/catalog/status', async (c) => {
    const keys = JSON.stringify(catalogItems().map((i) => i.key));
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS missing FROM json_each(?1)
        WHERE value NOT IN (SELECT catalog_key FROM elements WHERE catalog_key IS NOT NULL)`,
    )
      .bind(keys)
      .first<{ missing: number }>();
    return c.json({ total: catalogItems().length, missing: row?.missing ?? 0 });
  });

  app.post('/catalog/import', async (c) => {
    const json = JSON.stringify(catalogItems());
    const db = c.env.DB;
    const [linked, added] = await db.batch([
      // Items already in the price list under the same name join the catalog (keeping supplier and price
      // unless they are now priced by weight). Older names written 60×40×2 match 60/40/2 and are renamed.
      db
        .prepare(
          `UPDATE elements AS e
              SET name = c.name, family = c.family, material = c.material, size = c.size, catalog_key = c.key, price_by_kg = c.by_kg,
                  weight_kg_per_unit = COALESCE(e.weight_kg_per_unit, c.weight),
                  stock_length_mm = COALESCE(e.stock_length_mm, c.stock),
                  unit_cost = CASE WHEN c.by_kg = 1 AND m.price_per_kg > 0
                                   THEN ROUND(COALESCE(e.weight_kg_per_unit, c.weight) * m.price_per_kg, 2)
                                   ELSE e.unit_cost END
             FROM (${CATALOG_ROWS}) AS c LEFT JOIN materials m ON m.key = c.material
            WHERE e.catalog_key IS NULL AND e.active = 1 AND REPLACE(e.name, '×', '/') = c.name AND e.unit = c.unit
              AND e.id = (SELECT MIN(y.id) FROM elements y
                           WHERE REPLACE(y.name, '×', '/') = c.name AND y.active = 1 AND y.catalog_key IS NULL)
              AND NOT EXISTS (SELECT 1 FROM elements x WHERE x.catalog_key = c.key)`,
        )
        .bind(json),
      db
        .prepare(
          `INSERT INTO elements (category, name, unit, unit_cost, weight_kg_per_unit, stock_length_mm,
                                 family, material, size, catalog_key, price_by_kg)
           SELECT c.category, c.name, c.unit,
                  CASE WHEN c.by_kg = 1 THEN ROUND(c.weight * COALESCE(m.price_per_kg, 0), 2) ELSE 0 END,
                  c.weight, c.stock, c.family, c.material, c.size, c.key, c.by_kg
             FROM (${CATALOG_ROWS}) AS c LEFT JOIN materials m ON m.key = c.material
            WHERE NOT EXISTS (SELECT 1 FROM elements x WHERE x.catalog_key = c.key)
              AND NOT EXISTS (SELECT 1 FROM elements x WHERE REPLACE(x.name, '×', '/') = c.name AND x.active = 1)`,
        )
        .bind(json),
    ]);
    return c.json({ linked: linked.meta.changes ?? 0, added: added.meta.changes ?? 0 });
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
