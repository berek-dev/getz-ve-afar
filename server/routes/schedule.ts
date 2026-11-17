/** Job slot (visit or work date) and the calendar file for the phone. */
import type { App } from '../types.ts';
import { parseId } from '../types.ts';
import { JOB_SELECT } from '../sql.ts';
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
    const body = await c.req.json<{ scheduled_at?: unknown; scheduled_hours?: unknown }>();
    const at = body.scheduled_at ?? null;
    if (at !== null && !isValidSlotStart(at)) return c.json({ error: 'invalid date' }, 400);
    let hours: number | null = null;
    if (at !== null && body.scheduled_hours != null && body.scheduled_hours !== '') {
      hours = Number(body.scheduled_hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 240) return c.json({ error: 'invalid hours' }, 400);
    }
    // Setting a date on a new lead means the measuring visit is booked
    const row = await c.env.DB.prepare(
      `UPDATE jobs SET scheduled_at = ?, scheduled_hours = ?,
              status = CASE WHEN ? IS NOT NULL AND status = 'lead' THEN 'visit' ELSE status END,
              updated_at = datetime('now')
        WHERE id = ? RETURNING id`,
    )
      .bind(at, hours, at, id)
      .first();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first());
  });

  app.get('/jobs/:id/calendar.ics', async (c) => {
    const id = parseId(c.req.param('id'));
    if (!id) return c.json({ error: 'bad id' }, 400);
    const job = await c.env.DB.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first<Job>();
    if (!job?.scheduled_at) return c.json({ error: 'not found' }, 404);
    const origin = new URL(c.req.url).origin;
    const ics = icsEvent(
      { start: job.scheduled_at, hours: job.scheduled_hours ?? 2 },
      { title: job.title, location: job.site_address, details: jobEventDetails(job, origin) },
      `job-${job.id}@${new URL(origin).hostname}`,
    );
    return c.body(ics, 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="job-${job.id}.ics"`,
      'cache-control': 'no-store',
    });
  });
}
