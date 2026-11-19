import { Icon } from '../components/Icon.tsx';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Settings } from '../core/types.ts';
import { formatIls, priceBreakdown } from '../core/money.ts';
import { toast } from '../components/Toast.tsx';

type NumericKey = 'hourly_rate' | 'overhead_pct' | 'margin_pct' | 'vat_pct' | 'bar_length_mm' | 'kerf_mm';

interface Field {
  key: NumericKey;
  label: string;
  help: string;
  unit: string;
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'העבודה שלך',
    fields: [{ key: 'hourly_rate', label: 'שעת עבודה', help: 'כמה אתה גובה על שעה של עבודה שלך.', unit: '₪' }],
  },
  {
    title: 'מה מתווסף לעלות',
    fields: [
      { key: 'overhead_pct', label: 'הוצאות כלליות', help: 'דלק, ביטוח, שחיקת כלים ודיסקים. אחוז מעלות החומרים והעבודה.', unit: '%' },
      { key: 'margin_pct', label: 'רווח', help: 'מה שנשאר לך אחרי שכל העלויות מכוסות.', unit: '%' },
      { key: 'vat_pct', label: 'מע״מ', help: 'מתווסף למחיר ללקוח.', unit: '%' },
    ],
  },
  {
    title: 'חיתוך ברזל',
    fields: [
      { key: 'bar_length_mm', label: 'אורך מוט', help: 'האורך שבו קונים פרופילים מהספק.', unit: 'מ״מ' },
      { key: 'kerf_mm', label: 'פחת בכל חיתוך', help: 'כמה מ״מ הולכים לאיבוד בכל חיתוך (עובי הדיסק).', unit: 'מ״מ' },
    ],
  },
];

const ALL_FIELDS = GROUPS.flatMap((g) => g.fields);
const EXAMPLE = { materials: 1000, hours: 5 };

