/**
 * Job scheduling: a job's slot is stored as Israel local time ("2026-11-24T08:00"),
 * and turned into calendar links / .ics files for the phone's calendar.
 */
export const BUSINESS_TZ = 'Asia/Jerusalem';

export interface Slot {
  /** "YYYY-MM-DDTHH:MM", local business time */
  start: string;
  hours: number;
}

const SLOT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function isValidSlotStart(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = SLOT_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60;
}

/** Minutes the time zone is ahead of UTC at the given instant. */
export function tzOffsetMinutes(at: Date, tz: string = BUSINESS_TZ): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Local business time → the real instant. */
export function localToUtc(local: string, tz: string = BUSINESS_TZ): Date {
  const m = SLOT_RE.exec(local);
  if (!m) throw new Error(`bad local time: ${local}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  // Re-check at the corrected instant (matters only next to a DST switch)
  return new Date(guess - tzOffsetMinutes(new Date(first), tz) * 60000);
}

const pad = (n: number) => String(n).padStart(2, '0');

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

export function slotRange(slot: Slot): { start: Date; end: Date } {
  const start = localToUtc(slot.start);
  const hours = slot.hours > 0 ? slot.hours : 1;
  return { start, end: new Date(start.getTime() + hours * 3600000) };
}

export interface CalendarEvent {
  title: string;
  location: string | null;
  details: string;
}

export function googleCalendarUrl(slot: Slot, ev: CalendarEvent): string {
  const { start, end } = slotRange(slot);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: ev.details,
    ctz: BUSINESS_TZ,
  });
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Lines longer than 75 octets must be folded (RFC 5545). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function icsEvent(slot: Slot, ev: CalendarEvent, uid: string, now: Date = new Date()): string {
  const { start, end } = slotRange(slot);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//getz-ve-afar//jobs//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
    ...(ev.location ? [`LOCATION:${icsEscape(ev.location)}`] : []),
    `DESCRIPTION:${icsEscape(ev.details)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(ev.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** "YYYY-MM-DD" of today in business time */
export function businessToday(now: Date = new Date()): string {
  return new Date(now.getTime() + tzOffsetMinutes(now) * 60000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
