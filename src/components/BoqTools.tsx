import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { ItemDraft, JobDetail } from '../lib/api.ts';
import type { Element, JobItem, Template } from '../core/types.ts';
import { UNIT_LABELS, UNIT_PER } from '../core/types.ts';
import { formatIls } from '../core/money.ts';
import { fmtNum } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';
import { DeleteButton } from './JobMoneySection.tsx';
import { appendText, useDictation } from '../lib/speech.ts';

/** Save this job's lines as a template. */
export function SaveTemplateForm({ job, onDone }: { job: JobDetail; onDone: () => void }) {
  const [name, setName] = useState(job.title.replace(/\s*\(דוגמה\)\s*/g, '').trim());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('תן שם לתבנית.');
    setBusy(true);
    try {
      await api.saveTemplate(job.id, name.trim(), description.trim());
      toast('התבנית נשמרה');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <p className="text-steel-300">
        {job.items.length} השורות של העבודה יישמרו. בעבודה הבאה מאותו סוג מתחילים מהן ומשנים רק מידות. המחירים יילקחו
        מהמחירון של אותו יום.
      </p>
      <label className="block">
        <span className="mb-1.5 block font-semibold">שם התבנית</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: שער כנף כפולה" />
      </label>
      <label className="block">
        <span className="mb-1.5 block font-semibold">מתי משתמשים בה</span>
        <input className="field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="לא חובה" />
      </label>
      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        <Icon name="layers" />
        {busy ? 'שומר...' : 'שמור תבנית'}
      </button>
    </form>
  );
}

/** Pick a template: used to add its lines to a job, or to start a new job. */
export function TemplatePicker({
  onPick,
  actionLabel,
  allowDelete = true,
}: {
  onPick: (t: Template) => Promise<void> | void;
  actionLabel: string;
  allowDelete?: boolean;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .templates()
      .then(setTemplates)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  if (error) return <p className="text-primer-light">{error}</p>;
  if (!templates) return <p className="text-steel-300">טוען...</p>;
  if (templates.length === 0) {
    return (
      <p className="text-steel-300">
        עוד אין תבניות. פותחים עבודה שהשורות שלה טובות, ולוחצים בתחתית כתב הכמויות על ״שמור כתבנית״.
      </p>
    );
  }

  return (
    <ul className="plate divide-y divide-steel-700 rounded-[10px]">
      {templates.map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            disabled={busyId !== null}
            onClick={async () => {
              setBusyId(t.id);
              try {
                await onPick(t);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusyId(null);
              }
            }}
            className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-start"
          >
            <Icon name="layers" size={22} className="shrink-0 text-hivis" />
            <span className="min-w-0">
              <span className="block font-semibold">{t.name}</span>
              <span className="block text-sm text-steel-300">
                {busyId === t.id ? 'מוסיף...' : `${t.item_count} שורות${t.description ? `, ${t.description}` : ''}`}
              </span>
            </span>
            <span className="ms-auto shrink-0 text-sm font-semibold text-hivis">{actionLabel}</span>
          </button>
          {allowDelete && (
            <DeleteButton
              armed={armed === t.id}
              onClick={async () => {
                if (armed !== t.id) return setArmed(t.id);
                try {
                  await api.deleteTemplate(t.id);
                  setTemplates((list) => list?.filter((x) => x.id !== t.id) ?? null);
                  toast('התבנית נמחקה');
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Describe the job in plain words (or dictate it) → draft lines to review and add. */
export function AiDraft({ job, elements, onAdded }: { job: JobDetail; elements: Element[]; onAdded: (items: JobItem[]) => void }) {
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<ItemDraft[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mic = useDictation((said) => setText((t) => appendText(t, said)));

  const byId = new Map(elements.map((e) => [e.id, e]));

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.aiLines(job.id, text);
      setDrafts(r.lines);
      setNotes(r.notes);
      setPicked(new Set(r.lines.map((_, i) => i)));
      if (r.lines.length === 0) setError('לא יצאו שורות. נסה לפרט מידות וחומרים.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!drafts) return;
    setBusy(true);
    try {
      const items = await api.addItems(job.id, drafts.filter((_, i) => picked.has(i)), 'ai');
      toast(`${picked.size} שורות נוספו. עבור עליהן ובדוק מידות ומחירים`);
      onAdded(items);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  if (drafts && drafts.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-steel-300">זו טיוטה. סמן מה להוסיף; אחר כך אפשר לתקן כל שורה בכתב הכמויות.</p>
        <ul className="plate divide-y divide-steel-700 rounded-[10px]">
          {drafts.map((d, i) => {
            const el = d.element_id != null ? byId.get(d.element_id) : undefined;
            return (
              <li key={i}>
                <label className="flex min-h-14 items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-6 w-6 shrink-0 accent-hivis"
                    checked={picked.has(i)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.description}</span>
                    <span className="tnum block text-sm text-steel-300">
                      {d.group_name ? `${d.group_name}: ` : ''}
                      {d.pieces && d.length_mm
                        ? `${d.pieces} יח׳ באורך ${fmtNum(d.length_mm)} מ״מ`
                        : `${fmtNum(d.quantity)} ${UNIT_LABELS[d.unit]}`}
                      {d.unit_cost > 0 ? `, ${formatIls(d.unit_cost)} ${UNIT_PER[d.unit]}` : ''}
                    </span>
                    {el ? (
                      <span className="block text-sm text-steel-500">מהמחירון: {el.name}</span>
                    ) : (
                      d.unit_cost === 0 && <span className="block text-sm text-hivis">אין במחירון. צריך להשלים מחיר</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {notes.length > 0 && (
          <div className="rounded-[10px] border border-steel-700 p-3">
            <p className="font-semibold">הנחות שכדאי לבדוק</p>
            <ul className="mt-1 list-disc space-y-1 ps-5 text-steel-300">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="text-primer-light" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={add} disabled={busy || picked.size === 0} className="btn-primary">
          <Icon name="plus" />
          {busy ? 'מוסיף...' : `הוסף ${picked.size} שורות`}
        </button>
        <button type="button" onClick={() => setDrafts(null)} className="min-h-11 w-full text-steel-300 underline underline-offset-4">
          חזרה לתיאור
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block font-semibold">מה צריך לבנות?</span>
        <span className="mb-2 block text-sm text-steel-300">
          כמו שהיית מסביר לעובד: מידות, פרופילים, פרזול, גמר, התקנה. אפשר להכתיב עם המיקרופון במקלדת.
        </span>
        <textarea
          className="field min-h-40"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="שער כנף כפולה, פתח 4 מטר, גובה מטר שבעים וחמש. עמודים 80 על 80, מסגרת 60 על 40, מילוי 40 על 20 כל 12 סנטימטר. 4 צירים, בריח ומנעול. צביעה בתנור והתקנה."
        />
      </label>
      {mic.supported && (
        <button
          type="button"
          onClick={mic.toggle}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
            mic.listening ? 'border-primer bg-primer text-soapstone' : 'border-steel-500'
          }`}
        >
          <Icon name="mic" size={20} />
          {mic.listening ? 'מקשיב... לחץ לסיום' : 'הכתבה'}
        </button>
      )}
      <p className="text-sm text-steel-500">הטקסט והמחירון נשלחים לשירות של Google. בלי שמות וטלפונים של לקוחות.</p>
      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={draft} disabled={busy || text.trim().length < 5} className="btn-primary">
        <Icon name="sparkles" />
        {busy ? 'מכין טיוטה...' : 'הכן טיוטה'}
      </button>
    </div>
  );
}
