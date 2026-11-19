/** Job dates (the measuring visit, the work) and calendar files for the phone. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { JOB_SELECT, withQuoteStatus } from '../sql.ts';
import { icsEvent, isValidSlotStart } from '../../src/core/calendar.ts';
import type { Job } from '../../src/core/types.ts';

export function jobEventDetails(job: Job, origin: string): string {
  return [
    job.client_name && `לקוח: ${job.client_name}${job.client_phone ? `, ${job.client_phone}` : ''}`,
    job.description,
    `${origin}/#/jobs/${job.id}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function registerSchedule(app: App): void {
  app.patch('/jobs/:id/schedule', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const body = await c.req.json<{ kind?: unknown; scheduled_at?: unknown; scheduled_hours?: unknown }>();
    const at = body.scheduled_at ?? null;
    if (at !== null && !isValidSlotStart(at)) return c.json({ error: 'invalid date' }, 400);
    let hours: number | null = null;
    if (at !== null && body.scheduled_hours != null && body.scheduled_hours !== '') {
      hours = Number(body.scheduled_hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 240) return c.json({ error: 'invalid hours' }, 400);
    }
    // A visit date on a new lead means the measuring visit is booked
    const row =
      body.kind === 'visit'
        ? await c.env.DB.prepare(
            `UPDATE jobs SET visit_at = ?,
                    status = CASE WHEN ? IS NOT NULL AND status = 'lead' THEN 'visit' ELSE status END,
                    updated_at = datetime('now')
              WHERE id = ? RETURNING id`,
          )
            .bind(at, at, id)
            .first()
        : await c.env.DB.prepare(
            "UPDATE jobs SET scheduled_at = ?, scheduled_hours = ?, updated_at = datetime('now') WHERE id = ? RETURNING id",
          )
            .bind(at, hours, id)
            .first();
    if (!row) return c.json({ error: 'not found' }, 404);
    const job = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<{ quote_status: unknown }>();
    return c.json(job && withQuoteStatus(job));
  });

  app.get('/jobs/:id/calendar.ics', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const job = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<Job>();
    const visit = c.req.query('kind') === 'visit';
    const start = visit ? job?.visit_at : job?.scheduled_at;
    if (!job || !start) return c.json({ error: 'not found' }, 404);
    const origin = new URL(c.req.url).origin;
    const ics = icsEvent(
      { start, hours: visit ? 1 : (job.scheduled_hours ?? 2) },
      { title: visit ? `ביקור ומדידה: ${job.title}` : job.title, location: job.site_address, details: jobEventDetails(job, origin) },
      `job-${job.id}${visit ? '-visit' : ''}@${new URL(origin).hostname}`,
    );
    return c.body(ics, 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="job-${job.id}${visit ? '-visit' : ''}.ics"`,
      'cache-control': 'no-store',
    });
  });
}
