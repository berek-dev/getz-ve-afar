import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Settings } from '../core/types.ts';

type NumericKey = 'hourly_rate' | 'overhead_pct' | 'margin_pct' | 'vat_pct' | 'bar_length_mm' | 'kerf_mm';

const FIELDS: { key: NumericKey; label: string; suffix: string }[] = [
  { key: 'hourly_rate', label: 'תעריף לשעת עבודה', suffix: '₪' },
  { key: 'overhead_pct', label: 'תקורה', suffix: '%' },
  { key: 'margin_pct', label: 'רווח', suffix: '%' },
  { key: 'vat_pct', label: 'מע״מ', suffix: '%' },
  { key: 'bar_length_mm', label: 'אורך מוט סטנדרטי', suffix: 'מ״מ' },
  { key: 'kerf_mm', label: 'עובי חיתוך (פחת לכל חיתוך)', suffix: 'מ״מ' },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<NumericKey, string>>({} as Record<NumericKey, string>);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setSettings(s);
        setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key])])) as Record<NumericKey, string>);
      })
      .catch((e: unknown) => setMessage(errorMessage(e)));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch = Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key])])) as Partial<Settings>;
      setSettings(await api.updateSettings(patch));
      setMessage('נשמר ✓');
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <p className="text-stone-500">{message ?? 'טוען...'}</p>;

  return (
    <form onSubmit={save} className="space-y-4">
      <h2 className="text-2xl font-extrabold">הגדרות תמחור</h2>
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-3">
            <span className="font-medium">{f.label}</span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="w-28 rounded-xl border border-stone-300 px-3 py-2 text-left focus:border-ember-500 focus:outline-none"
                dir="ltr"
              />
              <span className="w-8 text-sm text-stone-500">{f.suffix}</span>
            </span>
          </label>
        ))}
      </div>
      {message && <p className="text-sm text-stone-600">{message}</p>}
      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-ember-500 py-3 font-bold text-white disabled:opacity-50"
      >
        {saving ? 'שומר...' : 'שמור'}
      </button>
    </form>
  );
}
