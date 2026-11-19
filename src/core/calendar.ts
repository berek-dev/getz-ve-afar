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

/** "YYYY-MM-DDTHH:MM" now in business time (compares with stored slots) */
export function businessNow(now: Date = new Date()): string {
  return new Date(now.getTime() + tzOffsetMinutes(now) * 60000).toISOString().slice(0, 16);
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

export interface JobEvent<J> {
  job: J;
  kind: 'visit' | 'work';
  /** "YYYY-MM-DDTHH:MM" business time */
  start: string;
  hours: number;
}

const OPEN_STATUSES = new Set(['lead', 'visit', 'quoted', 'approved', 'in_progress']);

/**
 * The measuring visits and work dates of open jobs, earliest first. With `history`, also the dates of finished
 * jobs and visits that already led to a quote (the week and month views show the past too).
 */
export function jobEvents<J extends { status: string; visit_at?: string | null; scheduled_at: string | null; scheduled_hours: number | null }>(
  jobs: J[],
  opts: { history?: boolean } = {},
): JobEvent<J>[] {
  const events: JobEvent<J>[] = [];
  for (const job of jobs) {
    if (job.status === 'lost' || (!opts.history && !OPEN_STATUSES.has(job.status))) continue;
    if (job.visit_at && (opts.history || job.status === 'lead' || job.status === 'visit')) events.push({ job, kind: 'visit', start: job.visit_at, hours: 1 });
    if (job.scheduled_at) events.push({ job, kind: 'work', start: job.scheduled_at, hours: job.scheduled_hours ?? 8 });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

// ------------------------------------------------------------------------------- week and month views

/** 0 = Sunday ... 6 = Saturday (the Israeli week starts on Sunday) */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Sunday that starts the week of `date` */
export function weekStart(date: string): string {
  return addDays(date, -dayOfWeek(date));
}

export function weekDays(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "YYYY-MM-DD" → the month's weeks, Sunday first, padded with the neighbouring months' days */
export function monthGrid(date: string): string[][] {
  const first = `${date.slice(0, 7)}-01`;
  const weeks: string[][] = [];
  let day = weekStart(first);
  const month = date.slice(0, 7);
  while (weeks.length === 0 || day.slice(0, 7) === month) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    day = addDays(day, 7);
  }
  return weeks;
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** Work longer than this is spread over the next days (a working day) */
export const WORKDAY_HOURS = 8;

/** One day's piece of an event, as drawn in the week and month views */
export interface EventSegment<J> {
  event: JobEvent<J>;
  date: string;
  /** minutes from midnight */
  startMin: number;
  endMin: number;
  /** 1-based day of a multi-day job, and how many days it takes */
  part: number;
  parts: number;
}

/** Work over a working day continues on the following days at the same hour, skipping Saturday. */
export function eventSegments<J>(event: JobEvent<J>): EventSegment<J>[] {
  const date = event.start.slice(0, 10);
  const startMin = Number(event.start.slice(11, 13)) * 60 + Number(event.start.slice(14, 16));
  const hours = event.hours > 0 ? event.hours : 1;
  const parts = event.kind === 'work' ? Math.max(1, Math.ceil(hours / WORKDAY_HOURS - 1e-9)) : 1;
  const out: EventSegment<J>[] = [];
  let day = date;
  let left = hours;
  for (let part = 1; part <= parts; part++) {
    if (part > 1) {
      day = addDays(day, 1);
      if (dayOfWeek(day) === 6) day = addDays(day, 1);
    }
    const h = parts === 1 ? hours : Math.min(WORKDAY_HOURS, left);
    left -= h;
    out.push({ event, date: day, startMin, endMin: Math.min(24 * 60, startMin + Math.round(h * 60)), part, parts });
  }
  return out;
}

/** Segments that overlap in time sit side by side: each gets a column and the number of columns in its group. */
export function layoutDay<S extends { startMin: number; endMin: number }>(segments: S[]): (S & { col: number; cols: number })[] {
  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: (S & { col: number; cols: number })[] = [];
  let group: (S & { col: number; cols: number })[] = [];
  let groupEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...group.map((s) => s.col + 1));
    for (const s of group) s.cols = cols;
    out.push(...group);
    group = [];
  };
  for (const seg of sorted) {
    if (seg.startMin >= groupEnd && group.length) close();
    const taken = new Set(group.filter((g) => g.endMin > seg.startMin).map((g) => g.col));
    let col = 0;
    while (taken.has(col)) col++;
    group.push({ ...seg, col, cols: 1 });
    groupEnd = Math.max(groupEnd, seg.endMin);
  }
  if (group.length) close();
  return out;
}
