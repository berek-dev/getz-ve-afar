/**
 * The job's 3D model: layout versions with undo, generation and changes through Gemini, and BOQ lines
 * from the model. The layout is validated with the same core code the viewer draws with.
 */
import type { App } from '../types.ts';
import type { JobItem } from '../../src/core/types.ts';
import { parseId } from '../types.ts';
import { buildLayoutPrompt, designRequests, parseLayoutReply } from '../../src/core/layoutPrompt.ts';
import type { PromptBoqLine } from '../../src/core/layoutPrompt.ts';
import { MODEL_GROUP, linesFromModel } from '../../src/core/modelBoq.ts';
import type { PriceListItem } from '../../src/core/modelBoq.ts';
import { cutList, prepareScene } from '../../src/core/scene.ts';
import { isCutLine } from '../../src/core/quantities.ts';
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

/** A Gemini run that started, finished or failed in the last few minutes (the app shows it and polls it) */
interface RunRow {
  id: number;
  status: 'running' | 'done' | 'failed' | 'canceled';
  error: string | null;
  request: string;
  mode: 'new' | 'edit';
  model_id: number | null;
  created_at: string;
  finished_at: string | null;
  stale: number;
}

/** A run still 'running' after this long was cut off (the server stops trying well before) */
const RUN_STALE = '-6 minutes';
/** No new Gemini attempt after this; one already running may take up to two more minutes */
const RUN_DEADLINE_MS = 3 * 60_000;

async function modelState(db: D1Database, jobId: number) {
  const [{ results: history }, latest, runs] = await db.batch([
    db.prepare('SELECT id, request, mode, source, created_at FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT ?').bind(jobId, MAX_VERSIONS),
    db.prepare('SELECT layout_json FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT 1').bind(jobId),
    db
      .prepare(
        `SELECT id, status, error, request, mode, model_id, created_at, finished_at, created_at < datetime('now', ?) AS stale
           FROM model_runs WHERE job_id = ? AND created_at > datetime('now', '-15 minutes') ORDER BY id DESC LIMIT 1`,
      )
      .bind(RUN_STALE, jobId),
  ]);
  const row = latest.results[0] as { layout_json: string } | undefined;
  const r = runs.results[0] as RunRow | undefined;
  const run = r
    ? {
        id: r.id,
        status: r.status === 'running' && r.stale ? ('failed' as const) : r.status,
        error: r.status === 'running' && r.stale ? 'run_interrupted' : r.error,
        request: r.request,
        mode: r.mode,
        model_id: r.model_id,
        created_at: r.created_at,
        finished_at: r.finished_at,
      }
    : null;
  return { layout: row ? (JSON.parse(row.layout_json) as unknown) : null, history: history as unknown as VersionRow[], run };
}

