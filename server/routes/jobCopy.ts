/**
 * A copy of a job, to try things on without touching the real one or to start a similar job: its details, price
 * lines and every model version (the approval moves to the matching copy). Photos, quotes, payments, visits and the
 * schedule stay with the original; a photo shared by two jobs would be deleted from storage with either of them.
 */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';

export function registerJobCopy(app: App): void {
  app.post('/jobs/:id/copy', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const db = c.env.DB;
    const job = await db
      .prepare('SELECT title, kind, client_id, site_address, description, site_notes, model_approved_id FROM jobs WHERE id = ?')
      .bind(id)
      .first<{ title: string; kind: string; client_id: number | null; site_address: string | null; description: string | null; site_notes: string | null; model_approved_id: number | null }>();
    if (!job) return c.json({ error: 'not found' }, 404);

    const row = await db
      .prepare('INSERT INTO jobs (title, kind, client_id, site_address, description, site_notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
      .bind(`${job.title} (עותק)`, job.kind, job.client_id, job.site_address, job.description, job.site_notes)
      .first<{ id: number }>();
    if (!row) return c.json({ error: 'not created' }, 500);
    const copy = row.id;

    await db.batch([
      db
        .prepare(
          `INSERT INTO job_items (job_id, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order)
           SELECT ?, element_id, group_name, description, quantity, unit, unit_cost, length_mm, pieces, source, sort_order
             FROM job_items WHERE job_id = ? ORDER BY sort_order, id`,
        )
        .bind(copy, id),
      db
        .prepare(
          `INSERT INTO job_models (job_id, layout_json, request, mode, source, created_at)
           SELECT ?, layout_json, request, mode, source, created_at FROM job_models WHERE job_id = ? ORDER BY id`,
        )
        .bind(copy, id),
    ]);

    // The approved version is the same one in the copy: versions were copied in order
    if (job.model_approved_id != null) {
      const ids = async (jobId: number) =>
        (await db.prepare('SELECT id FROM job_models WHERE job_id = ? ORDER BY id').bind(jobId).all<{ id: number }>()).results.map((r) => r.id);
      const [from, to] = await Promise.all([ids(id), ids(copy)]);
      const at = from.indexOf(job.model_approved_id);
      if (at >= 0 && to[at] != null) await db.prepare('UPDATE jobs SET model_approved_id = ? WHERE id = ?').bind(to[at], copy).run();
    }
    return c.json({ id: copy }, 201);
  });
}
