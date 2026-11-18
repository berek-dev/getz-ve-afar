/**
 * The job's 3D model: layout versions with undo, generation and changes through Gemini, and BOQ lines
 * from the model. The layout is validated with the same core code the viewer draws with.
 */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { buildLayoutPrompt, designRequests, parseLayoutReply } from '../../src/core/layoutPrompt.ts';
import type { PromptBoqLine } from '../../src/core/layoutPrompt.ts';
import { MODEL_GROUP, linesFromModel } from '../../src/core/modelBoq.ts';
import type { PriceListItem } from '../../src/core/modelBoq.ts';
import { cutList, prepareScene } from '../../src/core/scene.ts';
import { aiErrorCode, geminiText } from '../gemini.ts';
import type { GeminiTurn } from '../gemini.ts';
import { validateItem } from '../items.ts';
import type { ItemInput } from '../items.ts';
import { insertItems, touchJob } from '../sql.ts';

const MAX_VERSIONS = 30;
const MAX_LAYOUT_CHARS = 250_000;
const MAX_IMAGE_CHARS = 7_000_000; // base64, about 5 MB
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface VersionRow {
  id: number;
  request: string | null;
  mode: 'new' | 'edit';
  source: 'ai' | 'paste' | 'demo';
  created_at: string;
}

async function modelState(db: D1Database, jobId: number) {
  const [{ results: history }, latest] = await db.batch([
    db.prepare('SELECT id, request, mode, source, created_at FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT ?').bind(jobId, MAX_VERSIONS),
    db.prepare('SELECT layout_json FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT 1').bind(jobId),
  ]);
  const row = latest.results[0] as { layout_json: string } | undefined;
  return { layout: row ? (JSON.parse(row.layout_json) as unknown) : null, history: history as unknown as VersionRow[] };
}

async function saveVersion(
  db: D1Database,
  jobId: number,
  layout: unknown,
  v: { request: string | null; mode: 'new' | 'edit'; source: VersionRow['source'] },
): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT INTO job_models (job_id, layout_json, request, mode, source) VALUES (?, ?, ?, ?, ?)')
      .bind(jobId, JSON.stringify(layout), v.request, v.mode, v.source),
    db
      .prepare('DELETE FROM job_models WHERE job_id = ? AND id NOT IN (SELECT id FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT ?)')
      .bind(jobId, jobId, MAX_VERSIONS),
  ]);
  await touchJob(db, jobId);
}

function checkLayout(layout: unknown): { ok: true; warnings: string[] } | { ok: false; errors: string[] } {
  if (JSON.stringify(layout ?? null).length > MAX_LAYOUT_CHARS) return { ok: false, errors: ['layout too large'] };
  const p = prepareScene(layout);
  return p.errors.length ? { ok: false, errors: p.errors.slice(0, 8) } : { ok: true, warnings: p.warnings.slice(0, 8) };
}

async function jobExists(db: D1Database, jobId: number) {
  return db.prepare('SELECT id, title, kind, description FROM jobs WHERE id = ?').bind(jobId).first<{
    id: number;
    title: string;
    kind: string;
    description: string | null;
  }>();
}

