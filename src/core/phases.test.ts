import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPhase, isStepDone, neighbours, nextAction, phaseStatus, todayList } from './phases.ts';
import type { JobFacts } from './phases.ts';

const NOW = '2026-11-19T09:00';
const base: JobFacts = { status: 'lead', kind: 'fabrication', client_name: 'משפחת לוי', item_count: 0, model_versions: 0, photo_count: 0, paid_total: 0 };

test('a new request: book the visit, then wait for it', () => {
  assert.deepEqual(nextAction(base, NOW), { step: 'visit', label: 'לתאם ביקור ומדידה', kind: 'do' });
  assert.deepEqual(nextAction({ ...base, client_name: null }, NOW)?.step, 'client');
  const booked = { ...base, status: 'visit' as const, visit_at: '2026-11-20T08:00' };
  assert.equal(currentPhase(booked, NOW), 'intake');
  assert.deepEqual(nextAction(booked, NOW), { step: 'visit', label: 'ביקור ומדידה', kind: 'wait', meta: { at: '2026-11-20T08:00' } });
});

test('after the visit: measurements, then the BOQ, then the quote and waiting for the client', () => {
  const visited = { ...base, status: 'visit' as const, visit_at: '2026-11-18T08:00' };
  assert.equal(currentPhase(visited, NOW), 'planning');
  assert.equal(nextAction(visited, NOW)?.step, 'site');
  assert.equal(nextAction({ ...visited, site_notes: 'פתח 4 מ׳' }, NOW)?.step, 'boq');
  assert.equal(nextAction({ ...visited, photo_count: 3, item_count: 12 }, NOW)?.label, 'לשלוח הצעת מחיר');

  const quoted = { ...visited, status: 'quoted' as const, item_count: 12, quote_status: 'sent', quote_created_at: '2026-11-15 10:00:00' };
  assert.deepEqual(nextAction(quoted, NOW), {
    step: 'quote',
    label: 'הצעה מחכה לתשובה',
    kind: 'wait',
    advance: { status: 'approved', label: 'הלקוח אישר' },
    meta: { days: 4 },
  });
  assert.equal(nextAction({ ...quoted, quote_status: 'expired' }, NOW)?.label, 'לשלוח הצעה מעודכנת');
});

test('approved: order materials, set the date, start, hand over', () => {
  const approved = { ...base, status: 'approved' as const, item_count: 12, quote_status: 'approved', quote_total: 14860 };
  assert.equal(currentPhase(approved, NOW), 'execution');
  assert.equal(nextAction(approved, NOW)?.step, 'orders');
  assert.equal(nextAction({ ...approved, ordered_at: '2026-11-19' }, NOW)?.step, 'schedule');
  const ready = { ...approved, ordered_at: '2026-11-19', scheduled_at: '2026-11-24T08:00' };
  assert.deepEqual(nextAction(ready, NOW)?.advance, { status: 'in_progress', label: 'התחלתי לעבוד' });
  assert.deepEqual(nextAction({ ...ready, status: 'in_progress' }, NOW)?.advance, { status: 'done', label: 'נמסר ללקוח' });
});

test('done: collect the balance, then close', () => {
  const done = { ...base, status: 'done' as const, quote_status: 'approved', quote_total: 14860, paid_total: 5000 };
  assert.equal(currentPhase(done, NOW), 'payment');
  assert.deepEqual(nextAction(done, NOW), { step: 'payments', label: 'לגבות יתרה', kind: 'do', meta: { amount: 9860 } });
  assert.equal(nextAction({ ...done, paid_total: 14860 }, NOW)?.advance?.status, 'paid');
  assert.equal(nextAction({ ...done, status: 'paid' }, NOW), null);
});

test('steps tick themselves off from the data; optional steps never become "next"', () => {
  const f = { ...base, status: 'quoted' as const, description: 'שער', visit_at: '2026-11-10T08:00', item_count: 4, model_versions: 2, quote_status: 'sent' };
  assert.equal(isStepDone('model', f), true);
  assert.equal(isStepDone('schedule', f), false);
  const planning = phaseStatus('planning', f, NOW);
  assert.deepEqual(
    planning.steps.map((s) => [s.id, s.state]),
    [
      ['model', 'done'],
      ['boq', 'done'],
      ['drawing', 'done'],
      ['schedule', 'todo'],
      ['quote', 'next'],
    ],
  );
  assert.deepEqual([planning.done, planning.total], [1, 3]);
  assert.equal(phaseStatus('payment', f, NOW).steps.find((s) => s.id === 'invoice')?.state, 'optional');
});

test('step neighbours run across phases', () => {
  assert.equal(neighbours('site').next?.id, 'model');
  assert.equal(neighbours('client').prev, null);
  assert.equal(neighbours('profit').next, null);
});

test('today: open jobs by phase, things to do before things we wait for', () => {
  const jobs = [
    { ...base, id: 1, status: 'done' as const, quote_status: 'approved', quote_total: 100, paid_total: 0 },
    { ...base, id: 2, status: 'quoted' as const, item_count: 3, quote_status: 'sent', quote_created_at: '2026-11-18' },
    { ...base, id: 3, status: 'visit' as const, item_count: 3, visit_at: '2026-11-01T08:00', photo_count: 1 },
    { ...base, id: 4, status: 'paid' as const },
    { ...base, id: 5 },
  ];
  assert.deepEqual(
    todayList(jobs, NOW).map((t) => [t.job.id, t.phase, t.action.kind]),
    [
      [5, 'intake', 'do'],
      [3, 'planning', 'do'],
      [2, 'planning', 'wait'],
      [1, 'payment', 'do'],
    ],
  );
});

test('calendar events: visits of new requests and work dates of open jobs', async () => {
  const { jobEvents } = await import('./calendar.ts');
  const events = jobEvents([
    { id: 1, status: 'visit', visit_at: '2026-11-20T08:00', scheduled_at: null, scheduled_hours: null },
    { id: 2, status: 'approved', visit_at: '2026-11-01T08:00', scheduled_at: '2026-11-19T07:00', scheduled_hours: 16 },
    { id: 3, status: 'paid', visit_at: null, scheduled_at: '2026-11-21T07:00', scheduled_hours: 4 },
  ]);
  assert.deepEqual(
    events.map((e) => [e.job.id, e.kind, e.start, e.hours]),
    [
      [2, 'work', '2026-11-19T07:00', 16],
      [1, 'visit', '2026-11-20T08:00', 1],
    ],
  );
});
