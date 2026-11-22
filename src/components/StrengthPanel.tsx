import { useMemo, useState } from 'react';
import type { StrengthReport, StrengthSettings, Verdict } from '../core/strength.ts';
import { strengthSheetSvg } from '../core/strengthSheet.ts';
import { fmtNum } from '../lib/format.ts';
import { fileSlug, shareFile, svgToPdf } from '../lib/share.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

const HEADLINE: Record<StrengthReport['status'], string> = {
  ok: 'כל החלקים עומדים בעומסים',
  close: 'החלקים עומדים, חלק קרוב לגבול',
  fail: 'יש חלקים חלשים מדי',
  unstable: 'המבנה לא יציב',
  empty: 'אין כאן חלקים לבדוק',
};
const TONE: Record<Verdict, { bar: string; text: string; soft: string }> = {
  ok: { bar: 'bg-ok', text: 'text-ok', soft: 'bg-ok-soft' },
  close: { bar: 'bg-accent', text: 'text-accent', soft: 'bg-accent-soft' },
  fail: { bar: 'bg-danger', text: 'text-danger', soft: 'bg-danger-soft' },
};
const SHOWN = 8;

/**
 * The strength check of the model being built: how it stands, the weakest pieces first (with a size that would hold),
 * what each footing holds, the loads it assumed (changeable), and a summary sheet for the engineer.
 */
