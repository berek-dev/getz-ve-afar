import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, businessToday, googleCalendarUrl, icsEvent, isValidSlotStart, localToUtc } from './calendar.ts';

test('Israel local time → UTC in winter (+2) and summer (+3)', () => {
  assert.equal(localToUtc('2026-11-24T08:00').toISOString(), '2026-11-24T06:00:00.000Z');
  assert.equal(localToUtc('2026-07-01T08:00').toISOString(), '2026-07-01T05:00:00.000Z');
});

test('slot validation', () => {
  assert.ok(isValidSlotStart('2026-11-24T08:00'));
  assert.ok(!isValidSlotStart('2026-02-30T08:00'));
  assert.ok(!isValidSlotStart('2026-11-24 08:00'));
  assert.ok(!isValidSlotStart(null));
});

test('google calendar link carries the slot in UTC', () => {
  const url = new URL(googleCalendarUrl({ start: '2026-11-24T08:00', hours: 6 }, { title: 'שער', location: 'מושב 12', details: 'd' }));
  assert.equal(url.searchParams.get('dates'), '20261124T060000Z/20261124T120000Z');
  assert.equal(url.searchParams.get('text'), 'שער');
  assert.equal(url.searchParams.get('location'), 'מושב 12');
});

test('ics file is valid-looking and folds long lines', () => {
  const ics = icsEvent(
    { start: '2026-11-24T08:00', hours: 2 },
    { title: 'שער, כנף כפולה', location: null, details: 'א'.repeat(80) },
    'job-1@getz',
    new Date('2026-11-18T10:00:00Z'),
  );
  assert.ok(ics.includes('DTSTART:20261124T060000Z\r\n'));
  assert.ok(ics.includes('DTEND:20261124T080000Z\r\n'));
  assert.ok(ics.includes('SUMMARY:שער\\, כנף כפולה'));
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, l);
});

test('business day helpers', () => {
  assert.equal(businessToday(new Date('2026-11-18T23:30:00Z')), '2026-11-19');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('weeks start on Sunday; a month grid covers whole weeks', async () => {
  const { weekStart, weekDays, monthGrid, addMonths, dayOfWeek } = await import('./calendar.ts');
  assert.equal(dayOfWeek('2026-11-19'), 4); // Thursday
  assert.equal(weekStart('2026-11-19'), '2026-11-15');
  assert.deepEqual(weekDays('2026-11-15'), ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  const nov = monthGrid('2026-11-19');
  assert.equal(nov[0][0], '2026-11-01'); // 1 Nov 2026 is a Sunday
  assert.equal(nov.length, 5);
  assert.equal(nov[4][6], '2026-12-05');
  const feb = monthGrid('2027-02-10');
  assert.equal(feb[0][0], '2027-01-31');
  assert.equal(addMonths('2026-12-19', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-31', -1), '2025-12-01');
});

test('long work continues on the next days, skipping Saturday', async () => {
  const { eventSegments } = await import('./calendar.ts');
  const job = { id: 1 };
  const one = eventSegments({ job, kind: 'work', start: '2026-11-19T08:00', hours: 4 });
  assert.deepEqual(one.map((s) => [s.date, s.startMin, s.endMin]), [['2026-11-19', 480, 720]]);
  const two = eventSegments({ job, kind: 'work', start: '2026-11-20T07:00', hours: 16 }); // Friday
  assert.deepEqual(two.map((s) => [s.date, s.part, s.parts]), [['2026-11-20', 1, 2], ['2026-11-22', 2, 2]]);
  assert.equal(two[1].endMin, 7 * 60 + 8 * 60);
  const visit = eventSegments({ job, kind: 'visit', start: '2026-11-19T16:30', hours: 1 });
  assert.deepEqual([visit[0].startMin, visit[0].endMin], [990, 1050]);
});

test('overlapping events sit side by side', async () => {
  const { layoutDay } = await import('./calendar.ts');
  const out = layoutDay([
    { id: 'a', startMin: 480, endMin: 960 },
    { id: 'b', startMin: 600, endMin: 660 },
    { id: 'c', startMin: 1000, endMin: 1060 },
  ]);
  const by = Object.fromEntries(out.map((s) => [s.id, [s.col, s.cols]]));
  assert.deepEqual(by, { a: [0, 2], b: [1, 2], c: [0, 1] });
});
