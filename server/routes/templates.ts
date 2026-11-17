/** Templates: save a job's lines once, start the next similar job from them. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { insertItems, jobItems, optionalText } from '../sql.ts';
import { validateItem } from '../items.ts';
import type { ItemInput } from '../items.ts';

type Stored = ItemInput;

/** Template lines → job lines at today's price-list prices (falls back to the saved price). */
export async function templateLines(db: D1Database, templateId: number): Promise<ItemInput[] | null> {
  const t = await db.prepare('SELECT items_json FROM templates WHERE id = ?').bind(templateId).first<{ items_json: string }>();
  if (!t) return null;
  let stored: Stored[];
  try {
    stored = JSON.parse(t.items_json) as Stored[];
  } catch {
    return [];
  }
  const { results: elements } = await db
    .prepare('SELECT id, unit_cost FROM elements WHERE active = 1')
    .all<{ id: number; unit_cost: number }>();
  const prices = new Map(elements.map((e) => [e.id, e.unit_cost]));
  const lines: ItemInput[] = [];
  for (const s of stored) {
    const known = s.element_id != null && prices.has(s.element_id);
    const v = validateItem({
      ...s,
      element_id: known ? s.element_id : null,
      unit_cost: known ? prices.get(s.element_id as number) : s.unit_cost,
    } as unknown as Record<string, unknown>);
    if (v.ok) lines.push(v.item);
  }
  return lines;
}

export function registerTemplates(app: App): void {
  app.get('/templates', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, description, json_array_length(items_json) AS item_count, created_at
         FROM templates ORDER BY name`,
    ).all();
    return c.json(results);
  });

  app.post('/templates', async (c) => {
    const body = await c.req.json<{ name?: unknown; description?: unknown; job_id?: unknown }>();
    const name = optionalText(body.name, 120);
    if (!name) return c.json({ error: 'name is required' }, 400);
    const jobId = parseId(String(body.job_id ?? ''));
    if (!jobId) return c.json({ error: 'bad job' }, 400);
    const items = (await jobItems(c.env.DB, jobId)) as unknown as Stored[];
    if (items.length === 0) return c.json({ error: 'no_items' }, 400);
    const stored: Stored[] = items.map((i) => ({
      element_id: i.element_id,
      group_name: i.group_name,
      description: i.description,
      quantity: i.quantity,
      unit: i.unit,
      unit_cost: i.unit_cost,
      length_mm: i.length_mm,
      pieces: i.pieces,
    }));
    const row = await c.env.DB.prepare(
      `INSERT INTO templates (name, description, items_json) VALUES (?, ?, ?)
       RETURNING id, name, description, json_array_length(items_json) AS item_count, created_at`,
    )
      .bind(name, optionalText(body.description, 300), JSON.stringify(stored))
      .first();
    return c.json(row, 201);
  });

  app.delete('/templates/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const row = await c.env.DB.prepare('DELETE FROM templates WHERE id = ? RETURNING id').bind(id).first();
    return row ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404);
  });

  app.post('/jobs/:id/apply-template', async (c) => {
    const jobId = parseId(c.req.param('id'));
    const body = await c.req.json<{ template_id?: unknown }>();
    const templateId = parseId(String(body.template_id ?? ''));
    if (!jobId || !templateId) return c.json({ error: 'bad id' }, 400);
    const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
    const lines = await templateLines(c.env.DB, templateId);
    if (!job || lines === null) return c.json({ error: 'not found' }, 404);
    await insertItems(c.env.DB, jobId, lines, 'template');
    return c.json(await jobItems(c.env.DB, jobId));
  });

  /** Several lines at once (accepted AI drafts). */
  app.post('/jobs/:id/items/bulk', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const body = await c.req.json<{ items?: unknown; source?: unknown }>();
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 60) {
      return c.json({ error: 'invalid items' }, 400);
    }
    const lines: ItemInput[] = [];
    for (const raw of body.items) {
      const v = validateItem((raw ?? {}) as Record<string, unknown>);
      if (!v.ok) return c.json({ error: v.error }, 400);
      lines.push(v.item);
    }
    const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
    if (!job) return c.json({ error: 'not found' }, 404);
    await insertItems(c.env.DB, jobId, lines, body.source === 'ai' ? 'ai' : 'manual');
    return c.json(await jobItems(c.env.DB, jobId));
  });
}