export function StrengthPanel({
  report,
  hasWalls,
  settings,
  onSettings,
  title,
  businessName,
  tinted,
  onTint,
  onPick,
  onApply,
}: {
  report: StrengthReport;
  /** The model has an existing wall: show how pieces are fixed to it */
  hasWalls: boolean;
  settings: StrengthSettings;
  onSettings: (s: StrengthSettings) => void;
  title: string;
  businessName: string;
  tinted: boolean;
  onTint: (on: boolean) => void;
  onPick: (id: string) => void;
  /** Puts a suggested size on a piece; false when that piece can't be changed from here */
  onApply: (id: string, size: number[]) => boolean;
}) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const failing = report.members.filter((m) => m.verdict === 'fail').length;
  const tone: Verdict = report.status === 'ok' ? 'ok' : report.status === 'close' ? 'close' : 'fail';
  const list = all ? report.members : report.members.slice(0, SHOWN);
  const date = useMemo(() => new Intl.DateTimeFormat('he-IL').format(new Date()), []);

  const sheet = async () => {
    setBusy(true);
    try {
      const svg = strengthSheetSvg(report, { title, business: businessName, date });
      const file = new File([await svgToPdf(svg, 'A4', title)], `strength-${fileSlug(title)}.pdf`, { type: 'application/pdf' });
      const r = await shareFile(file, title);
      if (r === 'needs_tap') setPending(file);
      else if (r === 'downloaded') toast('הקובץ נשמר בהורדות');
    } catch {
      toast('לא הצלחתי להכין את הדף. נסה שוב.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-md px-3 py-2.5 ${TONE[tone].soft}`}>
        <p className={`font-semibold ${TONE[tone].text}`}>
          {report.status === 'fail' ? (failing === 1 ? 'חלק אחד חלש מדי' : `${failing} חלקים חלשים מדי`) : HEADLINE[report.status]}
        </p>
        {report.status === 'unstable' && (
          <p className="mt-1 text-[0.9rem]">
            {hasWalls && settings.wall === 'pinned'
              ? 'משהו זז בלי שום דבר שיחזיק אותו. גגון שתלוי על הקיר בלי עמודים צריך עיגון מקובע: בחר "מקובע" בחיבור לקיר, למטה.'
              : hasWalls
                ? 'משהו זז בלי שום דבר שיחזיק אותו. בדוק שהכול מחובר, ושהחלקים מגיעים עד הקיר או עד הקרקע.'
                : 'משהו זז בלי שום דבר שיחזיק אותו. בדוק שהכול מחובר ושהעמודים יושבים על הקרקע. גגון שנתלה על קיר: הוסף "קיר קיים".'}
          </p>
        )}
        <p className="mt-1 text-[0.85rem] text-muted">הערכה לבחירת פרופילים. פרגולה, גגון ומעקה צריכים אישור יציבות של מהנדס.</p>
      </div>

      {report.members.length > 0 && (
        <div className="flex gap-2">
          <button type="button" onClick={() => onTint(!tinted)} className="btn-secondary min-h-11 flex-1 px-3 text-[0.9rem]">
            <Icon name="eye" size={18} />
            {tinted ? 'בלי צבעים' : 'צבע בתלת־ממד'}
          </button>
          <button type="button" onClick={() => void (pending ? shareFile(pending, title) : sheet())} disabled={busy} className="btn-secondary min-h-11 flex-1 px-3 text-[0.9rem] disabled:opacity-50">
            <Icon name="share" size={18} />
            {busy ? 'מכין...' : pending ? 'שתף את הדף' : 'דף למהנדס'}
          </button>
        </div>
      )}

      {report.members.length > 0 && (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <li key={m.id} className="py-2.5">
              <button type="button" onClick={() => onPick(m.id)} className="block w-full text-start">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold">
                    {m.label ? `${m.label}, ` : ''}
                    {m.name}
                  </p>
                  <span className={`tnum shrink-0 font-semibold ${TONE[m.verdict].text}`} dir="ltr">
                    {Math.round(m.util * 100)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className={`h-full rounded-full ${TONE[m.verdict].bar}`} style={{ width: `${Math.min(100, Math.round(m.util * 100))}%` }} />
                </div>
                <p className="tnum mt-1 text-[0.85rem] text-muted">
                  {m.why}, {m.case}, אורך {fmtNum(m.length)}
                </p>
              </button>
              {m.suggest && (
                <button
                  type="button"
                  onClick={() => {
                    if (!m.suggest) return;
                    if (onApply(m.id, m.suggest.size)) toast(`הוחלף ל${m.suggest.name}`);
                    else toast('את החלק הזה מחליפים בבלוק עצמו: גע בו כדי לפתוח אותו.');
                  }}
                  className="mt-1.5 flex min-h-10 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[0.85rem] font-semibold"
                >
                  <Icon name="check" size={16} />
                  להחליף ל{m.suggest.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {report.members.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="text-[0.9rem] font-semibold text-accent underline underline-offset-4">
          {all ? 'רק החלשים' : `כל ${report.members.length} החלקים`}
        </button>
      )}

      <ul className="space-y-1 text-[0.9rem]">
        {report.sway && (
          <li className="tnum">
            תזוזה בראש העמודים ברוח: {fmtNum(Math.round(report.sway.mm))} מ״מ, מותר {fmtNum(Math.round(report.sway.limit))}
          </li>
        )}
        {report.sag && (
          <li className="tnum">
            השקיעה הגדולה: {fmtNum(Math.round(report.sag.mm))} מ״מ, מותר {fmtNum(Math.round(report.sag.limit))}
          </li>
        )}
        {report.wallSupports > 0 && (
          <li>{report.wallSupports === 1 ? 'נקודה אחת מעוגנת לקיר.' : `${report.wallSupports} נקודות מעוגנות לקיר.`}</li>
        )}
        {hasWalls && report.wallSupports === 0 && report.status !== 'empty' && <li className="text-danger">שום חלק לא מגיע עד הקיר, אז הקיר לא מחזיק כלום.</li>}
        {report.movers > 0 && <li className="text-muted">כנף נעה לא נבדקת בעצמה. המשקל והרוח שלה עוברים לעמודים בצירים או בגלגלות.</li>}
        {report.leavesMissing > 0 && <li className="text-danger">לא מצאתי עמוד שמחזיק כנף, אז העומס שלה לא נכנס לבדיקה.</li>}
        {report.loose.length > 0 && (
          <li className="text-danger">{report.loose.length === 1 ? 'חלק אחד לא מחובר לשלד ולא נבדק.' : `${report.loose.length} חלקים לא מחוברים לשלד ולא נבדקו.`}</li>
        )}
        {report.unsupported.length > 0 && (
          <li className="text-danger">{report.unsupported.length === 1 ? 'משטח אחד לא יושב על שום חלק.' : `${report.unsupported.length} משטחים לא יושבים על שום חלק.`}</li>
        )}
      </ul>

      {report.supports.length > 0 && (
        <details className="plate rounded-md px-3 py-2">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold">עיגון ויסודות</summary>
          <p className="mb-2 text-[0.85rem] text-muted">מה כל נקודה על הקרקע מחזיקה במקרה החמור, אחרי מקדמי עומס.</p>
          <ul className="space-y-2 pb-1 text-[0.9rem]">
            {report.supports.map((s, i) => (
              <li key={i} className="tnum">
                <span className="font-semibold">
                  ברוחב {fmtNum(Math.round(s.at[0]))}, בעומק {fmtNum(Math.round(s.at[2]))}:
                </span>{' '}
                לחיצה {s.down.toFixed(1)}, שליפה {s.up.toFixed(1)}, הצידה {s.shear.toFixed(1)} קילוניוטון, מומנט {s.moment.toFixed(2)} קילוניוטון מטר
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="plate rounded-md px-3 py-2">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold">עומסים והנחות</summary>
        <div className="space-y-3 pb-2">
          <KgField label="עומס על הגג (אנשים לתחזוקה)" value={settings.roofLoad} onChange={(v) => onSettings({ ...settings, roofLoad: v })} />
          <KgField label="לחץ רוח באתר" hint="לפי ת״י 414. באזור פתוח או גבוה, יותר." value={settings.wind} onChange={(v) => onSettings({ ...settings, wind: v })} />
          <div>
            <p className="mb-1 text-[0.85rem] text-muted">העמודים בקרקע</p>
            <div className="flex gap-2">
              {(
                [
                  ['fixed', 'מקובעים'],
                  ['pinned', 'על ציר'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSettings({ ...settings, base: key })}
                  className={`min-h-10 flex-1 rounded-md border px-3 text-[0.9rem] font-semibold ${settings.base === key ? 'border-ink bg-ink text-white' : 'border-line-strong'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[0.8rem] text-muted">מקובע: פלטה על 4 ברגים, או יציקה בבטון. על ציר: פלטה קטנה או בורג אחד.</p>
          </div>
          {hasWalls && (
            <div>
              <p className="mb-1 text-[0.85rem] text-muted">החיבור לקיר</p>
              <div className="flex gap-2">
                {(
                  [
                    ['pinned', 'על ציר'],
                    ['fixed', 'מקובע'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSettings({ ...settings, wall: key })}
                    className={`min-h-10 flex-1 rounded-md border px-3 text-[0.9rem] font-semibold ${settings.wall === key ? 'border-ink bg-ink text-white' : 'border-line-strong'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[0.8rem] text-muted">על ציר: קורה על פלטה עם ברגים בשורה אחת, או על קורת עיגון לאורך הקיר. מקובע: פלטה עם ברגים למעלה ולמטה, לגגון שתלוי על הקיר בלי עמודים.</p>
            </div>
          )}
          <ul className="list-inside list-disc space-y-0.5 text-[0.85rem] text-muted">
            <li>חיבורים מרותכים. מקדמי עומס 1.35 למשקל ו־1.5 לעומס ולרוח.</li>
            <li>פלדה בחוזק 235, נירוסטה 210, אלומיניום 150.</li>
            <li>שקיעה מותרת: המפתח חלקי 200. תזוזה בראש עמוד: הגובה חלקי 150.</li>
            <li>עמוד שעומד לבד על הקרקע נבדק לקריסה באורך כפול.</li>
          </ul>
        </div>
      </details>
    </div>
  );
}

/** A load in kilograms per square metre (stored in kN/m²) */
function KgField({ label, hint, value, onChange }: { label: string; hint?: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(Math.round(value * 100)));
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n <= 1000) onChange(n / 100);
    else setText(String(Math.round(value * 100)));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[0.85rem] text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <input className="field tnum w-28" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        <span className="text-[0.9rem]">ק״ג למ״ר</span>
      </span>
      {hint && <span className="mt-1 block text-[0.8rem] text-muted">{hint}</span>}
    </label>
  );
}