async function saveVersion(
  db: D1Database,
  jobId: number,
  layout: unknown,
  v: { request: string | null; mode: 'new' | 'edit'; source: VersionRow['source'] },
): Promise<number> {
  const [inserted] = await db.batch<{ id: number }>([
    db
      .prepare('INSERT INTO job_models (job_id, layout_json, request, mode, source) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(jobId, JSON.stringify(layout), v.request, v.mode, v.source),
    db
      .prepare('DELETE FROM job_models WHERE job_id = ? AND id NOT IN (SELECT id FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT ?)')
      .bind(jobId, jobId, MAX_VERSIONS),
  ]);
  await touchJob(db, jobId);
  return inserted.results[0]?.id ?? 0;
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

    const busy = await db
      .prepare(`SELECT id FROM model_runs WHERE job_id = ? AND status = 'running' AND created_at > datetime('now', ?) LIMIT 1`)
      .bind(jobId, RUN_STALE)
      .first();
    if (busy) return c.json({ error: 'run_in_progress' }, 409);
    const runRow = await db
      .prepare('INSERT INTO model_runs (job_id, request, mode) VALUES (?, ?, ?) RETURNING id')
      .bind(jobId, request, mode)
      .first<{ id: number }>();
    const runId = runRow?.id ?? 0;
    await db
      .prepare('DELETE FROM model_runs WHERE job_id = ? AND id NOT IN (SELECT id FROM model_runs WHERE job_id = ? ORDER BY id DESC LIMIT 20)')
      .bind(jobId, jobId)
      .run();
    const finish = (status: 'done' | 'failed', error: string | null, modelId: number | null) =>
      db
        .prepare(`UPDATE model_runs SET status = ?, error = ?, model_id = ?, finished_at = datetime('now') WHERE id = ? AND status = 'running'`)
        .bind(status, error, modelId, runId)
        .run();

    const contents: GeminiTurn[] = [{ role: 'user', parts: [{ text: prompt }, ...(image ? [{ inlineData: image }] : [])] }];
    const started = Date.now();
    const work = (async (): Promise<{ ok: true; warnings: string[] } | { ok: false; error: string; details?: string[] }> => {
      try {
        let layout: unknown = null;
        let errors: string[] = [];
        // One repair round: the core's errors go back to the model (if there is still time)
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0 && Date.now() - started > RUN_DEADLINE_MS / 2) break;
          // A change needs little thinking (and thinking is the slow part); a new design gets the default
          const reply = await geminiText(c.env, {
            contents,
            json: true,
            thinking: mode === 'edit' ? 'low' : undefined,
            deadlineAt: started + RUN_DEADLINE_MS,
          });
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
        if (errors.length) {
          await finish('failed', 'ai_bad_layout', null);
          return { ok: false, error: 'ai_bad_layout', details: errors };
        }
        // Stopped from the app meanwhile: keep the model as it was
        const now = await db.prepare('SELECT status FROM model_runs WHERE id = ?').bind(runId).first<{ status: string }>();
        if (now?.status === 'canceled') return { ok: false, error: 'canceled' };
        const modelId = await saveVersion(db, jobId, layout, { request, mode, source: 'ai' });
        await finish('done', null, modelId);
        const check = checkLayout(layout);
        return { ok: true, warnings: check.ok ? check.warnings : [] };
      } catch (e) {
        const code = aiErrorCode(e);
        await finish('failed', code, null).catch(() => undefined);
        return { ok: false, error: code };
      }
    })();
    // If the phone drops the connection (app in the background), the server still gets 30 more seconds to save
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      // no execution context (local tests)
    }

    // Answer at once and keep the line busy: Cloudflare cuts a request that sends nothing for 100 seconds, and a
    // build can take longer. Server-sent events: a ping every 15 seconds, then the result (or the error) last.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (data: unknown) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => undefined);
    void send({ run: runId });
    const ping = setInterval(() => void send({ ping: Math.round((Date.now() - started) / 1000) }), 15_000);
    void work.then(async (result) => {
      clearInterval(ping);
      await send(
        result.ok ? { ...(await modelState(db, jobId)), warnings: result.warnings } : { error: result.error, details: result.details ?? [] },
      );
      await writer.close().catch(() => undefined);
    });
    return new Response(readable, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  });

  /** "עצור": the running Gemini call can't be stopped, but its result won't replace the model. */
  app.post('/jobs/:id/model/cancel', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    await c.env.DB.prepare(`UPDATE model_runs SET status = 'canceled', finished_at = datetime('now') WHERE job_id = ? AND status = 'running'`)
      .bind(jobId)
      .run();
    return c.json(await modelState(c.env.DB, jobId));
  });

  /**
   * "ההדמיה מוכנה": approve the newest version and put its materials in the BOQ (the "לפי ההדמיה" group is
   * replaced). Body: { dry_run?: boolean, replace?: boolean }. Hand-written lines the model now covers (profile
   * cuts, or the same price-list item) are "conflicts": dry_run counts them, replace removes them.
   */
  app.post('/jobs/:id/model/approve', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const db = c.env.DB;
    const body = await c.req.json<{ dry_run?: unknown; replace?: unknown }>().catch(() => ({ dry_run: undefined, replace: undefined }));
    const latest = await db
      .prepare('SELECT id, layout_json FROM job_models WHERE job_id = ? ORDER BY id DESC LIMIT 1')
      .bind(jobId)
      .first<{ id: number; layout_json: string }>();
    if (!latest) return c.json({ error: 'no_model' }, 400);
    const prepared = prepareScene(JSON.parse(latest.layout_json));
    if (prepared.errors.length) return c.json({ error: 'invalid_layout', details: prepared.errors }, 400);
    const [{ results: priceList }, { results: existing }] = await Promise.all([
      db.prepare('SELECT id, name, unit, unit_cost, catalog_key FROM elements WHERE active = 1').all<PriceListItem>(),
      db
        .prepare('SELECT * FROM job_items WHERE job_id = ?')
        .bind(jobId)
        .all<JobItem>(),
    ]);
    const items: ItemInput[] = [];
    for (const line of linesFromModel(prepared.scene, cutList(prepared.scene), priceList)) {
      const v = validateItem({ ...line, description: line.description.slice(0, 200) });
      if (v.ok) items.push(v.item);
    }
    const covered = new Set(items.map((i) => i.element_id).filter((id): id is number => id !== null));
    const conflicts = existing.filter(
      (l) => l.group_name !== MODEL_GROUP && (isCutLine(l) || (l.element_id !== null && covered.has(l.element_id))),
    );
    if (body.dry_run === true) return c.json({ lines: items.length, conflicts: conflicts.length });

    const remove = [
      db.prepare('DELETE FROM job_items WHERE job_id = ? AND group_name = ?').bind(jobId, MODEL_GROUP),
      ...(body.replace === true ? conflicts.map((l) => db.prepare('DELETE FROM job_items WHERE id = ?').bind(l.id)) : []),
      db.prepare('UPDATE jobs SET model_approved_id = ? WHERE id = ?').bind(latest.id, jobId),
    ];
    await db.batch(remove);
    await insertItems(db, jobId, items, 'ai');
    return c.json({
      lines: items.length,
      unpriced: items.filter((i) => i.unit_cost === 0).length,
      replaced: body.replace === true ? conflicts.length : 0,
    });
  });
}
