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
