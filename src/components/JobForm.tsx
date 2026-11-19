import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { NewJob } from '../lib/api.ts';
import { JOB_KIND_LABELS } from '../core/types.ts';
import type { JobKind, Template } from '../core/types.ts';
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
  offerTemplates = false,
}: {
  initial?: NewJob;
  submitLabel: string;
  onSubmit: (job: NewJob) => Promise<void>;
  /** New jobs can start from a saved template's lines */
  offerTemplates?: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  useEffect(() => {
    if (offerTemplates) api.templates().then(setTemplates, () => undefined);
  }, [offerTemplates]);
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
                className={`relative flex min-h-24 flex-col items-start gap-1 rounded-md border-2 p-3 text-start ${
                  selected ? 'border-accent bg-accent-soft' : 'border-line bg-card'
                }`}
              >
                <Icon name={KIND_ICON[kind]} size={28} className={selected ? 'text-accent' : 'text-muted'} />
                <span className="font-semibold">{JOB_KIND_LABELS[kind]}</span>
                <span className="text-sm leading-tight text-muted">{KIND_HINT[kind]}</span>
                {selected && (
                  <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      {templates.length > 0 && (
        <label className="block">
          <span className="mb-1.5 block font-semibold">להתחיל מתבנית?</span>
          <select
            className="field"
            value={form.template_id ?? ''}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const t = templates.find((x) => x.id === id);
              setForm((f) => ({ ...f, template_id: id, title: f.title || t?.name || '' }));
            }}
          >
            <option value="">בלי תבנית, כתב כמויות ריק</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.item_count} שורות)
              </option>
            ))}
          </select>
        </label>
      )}

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
          <span id="title-error" className="mt-1.5 block text-sm text-danger">
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
        <span className="mt-1.5 block text-sm text-muted">כדי לשלוח לו הצעת מחיר בוואטסאפ בלחיצה.</span>
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
        <span className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
          <Icon name="mic" size={16} />
          אפשר להכתיב: לוחצים על המיקרופון במקלדת.
        </span>
      </label>

      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'שומר...' : submitLabel}
      </button>
    </form>
  );
}
