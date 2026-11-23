/**
 * Integration: the model routes against the real migrations (SQLite standing in for D1), with Google's API faked.
 * A drawing built by hand is saved, approved into the price and changed; a sketch is read (with a repair round);
 * a 3D build streams its result.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGemini, lastEvent, routes, testDb } from '../testing/harness.ts';
import type { TestDb } from '../testing/harness.ts';
import { registerModel } from './model.ts';
import { addBlock, addInfill, addMember, compileDesign, newDesign, readDesign } from '../../src/core/design.ts';
import type { Design } from '../../src/core/design.ts';
import { MODEL_GROUP } from '../../src/core/modelBoq.ts';

const rect = (...size: number[]) => ({ profile: 'rect_tube' as const, size });

function setup(env: Record<string, unknown> = {}) {
  const db = testDb();
  db.sqlite.exec(`INSERT INTO clients (name, phone) VALUES ('ישראל ישראלי', '050-0000000')`);
  db.sqlite.exec(`INSERT INTO jobs (title, kind, description, client_id) VALUES ('במה ומדרגות למחסן', 'fabrication', 'במה בגובה 1.2 מטר עם מדרגות', 1)`);
  return { db, api: routes(registerModel as never, { DB: db, ...env }) };
}

/** A platform at 1,200 with stairs up to it, a railing on its front and a frame with infill beside */
function warehouse(): Design {
  let d: Design = { ...newDesign(), grid: { x: [3000, 2000], y: [1200], z: [1500] } };
  d = addBlock(d, 'platform', [0, 1, 0], [1, 1, 1]).design;
  d = addBlock(d, 'stairs', [2, 0, 0], [1, 1, 0], {}).design;
  d = addBlock(d, 'railing', [0, 1, 1], [1, 1, 1]).design;
  const post = addMember(d, [2, 0, 1], [2, 1, 1], rect(80, 80, 3));
  const rail = addMember(post.design, [1, 1, 1], [2, 1, 1], rect(60, 40, 2));
  const low = addMember(rail.design, [1, 0, 1], [2, 0, 1], rect(60, 40, 2));
  return addInfill(low.design, [low.id as string, rail.id as string], { profile: 'square_bar', size: [16] }, 100).design;
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const count = (db: TestDb, sql: string) => Number((db.sqlite.prepare(sql).get() as { n: number }).n);

test('a drawing built by hand is saved, approved into the price, and a later change asks for approval again', async () => {
  const { db, api } = setup();
  const design = warehouse();
  const saved = await api.call('POST', '/jobs/1/model', { layout: compileDesign(design, 'במה'), source: 'builder', mode: 'new' });
  assert.equal(saved.status, 201);
  const state = await json(saved);
  assert.deepEqual(state.warnings, []);
  assert.equal((state.history as { source: string }[])[0].source, 'builder');

  // The design travels inside the layout and reads back the same
  const back = await json(await api.call('GET', '/jobs/1/model'));
  assert.deepEqual(readDesign((back.layout as { design: unknown }).design), design);

  const dry = await json(await api.call('POST', '/jobs/1/model/approve', { dry_run: true }));
  assert.ok((dry.lines as number) > 5, `lines ${dry.lines}`);
  assert.equal(count(db, 'SELECT count(*) AS n FROM job_items'), 0); // a dry run writes nothing
  const approved = await json(await api.call('POST', '/jobs/1/model/approve', {}));
  assert.equal(approved.lines, dry.lines);
  assert.equal(count(db, `SELECT count(*) AS n FROM job_items WHERE group_name = '${MODEL_GROUP}'`), dry.lines);
  const job = db.sqlite.prepare('SELECT model_approved_id AS a, (SELECT MAX(id) FROM job_models) AS l FROM jobs WHERE id = 1').get() as { a: number; l: number };
  assert.equal(job.a, job.l);

  // Yaal types a price on one of the model's lines (nothing in the price list prices it)
  const typed = db.sqlite.prepare(`SELECT id, description FROM job_items WHERE group_name = '${MODEL_GROUP}' AND unit = 'm' AND description LIKE 'פרופיל 80/80/3%'`).get() as { id: number; description: string };
  db.sqlite.prepare('UPDATE job_items SET unit_cost = 44 WHERE id = ?').run(typed.id);

  // A change saves a new version: the approved one is no longer the newest
  const wider = { ...design, grid: { ...design.grid, x: [3500, 2000] } };
  assert.equal((await api.call('POST', '/jobs/1/model', { layout: compileDesign(wider, 'במה'), source: 'builder', mode: 'edit' })).status, 201);
  const after = db.sqlite.prepare('SELECT model_approved_id AS a, (SELECT MAX(id) FROM job_models) AS l FROM jobs WHERE id = 1').get() as { a: number; l: number };
  assert.notEqual(after.a, after.l);
  // Approving again replaces the model's lines rather than adding to them
  const again = await json(await api.call('POST', '/jobs/1/model/approve', {}));
  assert.equal(count(db, `SELECT count(*) AS n FROM job_items WHERE group_name = '${MODEL_GROUP}'`), again.lines);
  // ...and keeps the price typed on the post
  const post = db.sqlite.prepare(`SELECT unit_cost FROM job_items WHERE group_name = '${MODEL_GROUP}' AND description LIKE 'פרופיל 80/80/3%'`).get() as { unit_cost: number };
  assert.equal(post.unit_cost, 44);

  // Undo goes back to the first version
  const undone = await json(await api.call('POST', '/jobs/1/model/undo'));
  assert.equal((undone.history as unknown[]).length, 1);
});

test('a broken layout is refused with what is wrong', async () => {
  const { api } = setup();
  const r = await api.call('POST', '/jobs/1/model', { layout: { version: 1, title: 'x', members: [] }, source: 'builder' });
  assert.equal(r.status, 400);
  const body = await json(r);
  assert.equal(body.error, 'invalid_layout');
  assert.ok((body.details as string[]).length > 0);
  assert.equal((await api.call('POST', '/jobs/9/model', { layout: {} })).status, 404);
});

const sketchFile = { mime: 'image/jpeg', data: 'A'.repeat(400) };
const reading = (members: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ grid: { x: [3000], y: [2000], z: [] }, members, notes: ['הגובה הוערך'], ...extra });
const frame = [
  { a: [0, 0, 0], b: [0, 1, 0], profile: 'rect_tube', size: [100, 100, 4] },
  { a: [1, 0, 0], b: [1, 1, 0], profile: 'rect_tube', size: [100, 100, 4] },
  { a: [0, 1, 0], b: [1, 1, 0], profile: 'rect_tube', size: [60, 40, 2] },
];