export function registerModel(app: App): void {
  app.get('/jobs/:id/model', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    return c.json(await modelState(c.env.DB, jobId));
  });

  /** A layout pasted by hand (or the demo). Body: { layout, request?, mode?, source? } */
  app.post('/jobs/:id/model', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    if (!(await jobExists(c.env.DB, jobId))) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<{ layout?: unknown; request?: unknown; source?: unknown; mode?: unknown }>();
    const check = checkLayout(body.layout);
    if (!check.ok) return c.json({ error: 'invalid_layout', details: check.errors }, 400);
    const request = typeof body.request === 'string' && body.request.trim() ? body.request.trim().slice(0, 500) : null;
    await saveVersion(c.env.DB, jobId, body.layout, {
      request,
      mode: body.mode === 'edit' ? 'edit' : 'new',
      source: body.source === 'demo' ? 'demo' : 'paste',
    });
    return c.json({ ...(await modelState(c.env.DB, jobId)), warnings: check.warnings }, 201);
  });

  app.post('/jobs/:id/model/undo', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    await c.env.DB.prepare('DELETE FROM job_models WHERE id = (SELECT MAX(id) FROM job_models WHERE job_id = ?)').bind(jobId).run();
    await touchJob(c.env.DB, jobId);
    return c.json(await modelState(c.env.DB, jobId));
  });

  /**
   * Describe a new design or ask for a change. Body: { request, mode: 'new' | 'edit', image?: { mime, data } }.
   * Sends the job title/notes, the bill of quantities and the current layout – never client details.
   */
  app.post('/jobs/:id/model/ai', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    if (!c.env.GEMINI_API_KEY) return c.json({ error: 'ai_not_configured' }, 503);
    const body = await c.req.json<{ request?: unknown; mode?: unknown; image?: { mime?: unknown; data?: unknown } | null }>();
    const request = typeof body.request === 'string' ? body.request.trim().slice(0, 2000) : '';
    if (request.length < 3) return c.json({ error: 'text_too_short' }, 400);
    const image =
      body.image && typeof body.image.data === 'string' && typeof body.image.mime === 'string' && IMAGE_TYPES.includes(body.image.mime)
        ? { mimeType: body.image.mime, data: body.image.data }
        : null;
    if (image && image.data.length > MAX_IMAGE_CHARS) return c.json({ error: 'image_too_large' }, 400);

    const db = c.env.DB;
    const job = await jobExists(db, jobId);
    if (!job) return c.json({ error: 'not found' }, 404);
    const [state, { results: items }] = await Promise.all([
      modelState(db, jobId),
      db
        .prepare(
          `SELECT ji.description, e.name AS element_name, ji.quantity, ji.unit, ji.pieces, ji.length_mm
             FROM job_items ji LEFT JOIN elements e ON e.id = ji.element_id
            WHERE ji.job_id = ? AND ji.unit <> 'hour' AND COALESCE(ji.group_name, '') <> ?
            ORDER BY ji.sort_order, ji.id LIMIT 80`,
        )
        .bind(jobId, MODEL_GROUP)
        .all<PromptBoqLine>(),
    ]);
    const mode = body.mode === 'new' || !state.layout ? 'new' : 'edit';
    const prompt = buildLayoutPrompt({
      job: { title: job.title, kind: job.kind, description: job.description },
      boq: items,
      current: mode === 'edit' ? state.layout : undefined,
      requests: mode === 'edit' ? designRequests(state.history) : [],
      request,
      hasImage: Boolean(image),
    });

    const contents: GeminiTurn[] = [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }];
    try {
      let layout: unknown = null;
      let errors: string[] = [];
      // One repair round: the core's errors go back to the model
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await geminiText(c.env, { contents, json: true });
        try {
          layout = parseLayoutReply(reply);
          const check = checkLayout(layout);
          errors = check.ok ? [] : check.errors;
        } catch {
          errors = ['the reply was not valid JSON'];
        }
        if (errors.length === 0) break;
        contents.push(
          { role: 'model', parts: [{ text: reply.slice(0, 60_000) }] },
          { role: 'user', parts: [{ text: `That layout has errors: ${errors.join('; ')}. Reply with the corrected complete layout as ONE JSON object, nothing else.` }] },
        );
      }
      if (errors.length) return c.json({ error: 'ai_bad_layout', details: errors }, 502);
      await saveVersion(db, jobId, layout, { request, mode, source: 'ai' });
      const check = checkLayout(layout);
      return c.json({ ...(await modelState(db, jobId)), warnings: check.ok ? check.warnings : [] });
    } catch (e) {
      return c.json({ error: aiErrorCode(e) }, 502);
    }
  });

  /** Replaces the job's "לפי ההדמיה" lines with lines computed from the current model. */
  app.post('/jobs/:id/model/boq', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const db = c.env.DB;
    const { layout } = await modelState(db, jobId);
    if (!layout) return c.json({ error: 'no_model' }, 400);
    const prepared = prepareScene(layout);
    if (prepared.errors.length) return c.json({ error: 'invalid_layout', details: prepared.errors }, 400);
    const { results: priceList } = await db
      .prepare('SELECT id, name, unit, unit_cost, catalog_key FROM elements WHERE active = 1')
      .all<PriceListItem>();
    const items: ItemInput[] = [];
    for (const line of linesFromModel(prepared.scene, cutList(prepared.scene), priceList)) {
      const v = validateItem({ ...line, description: line.description.slice(0, 200) });
      if (v.ok) items.push(v.item);
    }
    await db.prepare('DELETE FROM job_items WHERE job_id = ? AND group_name = ?').bind(jobId, MODEL_GROUP).run();
    await insertItems(db, jobId, items, 'ai');
    return c.json({ lines: items.length, unpriced: items.filter((i) => i.unit_cost === 0).length });
  });
}
