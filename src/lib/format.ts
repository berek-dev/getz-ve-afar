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