test('a sketch is read into a design; a wrong first reading gets one repair round', async () => {
  const { api } = setup({ GEMINI_API_KEY: 'test-key' });
  const google = fakeGemini([reading([...frame, { a: [0, 0, 0], b: [7, 0, 0], profile: 'rect_tube', size: [60, 40, 2] }]), reading(frame)]);
  try {
    const res = await api.call('POST', '/jobs/1/model/sketch', { file: sketchFile, note: 'גובה 2 מטר' });
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
    const last = await lastEvent(res);
    assert.deepEqual(last.problems, []);
    assert.deepEqual(last.notes, ['הגובה הוערך']);
    const design = readDesign(last.design);
    assert.equal(design?.members.length, 3);
    assert.equal(google.calls.length, 2);
    const first = google.calls[0].body;
    assert.ok(first.includes('image/jpeg') && first.includes('גובה 2 מטר') && first.includes('במה ומדרגות למחסן'));
    assert.ok(!first.includes('ישראל ישראלי') && !first.includes('050-0000000'), 'no client details go to Google');
    assert.match(google.calls[1].body, /Problems: members\[3\]/);
  } finally {
    google.restore();
  }
});

test('a reading that stays partly wrong still comes back, with what was left out', async () => {
  const { api } = setup({ GEMINI_API_KEY: 'test-key' });
  const wrong = reading([...frame, { a: [0, 0, 0], b: [0, 9, 0], profile: 'rect_tube', size: [60, 40, 2] }]);
  const google = fakeGemini([wrong, wrong]);
  try {
    const last = await lastEvent(await api.call('POST', '/jobs/1/model/sketch', { file: sketchFile }));
    assert.equal((last.problems as string[]).length, 1);
    assert.equal(readDesign(last.design)?.members.length, 3);
  } finally {
    google.restore();
  }
});

test('a reply with no design at all is an error, not an empty drawing', async () => {
  const { api } = setup({ GEMINI_API_KEY: 'test-key' });
  const google = fakeGemini(['I cannot read this', 'Sorry']);
  try {
    assert.deepEqual(await lastEvent(await api.call('POST', '/jobs/1/model/sketch', { file: sketchFile })), { error: 'ai_bad_design' });
  } finally {
    google.restore();
  }
});

