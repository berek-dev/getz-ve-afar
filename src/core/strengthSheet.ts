/**
 * The strength check on one landscape A4 sheet, for the engineer who approves the work: what was assumed, every
 * piece with how much of its strength it uses and what decides it, and what each footing or anchor holds. Drawn as
 * SVG (mm), shared as a PDF the same way as the shop drawing.
 */
import type { StrengthReport } from './strength.ts';

const W = 297;
const H = 210;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, digits = 0) => n.toLocaleString('he-IL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (u: number) => `${Math.round(u * 100)}%`;

const VERDICT = { ok: 'עומד', close: 'קרוב לגבול', fail: 'חלש מדי' } as const;
const STATUS = {
  ok: 'כל החלקים עומדים בעומסים',
  close: 'החלקים עומדים, חלק מהם קרוב לגבול',
  fail: 'יש חלקים חלשים מדי',
  unstable: 'המבנה לא יציב',
  empty: 'אין חלקים לבדוק',
} as const;

export function strengthSheetSvg(report: StrengthReport, opts: { title: string; business?: string; date?: string }): string {
  const out: string[] = [];
  // Hebrew lines: right-to-left, anchored at their right edge
  const rt = (x: number, y: number, t: string, size = 2.7, extra = '') =>
    `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" direction="rtl" text-anchor="start" fill="#111"${extra}>${esc(t)}</text>`;
  const line = (x1: number, y1: number, x2: number, y2: number, w = 0.25) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="#111" stroke-width="${w}"/>`;
  const R = W - 12;
  const s = report.settings;

  out.push(rt(R, 18, `בדיקת חוזק משוערת: ${opts.title}`, 5.2, ' font-weight="bold"'));
  out.push(rt(R, 25, [opts.business, opts.date].filter(Boolean).join(', '), 3));
  out.push(rt(R, 33, STATUS[report.status], 3.6, ' font-weight="bold"'));

  // What was assumed (left column)
  const L = 108;
  let y = 44;
  out.push(rt(L, y, 'הנחות', 3.4, ' font-weight="bold"'));
  const assumptions = [
    `עומס על הגג: ${fmt(s.roofLoad * 100)} ק״ג למ״ר (${fmt(s.roofLoad, 2)} קילוניוטון למ״ר)`,
    `לחץ רוח: ${fmt(s.wind * 100)} ק״ג למ״ר (${fmt(s.wind, 2)} קילוניוטון למ״ר)`,
    'מקדמי רוח: גג פתוח 0.5 לחץ ו־1.0 יניקה; מוט 2.0, צינור 1.2, משטח 1.3',
    `חיבור לקרקע: ${s.base === 'fixed' ? 'מקובע (פלטה על 4 ברגים או יציקה)' : 'ציר'}; חיבורים מרותכים וקשיחים`,
    'פלדה S235 (מאמץ כניעה 235), אלומיניום 150, נירוסטה 210',
    'מקדמי עומס 1.35 למשקל ו־1.5 לעומס ולרוח',
    'קריסה בלחיצה לפי עקומה c; עמוד על הקרקע באורך קריסה כפול',
    'שקיעה מותרת: מפתח חלקי 200 (שלוחה: אורך חלקי 100)',
    'תזוזה מותרת בראש עמוד: גובה חלקי 150',
  ];
  y += 6;
  for (const a of assumptions) {
    out.push(rt(L, y, a, 2.5));
    y += 4.6;
  }
  if (report.movers > 0) {
    out.push(rt(L, y, 'כנף נעה: לא נבדקת בעצמה; המשקל והרוח שלה הועברו לעמוד בצירים או בגלגלות', 2.5));
    y += 4.6;
  }
  if (report.loose.length > 0) {
    out.push(rt(L, y, `${report.loose.length} חלקים לא מחוברים לשלד ולא נבדקו`, 2.5));
    y += 4.6;
  }
  y += 3;
  out.push(rt(L, y, 'עיגון ויסודות (במקרה החמור)', 3.4, ' font-weight="bold"'));
  y += 6;
  const S = [L, L - 18, L - 36, L - 52, L - 68, L - 84];
  ['רוחב', 'עומק', 'לחיצה', 'שליפה', 'גזירה', 'מומנט'].forEach((h, i) => out.push(rt(S[i], y, h, 2.4, ' font-weight="bold"')));
  out.push(line(12, y + 1.4, L, y + 1.4));
  y += 5;
  for (const sp of report.supports.slice(0, 12)) {
    [fmt(sp.at[0]), fmt(sp.at[2]), fmt(sp.down, 1), fmt(sp.up, 1), fmt(sp.shear, 1), fmt(sp.moment, 2)].forEach((v, i) => out.push(rt(S[i], y, v, 2.5)));
    y += 4.2;
  }
  out.push(rt(L, y + 1, 'מקום במ״מ; כוחות בקילוניוטון, מומנט בקילוניוטון מטר, אחרי מקדמי עומס', 2.2));

  // Every piece (right column), the weakest first
  const C = { name: R, len: R - 62, util: R - 80, why: R - 112 };
  y = 44;
  out.push(rt(R, y, 'חלקים', 3.4, ' font-weight="bold"'));
  y += 6;
  out.push(
    rt(C.name, y, 'חלק', 2.4, ' font-weight="bold"'),
    rt(C.len, y, 'אורך', 2.4, ' font-weight="bold"'),
    rt(C.util, y, 'ניצול', 2.4, ' font-weight="bold"'),
    rt(C.why, y, 'מה קובע', 2.4, ' font-weight="bold"'),
    line(L + 8, y + 1.4, R, y + 1.4),
  );
  y += 5;
  const rows = report.members.slice(0, 26);
  for (const m of rows) {
    const bold = m.verdict === 'fail' ? ' font-weight="bold"' : '';
    out.push(
      rt(C.name, y, `${m.label ? `${m.label}, ` : ''}${m.name}`, 2.5, bold),
      rt(C.len, y, fmt(m.length), 2.5),
      rt(C.util, y, `${pct(m.util)} ${VERDICT[m.verdict]}`, 2.5, bold),
      rt(C.why, y, m.suggest ? `${m.why}; כדאי ${m.suggest.name}` : m.why, 2.3),
    );
    y += 4.2;
  }
  if (report.members.length > rows.length) out.push(rt(C.name, y, `ועוד ${report.members.length - rows.length} חלקים שעומדים בעומסים`, 2.4));

  out.push(line(12, H - 21, R, H - 21));
  out.push(rt(R, H - 15, 'הערכה בלבד, לבחירת פרופילים. לא מחליפה חישוב סטטי ואישור יציבות של מהנדס קונסטרוקציה.', 2.8, ' font-weight="bold"'));
  out.push(
    rt(R, H - 10, `משקל פלדה בערך ${fmt(report.steelKg)} ק״ג${report.roofArea > 0 ? `, שטח גג ${fmt(report.roofArea / 1e6, 1)} מ״ר` : ''}`, 2.5),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="IBM Plex Sans Hebrew, Arial, sans-serif">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`,
    `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#111" stroke-width="0.5"/>`,
    ...out,
    '</svg>',
  ].join('\n');
}
