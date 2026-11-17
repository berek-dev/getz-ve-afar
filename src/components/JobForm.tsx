import { useState } from 'react';
import type { FormEvent } from 'react';
import { errorMessage } from '../lib/api.ts';
import type { NewJob } from '../lib/api.ts';
import { JOB_KIND_LABELS } from '../core/types.ts';
import type { JobKind } from '../core/types.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

export const KIND_ICON: Record<JobKind, IconName> = {
  fabrication: 'frame',
  pipe: 'pipe',
  service: 'wrench',
  earthworks: 'excavator',
};

const KIND_HINT: Record<JobKind, string> = {
  fabrication: 'שערים, מעקות, פרגולות',
  pipe: 'קווי מים וצינורות',
  service: 'תיקון מהיר אצל לקוח',
  earthworks: 'חפירה, פילוס, פינוי',
};


/** New job / edit job form (kind tiles, title, client, phone, place, details). */
export function JobForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: NewJob;
  submitLabel: string;
  onSubmit: (job: NewJob) => Promise<void>;
}) {
  const [form, setForm] = useState<NewJob>(initial ?? { title: '', kind: 'fabrication' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleMissing, setTitleMissing] = useState(false);

  const set = <K extends keyof NewJob>(key: K, value: NewJob[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setTitleMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 font-semibold">סוג העבודה</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(JOB_KIND_LABELS) as JobKind[]).map((kind) => {
            const selected = form.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => set('kind', kind)}
                className={`relative flex min-h-24 flex-col items-start gap-1 rounded-[10px] border-2 p-3 text-start ${
                  selected ? 'border-hivis bg-steel-950' : 'border-steel-700 bg-steel-900'
                }`}
              >
                <Icon name={KIND_ICON[kind]} size={28} className={selected ? 'text-hivis' : 'text-steel-300'} />
                <span className="font-semibold">{JOB_KIND_LABELS[kind]}</span>
                <span className="text-sm leading-tight text-steel-300">{KIND_HINT[kind]}</span>
                {selected && (
                  <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-hivis text-steel-950">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block font-semibold">מה העבודה?</span>
        <input
          className="field"
          value={form.title}
          onChange={(e) => {
            set('title', e.target.value);
            if (e.target.value.trim()) setTitleMissing(false);
          }}
          placeholder="למשל: שער כנף כפולה 4 מ׳"
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? 'title-error' : undefined}
        />
        {titleMissing && (
          <span id="title-error" className="mt-1.5 block text-sm text-primer-light">
            כתוב במילה או שתיים מה העבודה, כדי שתזהה אותה ברשימה.
          </span>
        )}
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">שם הלקוח</span>
        <input
          className="field"
          value={form.client_name ?? ''}
          onChange={(e) => set('client_name', e.target.value)}
          placeholder="למשל: משפחת כהן"
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">טלפון של הלקוח</span>
        <input
          className="field"
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={form.client_phone ?? ''}
          onChange={(e) => set('client_phone', e.target.value)}
          placeholder="050-0000000"
          autoComplete="off"
        />
        <span className="mt-1.5 block text-sm text-steel-300">כדי לשלוח לו הצעת מחיר בוואטסאפ בלחיצה.</span>
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">איפה?</span>
        <input
          className="field"
          value={form.site_address ?? ''}
          onChange={(e) => set('site_address', e.target.value)}
          placeholder="יישוב או כתובת"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">פרטים</span>
        <textarea
          className="field min-h-28"
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="מידות, חומרים, מה הלקוח ביקש"
        />
        <span className="mt-1.5 flex items-center gap-1.5 text-sm text-steel-300">
          <Icon name="mic" size={16} />
          אפשר להכתיב: לוחצים על המיקרופון במקלדת.
        </span>
      </label>

      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'שומר...' : submitLabel}
      </button>
    </form>
  );
}