test('a sketch request is checked before anything goes to Google', async () => {
  const google = fakeGemini([]);
  try {
    assert.equal((await setup().api.call('POST', '/jobs/1/model/sketch', { file: sketchFile })).status, 503);
    const { api } = setup({ GEMINI_API_KEY: 'test-key' });
    const expect = async (body: unknown, status: number, error: string, path = '/jobs/1/model/sketch') => {
      const r = await api.call('POST', path, body);
      assert.equal(r.status, status);
      assert.equal((await json(r)).error, error);
    };
    await expect({ file: { mime: 'text/html', data: 'A'.repeat(400) } }, 400, 'bad_file');
    await expect({ file: { mime: 'image/png', data: 'A' } }, 400, 'bad_file');
    await expect({}, 400, 'bad_file');
    await expect({ file: { mime: 'application/pdf', data: 'A'.repeat(14_000_001) } }, 400, 'file_too_large');
    await expect({ file: sketchFile }, 404, 'not found', '/jobs/42/model/sketch');
    await expect({ file: sketchFile }, 400, 'bad id', '/jobs/abc/model/sketch');
    assert.equal(google.calls.length, 0);
  } finally {
    google.restore();
  }
});

test('a 3D build streams its result and records the run', async () => {
  const { db, api } = setup({ GEMINI_API_KEY: 'test-key' });
  const layout = compileDesign(warehouse(), 'במה');
  delete (layout as { design?: unknown }).design;
  const google = fakeGemini([JSON.stringify(layout)]);
  try {
    const res = await api.call('POST', '/jobs/1/model/ai', { request: 'במה עם מדרגות', mode: 'new' });
    const last = await lastEvent(res);
    assert.equal((last.history as { source: string }[])[0].source, 'ai');
    const run = db.sqlite.prepare('SELECT status, model_id FROM model_runs').get() as { status: string; model_id: number };
    assert.equal(run.status, 'done');
    assert.ok(run.model_id > 0);
    assert.equal(api.pending.length, 1); // the build was also handed to waitUntil, so a dropped phone doesn't stop it
  } finally {
    google.restore();
  }
});

test('a 3D build that stays wrong after the repair round fails and keeps the model as it was', async () => {
  const { db, api } = setup({ GEMINI_API_KEY: 'test-key' });
  const google = fakeGemini(['{"version": 1, "members": []}', 'not json at all']);
  try {
    const last = await lastEvent(await api.call('POST', '/jobs/1/model/ai', { request: 'שער 3 מטר', mode: 'new' }));
    assert.equal(last.error, 'ai_bad_layout');
    assert.ok((last.details as string[]).length > 0);
    assert.match(google.calls[1].body, /That layout has errors/);
    assert.equal(count(db, 'SELECT count(*) AS n FROM job_models'), 0);
    assert.equal((db.sqlite.prepare('SELECT status, error FROM model_runs').get() as { status: string }).status, 'failed');
  } finally {
    google.restore();
  }
});

test('a build stopped from the app does not replace the model', async () => {
  const { db, api } = setup({ GEMINI_API_KEY: 'test-key' });
  const layout = compileDesign(warehouse(), 'במה');
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    await gate; // Gemini is still thinking when Yaal taps "עצור"
    return (await import('../testing/harness.ts')).geminiAnswer(JSON.stringify(layout));
  }) as typeof fetch;
  try {
    const building = api.call('POST', '/jobs/1/model/ai', { request: 'במה', mode: 'new' });
    const res = await building;
    // A second build while one is running is refused
    assert.equal((await api.call('POST', '/jobs/1/model/ai', { request: 'במה שנייה', mode: 'new' })).status, 409);
    const stopped = await json(await api.call('POST', '/jobs/1/model/cancel'));
    assert.equal((stopped.run as { status: string }).status, 'canceled');
    release();
    assert.equal((await lastEvent(res)).error, 'canceled');
    assert.equal(count(db, 'SELECT count(*) AS n FROM job_models'), 0);
  } finally {
    globalThis.fetch = real;
  }
});

test('when Google keeps failing, the sketch reading says why', async () => {
  const { api } = setup({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'only-model' });
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":{"message":"bad key"}}', { status: 400 })) as typeof fetch;
  try {
    const last = await lastEvent(await api.call('POST', '/jobs/1/model/sketch', { file: sketchFile }));
    assert.equal(typeof last.error, 'string');
    assert.notEqual(last.error, 'ai_bad_design');
  } finally {
    globalThis.fetch = real;
  }
});

test('a model saved from AI or a paste keeps no builder design inside it, so the builder opens the new model', async () => {
  const { api } = setup();
  const design = warehouse();
  const built = compileDesign(design, 'במה');
  assert.equal((await api.call('POST', '/jobs/1/model', { layout: built, source: 'builder', mode: 'new' })).status, 201);
  // The AI changed the model and sent it back with the old design still in it
  const changed = { ...built, members: (built.members as unknown[]).slice(1) };
  assert.equal((await api.call('POST', '/jobs/1/model', { layout: changed, source: 'paste', mode: 'edit' })).status, 201);
  const back = await json(await api.call('GET', '/jobs/1/model'));
  assert.equal((back.layout as { design?: unknown }).design, undefined);
  assert.equal(((back.layout as { members: unknown[] }).members).length, (built.members as unknown[]).length - 1);
});