export function SettingsPage() {
  const [draft, setDraft] = useState<Record<NumericKey, string> | null>(null);
  const [quoteDraft, setQuoteDraft] = useState({ business_phone: '', quote_terms: '', quote_valid_days: '14' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setDraft(toDraft(s));
        setQuoteDraft(toQuoteDraft(s));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const example = useMemo(() => {
    if (!draft) return null;
    const n = (k: NumericKey) => Math.max(0, Number(draft[k]) || 0);
    return priceBreakdown({
      materials: EXAMPLE.materials,
      labor: EXAMPLE.hours * n('hourly_rate'),
      overheadPct: n('overhead_pct'),
      marginPct: n('margin_pct'),
      vatPct: n('vat_pct'),
    });
  }, [draft]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const patch = {
        ...(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, Number(draft[f.key])])) as Partial<Settings>),
        business_phone: quoteDraft.business_phone,
        quote_terms: quoteDraft.quote_terms,
        quote_valid_days: Number(quoteDraft.quote_valid_days) || 14,
      };
      const saved = await api.updateSettings(patch);
      setDraft(toDraft(saved));
      setQuoteDraft(toQuoteDraft(saved));
      toast('התמחור נשמר');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return <p className="text-muted">{error ?? 'טוען...'}</p>;
  }

  return (
    <form onSubmit={save}>
      <a href="#/business" className="-ms-1 inline-flex min-h-11 items-center gap-0.5 px-1 font-medium text-accent">
        <Icon name="back" size={20} />
        עסק
      </a>
      <h1 className="text-[1.75rem] font-bold leading-tight">הגדרות</h1>
      <p className="mt-2 max-w-md text-muted">
        המספרים האלה קובעים כמה תעלה כל הצעת מחיר. אפשר לשנות אותם בכל רגע, ההצעות החדשות יתעדכנו.
      </p>

      {GROUPS.map((group) => (
        <fieldset key={group.title} className="mt-6">
          <legend className="mb-2 text-lg font-semibold">{group.title}</legend>
          <div className="plate divide-y divide-line rounded-md">
            {group.fields.map((f) => (
              <label key={f.key} className="flex items-center gap-4 px-4 py-3.5">
                <span className="flex-1">
                  <span className="block font-semibold">{f.label}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted">{f.help}</span>
                </span>
                <span className="relative w-32 shrink-0">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    dir="ltr"
                    value={draft[f.key]}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [f.key]: e.target.value } : d))}
                    className="field tnum pe-3 ps-11 text-left text-lg font-semibold"
                  />
                  <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm text-faint">
                    {f.unit}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="mt-6">
        <legend className="mb-2 text-lg font-semibold">הצעת מחיר ללקוח</legend>
        <div className="plate space-y-4 rounded-md p-4">
          <label className="block">
            <span className="block font-semibold">טלפון של העסק</span>
            <span className="mb-1.5 block text-sm text-muted">מופיע בראש ההצעה, כדי שהלקוח יוכל להתקשר.</span>
            <input
              className="field"
              type="tel"
              dir="ltr"
              value={quoteDraft.business_phone}
              onChange={(e) => setQuoteDraft((q) => ({ ...q, business_phone: e.target.value }))}
              placeholder="050-0000000"
            />
          </label>
          <label className="block">
            <span className="block font-semibold">תוקף ההצעה (ימים)</span>
            <input
              className="field tnum mt-1.5 w-32"
              type="number"
              inputMode="numeric"
              min="1"
              max="365"
              dir="ltr"
              value={quoteDraft.quote_valid_days}
              onChange={(e) => setQuoteDraft((q) => ({ ...q, quote_valid_days: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="block font-semibold">תנאים בסוף ההצעה</span>
            <span className="mb-1.5 block text-sm text-muted">מקדמה, זמני אספקה, אחריות. מה שתכתוב כאן יופיע בכל הצעה.</span>
            <textarea
              className="field min-h-28"
              value={quoteDraft.quote_terms}
              onChange={(e) => setQuoteDraft((q) => ({ ...q, quote_terms: e.target.value }))}
              placeholder="למשל: מקדמה באישור ההצעה, יתרה בסיום ההתקנה. אחריות שנה על ריתוכים."
            />
          </label>
        </div>
      </fieldset>

      {example && (
        <section className="mt-6 rounded-md border border-line p-4" aria-labelledby="example-title">
          <h3 id="example-title" className="font-semibold">
            ככה זה נראה בהצעה
          </h3>
          <p className="mt-0.5 text-sm text-muted">
            עבודה עם חומרים ב־{formatIls(EXAMPLE.materials)} ו־{EXAMPLE.hours} שעות עבודה:
          </p>
          <dl className="tnum mt-3 space-y-1.5 text-[0.95rem]">
            <Row label="חומרים" value={example.materials} />
            <Row label={`עבודה (${EXAMPLE.hours} שעות)`} value={example.labor} />
            <Row label="הוצאות כלליות" value={example.overhead} />
            <Row label="רווח" value={example.margin} />
            <Row label="מע״מ" value={example.vat} />
          </dl>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="font-semibold">הלקוח משלם</span>
            <span className="tnum text-[1.5rem] font-bold leading-none tracking-tight">{formatIls(example.total)}</span>
          </div>
        </section>
      )}

      {error && (
        <p className="mt-4 text-danger" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary mt-6">
        {saving ? 'שומר...' : 'שמור תמחור'}
      </button>

      <button
        type="button"
        onClick={() => {
          api
            .logout()
            .catch(() => undefined)
            .finally(() => window.location.reload());
        }}
        className="mx-auto mt-8 block min-h-11 px-4 text-muted underline underline-offset-4"
      >
        יציאה מהאפליקציה
      </button>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd>{formatIls(value)}</dd>
    </div>
  );
}

function toDraft(s: Settings): Record<NumericKey, string> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<NumericKey, string>;
}

function toQuoteDraft(s: Settings) {
  return {
    business_phone: s.business_phone ?? '',
    quote_terms: s.quote_terms ?? '',
    quote_valid_days: String(s.quote_valid_days ?? 14),
  };
}
