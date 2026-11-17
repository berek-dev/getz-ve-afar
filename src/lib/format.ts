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
