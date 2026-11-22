/**
 * Integration: copying a job keeps its details, price lines and model versions (with the approval on the matching
 * copy), and leaves photos and quotes with the original.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes, testDb } from '../testing/harness.ts';
import { registerJobCopy } from './jobCopy.ts';

test('a copy of a job has its details, price lines and model versions, approval included', async () => {
  const db = testDb();
  db.sqlite.exec(`
    INSERT INTO clients (name, phone) VALUES ('לקוח לדוגמה', '050-0000000');
    INSERT INTO jobs (title, kind, client_id, site_address, description, site_notes, status) VALUES ('גגון', 'fabrication', 1, 'רחוב הדוגמה 1', 'גגון סנטף', 'חניה צרה', 'quoted');
    INSERT INTO jobs (title) VALUES ('עבודה אחרת');
    INSERT INTO job_items (job_id, group_name, description, quantity, unit, unit_cost, sort_order) VALUES (1, 'עבודה', 'התקנה', 8, 'hour', 150, 20), (1, 'לפי ההדמיה', 'פרופיל 100/50/3', 12, 'm', 40, 10), (2, NULL, 'לא שלי', 1, 'unit', 1, 0);
    INSERT INTO job_models (job_id, layout_json, request, mode, source) VALUES (1, '{"members":[]}', 'גגון', 'new', 'ai'), (2, '{}', NULL, 'new', 'paste'), (1, '{"members":[1]}', 'שיפוע', 'edit', 'ai');
    UPDATE jobs SET model_approved_id = 3 WHERE id = 1;
    INSERT INTO photos (job_id, storage_key) VALUES (1, 'job-1/a.jpg');
  `);
  const api = routes(registerJobCopy as never, { DB: db });

  const res = await api.call('POST', '/jobs/1/copy');
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: number };
  assert.equal(id, 3);

  const job = db.sqlite.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>;
  assert.deepEqual(
    [job.title, job.kind, job.client_id, job.site_address, job.description, job.site_notes, job.status],
    ['גגון (עותק)', 'fabrication', 1, 'רחוב הדוגמה 1', 'גגון סנטף', 'חניה צרה', 'lead'],
  );
  const items = db.sqlite.prepare('SELECT description, group_name, quantity FROM job_items WHERE job_id = ? ORDER BY sort_order').all(id);
  assert.deepEqual(
    items.map((r) => ({ ...r })),
    [
      { description: 'פרופיל 100/50/3', group_name: 'לפי ההדמיה', quantity: 12 },
      { description: 'התקנה', group_name: 'עבודה', quantity: 8 },
    ],
  );
  const models = db.sqlite.prepare('SELECT id, layout_json, request FROM job_models WHERE job_id = ? ORDER BY id').all(id) as { id: number; layout_json: string; request: string }[];
  assert.deepEqual(models.map((m) => m.request), ['גגון', 'שיפוע']);
  // The newest version was approved in the original, so it is in the copy
  assert.equal(job.model_approved_id, models[1].id);
  assert.equal(Number((db.sqlite.prepare('SELECT COUNT(*) AS n FROM photos WHERE job_id = ?').get(id) as { n: number }).n), 0);
  // The original is untouched
  assert.equal(Number((db.sqlite.prepare('SELECT COUNT(*) AS n FROM job_models WHERE job_id = 1').get() as { n: number }).n), 2);

  assert.equal((await api.call('POST', '/jobs/99/copy')).status, 404);
});
