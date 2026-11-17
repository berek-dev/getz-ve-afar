/** Job photos, stored in Workers KV (free tier; images are compressed in the browser first). */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, optionalText, randomToken } from '../sql.ts';

const PHOTO_FIELDS = 'id, job_id, caption, kind, created_at';

export function registerPhotos(app: App): void {
  app.get('/jobs/:id/photos', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    const { results } = await c.env.DB.prepare(`SELECT ${PHOTO_FIELDS} FROM photos WHERE job_id = ? ORDER BY id DESC`)
      .bind(jobId)
      .all();
    return c.json(results);
  });

  app.post('/jobs/:id/photos', async (c) => {
    const jobId = parseId(c.req.param('id'));
    if (!jobId) return c.json({ error: 'bad id' }, 400);
    if (!c.env.PHOTOS) return c.json({ error: 'photos_not_configured' }, 503);
    const type = c.req.header('content-type')?.split(';')[0] ?? '';
    if (!IMAGE_TYPES.includes(type)) return c.json({ error: 'not_an_image' }, 415);
    const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
    if (!job) return c.json({ error: 'not found' }, 404);
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'image_too_large' }, 413);

    const key = `job/${jobId}/${randomToken(12)}`;
    await c.env.PHOTOS.put(key, data, { metadata: { type } });
    const row = await c.env.DB.prepare(
      `INSERT INTO photos (job_id, storage_key, caption) VALUES (?, ?, ?) RETURNING ${PHOTO_FIELDS}`,
    )
      .bind(jobId, key, optionalText(c.req.query('caption'), 200))
      .first();
    return c.json(row, 201);
  });

  app.get('/photos/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id || !c.env.PHOTOS) return c.json({ error: 'not found' }, 404);
    const row = await c.env.DB.prepare('SELECT storage_key FROM photos WHERE id = ?').bind(id).first<{ storage_key: string }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    const obj = await c.env.PHOTOS.getWithMetadata<{ type?: string }>(row.storage_key, 'arrayBuffer');
    if (!obj.value) return c.json({ error: 'not found' }, 404);
    return c.body(obj.value, 200, {
      'content-type': obj.metadata?.type ?? 'image/jpeg',
      'cache-control': 'private, max-age=31536000, immutable',
    });
  });

  app.patch('/photos/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const body = await c.req.json<{ caption?: unknown }>();
    const row = await c.env.DB.prepare(`UPDATE photos SET caption = ? WHERE id = ? RETURNING ${PHOTO_FIELDS}`)
      .bind(optionalText(body.caption, 200), id)
      .first();
    return row ? c.json(row) : c.json({ error: 'not found' }, 404);
  });

  app.delete('/photos/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const row = await c.env.DB.prepare('DELETE FROM photos WHERE id = ? RETURNING storage_key').bind(id).first<{ storage_key: string }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (c.env.PHOTOS) await c.env.PHOTOS.delete(row.storage_key);
    return c.json({ ok: true });
  });
}

/** KV objects are not removed by the database cascade, so delete them before the job. */
export async function deleteJobPhotos(db: D1Database, kv: KVNamespace | undefined, jobId: number): Promise<void> {
  if (!kv) return;
  const { results } = await db.prepare('SELECT storage_key FROM photos WHERE job_id = ?').bind(jobId).all<{ storage_key: string }>();
  await Promise.all(results.map((r) => kv.delete(r.storage_key)));
}
