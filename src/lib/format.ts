const num = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 0 });

export function fmtNum(n: number): string {
  return num.format(n);
}

/** 0.23 → "23%" */
export function fmtPct(share: number): string {
  return pct.format(share);
}

/** 6000 → "6 מ׳", 1670 → "1.67 מ׳" */
export function fmtMeters(mm: number): string {
  return `${num.format(mm / 1000)} מ׳`;
}

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or "YYYY-MM-DD" → Date */
export function parseDbDate(s: string): Date {
  return s.length <= 10 ? new Date(`${s}T00:00:00`) : new Date(`${s.replace(' ', 'T')}Z`);
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function fmtDate(s: string | null | undefined): string {
  return s ? dateFmt.format(parseDbDate(s)) : '';
}

export function fmtDateTime(s: string | null | undefined): string {
  return s ? dateTimeFmt.format(parseDbDate(s)) : '';
}

/** "2026-11-24T08:00" (business local time) → parts, without any time-zone shifting */
function slotDate(slot: string): Date {
  const [d, t = '00:00'] = slot.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, day, h, mi));
}

const slotDayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const slotTimeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "יום שלישי, 24.11" */
export function fmtSlotDay(slot: string): string {
  return slotDayFmt.format(slotDate(slot));
}

const shortDayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const longDayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "24.11" */
export function fmtShortDay(slot: string): string {
  return shortDayFmt.format(slotDate(slot));
}

/** "יום חמישי, 19 בנובמבר" */
export function fmtLongDay(slot: string): string {
  return longDayFmt.format(slotDate(slot));
}

/** "08:00" */
export function fmtSlotTime(slot: string): string {
  return slotTimeFmt.format(slotDate(slot));
}

/** "2026-11" → "נובמבר 2026" */
export function fmtMonth(month: string): string {
  return monthFmt.format(slotDate(`${month}-01`));
}

export function fmtHours(h: number): string {
  if (h === 0.5) return 'חצי שעה';
  if (h === 1) return 'שעה';
  if (h === 2) return 'שעתיים';
  return `${fmtNum(h)} שעות`;
}
