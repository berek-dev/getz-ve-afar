import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail, JobModel, ModelRun } from '../lib/api.ts';
import type { JobItem } from '../core/types.ts';
import { anchorDimensions, cutList, prepareScene } from '../core/scene.ts';
import type { CutList } from '../core/scene.ts';
import { buildLayoutPrompt, designRequests, parseLayoutReply } from '../core/layoutPrompt.ts';
import type { PromptBoqLine } from '../core/layoutPrompt.ts';
import { MODEL_GROUP } from '../core/modelBoq.ts';
import { compressImage } from '../lib/image.ts';
import { appendText, useDictation } from '../lib/speech.ts';
import { useFeatures } from '../lib/features.ts';
import { dismissModelRun, followServerRun, getDraft, saveDraft, startModelRun, stopModelRun, useModelRun, useTicker } from '../lib/modelRuns.ts';
import type { ModelDraft } from '../lib/modelRuns.ts';
import { fmtNum } from '../lib/format.ts';
import { ModelView } from './ModelView.tsx';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';

type Mode = 'new' | 'edit';

/** The model step: the 3D model, talking to it until it is right, then "ההדמיה מוכנה". Loaded lazily. */
export default function ModelSection({
  job,
  onApproved,
  onModelChange,
}: {
  job: JobDetail;
  /** After approval: reload the job (its lines changed) and move on */
  onApproved: () => Promise<void>;
  onModelChange: (m: { versions: number; latestId: number | null }) => void;
}) {
  const [model, setModel] = useState<JobModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    api
      .model(job.id)
      .then((m) => {
        setModel(m);
        if (m.run?.status === 'running') followServerRun({ id: job.id, title: job.title }, m.run);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [job.id, job.title]);

  const apply = (m: JobModel) => {
    setModel(m);
    setWarnings(m.warnings ?? []);
    onModelChange({ versions: m.history.length, latestId: m.history[0]?.id ?? null });
  };

  const prepared = useMemo(() => (model?.layout ? prepareScene(model.layout) : null), [model]);
  const ok = prepared && prepared.errors.length === 0 ? prepared : null;
  const cut = useMemo(() => (ok ? cutList(ok.scene) : null), [ok]);
  const designKey = String(model?.history.find((v) => v.mode === 'new')?.id ?? 'none');
  const requests = useMemo(() => (model ? designRequests(model.history) : []), [model]);
  const chat = useModelChat(job, model, apply);

  if (error) {
    return (
      <p className="rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!model) return <p className="text-muted">טוען את ההדמיה...</p>;

  const undo = async () => {
    try {
      apply(await api.undoModel(job.id));
      toast('השינוי האחרון בוטל');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const busyOverlay = chat.busy && (
    <div className="absolute inset-0 grid place-items-center bg-ink/60 p-6 text-center text-white" role="status">
      <div>
        <p className="font-semibold">{chat.mode === 'edit' ? 'מעדכן את המודל' : 'בונה את המודל'}...</p>
        <p className="tnum mt-1 text-sm text-white/80">{chat.seconds} שנ׳. אפשר לעבור למסך אחר בינתיים.</p>
        <button type="button" onClick={chat.stop} className="mt-3 min-h-11 rounded-md border border-white/60 px-4 text-sm font-semibold">
          עצור
        </button>
      </div>
    </div>
  );

  const notes = ok?.scene.notes ?? [];

  return (
    <div>
      {ok && cut ? (
        <>
          <ModelView
            prepared={ok}
            cut={cut}
            designKey={designKey}
            title={ok.scene.title}
            overlay={busyOverlay}
            footer={<ChatComposer chat={chat} compact />}
          />
          <p className="tnum mt-2 px-1 text-[0.85rem] text-muted">
            {summary(cut)}
            {ok.scene.finish?.name ? `, ${ok.scene.finish.name}` : ''}
          </p>
          {warnings.length > 0 && <p className="mt-2 rounded-md border border-accent/60 p-2.5 text-sm">לבדוק: {warnings.slice(0, 3).join('; ')}</p>}
          <ApproveBar job={job} latestId={model.history[0]?.id ?? null} onApproved={onApproved} />
        </>
      ) : (
        <div className="plate rounded-md px-5 py-6 text-center">
          <Icon name="cube" size={32} className="mx-auto text-faint" />
          <p className="mt-2 text-muted">
            {prepared ? `הפריסה השמורה לא תקינה (${prepared.errors.slice(0, 2).join(', ')}). אפשר לבטל אותה או לתאר מחדש.` : 'מתארים במילים, עם תמונה או סקיצה, ומקבלים מודל.'}
          </p>
        </div>
      )}

      <section className="plate mt-5 rounded-md p-4" aria-labelledby="chat-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="chat-title" className="font-semibold">
            {chat.mode === 'edit' ? 'מה לשנות?' : 'מה בונים?'}
          </h2>
          {model.layout != null && (
            <button type="button" onClick={() => chat.setStartNew(!chat.startNew)} className="min-h-11 text-sm text-muted underline underline-offset-4">
              {chat.startNew ? 'חזרה לשינויים' : 'מההתחלה'}
            </button>
          )}
        </div>
        <ChatComposer chat={chat} />

        {(requests.length > 0 || model.history.length > 0 || notes.length > 0 || model.run) && (
          <div className="mt-4 space-y-2 border-t border-line pt-3">
            {requests.length > 0 && (
              <ol className="space-y-1 text-sm text-muted">
                {requests.slice(-4).map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-faint" />
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            )}
            {model.run && lastBuild(model.run) && <p className="text-[0.8rem] text-faint">{lastBuild(model.run)}</p>}
            {notes.length > 0 && (
              <details className="text-sm text-muted">
                <summary className="min-h-11 cursor-pointer py-2.5">הנחות של המודל ({notes.length})</summary>
                <ul className="list-disc space-y-0.5 ps-5">
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {model.history.length > 0 && (
              <button type="button" onClick={() => void undo()} disabled={chat.busy} className="flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted">
                <Icon name="undo" size={18} />
                {model.history.length > 1 ? 'בטל את השינוי האחרון' : 'מחק את ההדמיה'}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** "ההדמיה מוכנה": approve the model, which fills the materials in the price. */
function ApproveBar({ job, latestId, onApproved }: { job: JobDetail; latestId: number | null; onApproved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<number | null>(null);
  const approvedId = job.model_approved_id ?? null;
  const state = approvedId === null ? 'draft' : approvedId === latestId ? 'approved' : 'changed';

  const approve = async (replace?: boolean) => {
    setBusy(true);
    try {
      if (replace === undefined) {
        const dry = await api.approveModel(job.id, { dryRun: true });
        if ((dry.conflicts ?? 0) > 0) {
          setConflicts(dry.conflicts ?? 0);
          return;
        }
      }
      const r = await api.approveModel(job.id, { replace: replace === true });
      setConflicts(null);
      toast(`ההדמיה אושרה: ${r.lines} שורות חומרים במחיר${r.unpriced ? `, ${r.unpriced} בלי מחיר` : ''}`);
      await onApproved();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {state === 'approved' ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-ok-soft px-3.5 py-2.5">
          <span className="flex items-center gap-2 font-semibold text-ok">
            <Icon name="check" size={20} />
            ההדמיה אושרה
          </span>
          <a href={`#/jobs/${job.id}/boq`} className="text-[0.9rem] font-semibold text-accent">
            למחיר
          </a>
        </div>
      ) : (
        <>
          {state === 'changed' && <p className="mb-2 rounded-md bg-accent-soft px-3 py-2 text-[0.9rem]">ההדמיה השתנתה מאז שאושרה.</p>}
          <button type="button" onClick={() => void approve()} disabled={busy} className="btn-primary">
            <Icon name="check" />
            {busy ? 'מעדכן...' : state === 'changed' ? 'לאשר מחדש ולעדכן את המחיר' : 'ההדמיה מוכנה'}
          </button>
          <p className="mt-1.5 px-1 text-[0.85rem] text-muted">החומרים ייכנסו למחיר, והשרטוט והחיתוך יוכנו ממנה.</p>
        </>
      )}
      <Sheet open={conflicts !== null} onClose={() => setConflicts(null)} title="שורות שכבר במחיר">
        {conflicts !== null && (
          <div className="space-y-3">
            <p>
              בכתב הכמויות כבר יש {conflicts === 1 ? 'שורה אחת' : `${conflicts} שורות`} של פרופילים או פרזול שנכתבו ביד, וגם ההדמיה כוללת אותם.
            </p>
            <button type="button" onClick={() => void approve(true)} disabled={busy} className="btn-primary">
              להחליף אותן בשורות מההדמיה
            </button>
            <button type="button" onClick={() => void approve(false)} disabled={busy} className="btn-secondary w-full">
              להשאיר גם אותן
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** "נבנתה ב־54 שנ׳, עם Gemini 3.6 Flash": how long the last Gemini build took and which model answered */
function lastBuild(run: ModelRun): string | null {
  if (run.status !== 'done' || !run.finished_at) return null;
  const secs = Math.round((Date.parse(`${run.finished_at.replace(' ', 'T')}Z`) - Date.parse(`${run.created_at.replace(' ', 'T')}Z`)) / 1000);
  const won = [...(run.attempts ?? [])].reverse().find((a) => a.status === 200);
  const winner = won?.model;
  // Google's own word for the tier that served it ("standard", "priority"...): shows whether the key is on a paid plan
  const tier = won?.tier ? `, שירות ${won.tier}` : '';
  const name = winner?.replace(/^gemini-/, 'Gemini ').replace(/-flash-lite$/, ' Flash-Lite').replace(/-flash$/, ' Flash');
  // No parentheses around the Latin name: in right-to-left text the closing one jumps to the wrong side
  return Number.isFinite(secs) ? `ההדמיה האחרונה נבנתה ב־${secs} שנ׳${name ? `, עם ${name}` : ''}${tier}` : null;
}

function summary(cut: CutList): string {
  const pieces = cut.pieces.reduce((s, p) => s + p.count, 0);
  const metres = cut.sections.reduce((s, x) => s + x.totalMm, 0) / 1000;
  return `${pieces} חלקי פרופיל, ${fmtNum(Math.round(metres * 10) / 10)} מ׳, בערך ${fmtNum(Math.round(cut.totalKg))} ק״ג`;
}

// ------------------------------------------------------------------------------------------- chat

function boqForPrompt(items: JobItem[]): PromptBoqLine[] {
  return items
    .filter((i) => i.unit !== 'hour' && i.group_name !== MODEL_GROUP)
    .map((i) => ({ description: i.description, element_name: i.element_name, quantity: i.quantity, unit: i.unit, pieces: i.pieces, length_mm: i.length_mm }));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(blob);
  });
}

function useModelChat(job: JobDetail, model: JobModel | null, onModel: (m: JobModel) => void) {
  const ai = useFeatures().ai;
  // What was typed stays put when leaving the screen (and the text survives a reload)
  const [draft, setDraft] = useState<ModelDraft>(() => getDraft(job.id));
  const update = (patch: Partial<ModelDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      saveDraft(job.id, next);
      return next;
    });
  const { text, startNew, image } = draft;
  const setText = (t: string | ((t: string) => string)) => setDraft((d) => {
    const next = { ...d, text: typeof t === 'function' ? t(d.text) : t };
    saveDraft(job.id, next);
    return next;
  });
  const setStartNew = (v: boolean) => update({ startNew: v });
  const setImage = (v: ModelDraft['image']) => update({ image: v });
  const [error, setError] = useState<string | null>(null);
  const run = useModelRun(job.id);
  const busy = run?.status === 'running';
  const now = useTicker(busy);
  const seconds = run ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : 0;
  const mic = useDictation((said) => setText((t) => appendText(t, said)));
  const mode: Mode = busy && run ? run.mode : model?.layout != null && !startNew ? 'edit' : 'new';

  // A run that finished (here or while Yaal was elsewhere in the app)
  useEffect(() => {
    if (!run || run.status === 'running') return;
    if (run.status === 'done' && run.result) {
      onModel(run.result);
      update({ text: '', image: null, startNew: false });
      setError(null);
      toast(run.mode === 'edit' ? 'המודל עודכן' : 'ההדמיה מוכנה');
    } else if (run.error) {
      setError(run.error);
      if (!text.trim()) setText(run.request);
    }
    dismissModelRun(job.id);
    // Only when the run changes state: the handlers above read the latest text
  }, [run?.status]);

  const done = (m: JobModel) => {
    onModel(m);
    update({ text: '', image: null, startNew: false });
    toast(mode === 'edit' ? 'המודל עודכן' : 'ההדמיה מוכנה');
  };

  const send = async () => {
    const request = text.trim();
    if (request.length < 3) return setError('כתוב מה לבנות או מה לשנות.');
    setError(null);
    try {
      const img = image ? { mime: image.blob.type || 'image/jpeg', data: await blobToBase64(image.blob) } : null;
      startModelRun({ id: job.id, title: job.title }, { request, mode, image: img });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file) return setImage(null);
    try {
      setImage({ name: file.name, blob: await compressImage(file, 1600, 0.8) });
    } catch {
      setError('לא הצלחתי לקרוא את התמונה.');
    }
  };

  /** Everything Claude or Gemini needs, to paste in a chat of your own */
  const prompt = () =>
    buildLayoutPrompt({
      job: { title: job.title, kind: job.kind, description: job.description },
      boq: boqForPrompt(job.items),
      current: mode === 'edit' ? anchorDimensions(model?.layout) : undefined,
      requests: mode === 'edit' && model ? designRequests(model.history) : [],
      request: text.trim() || 'Build the model from the bill of quantities and the job notes.',
      hasImage: Boolean(image),
    });

  const paste = async (reply: string) => {
    let layout: unknown;
    try {
      layout = parseLayoutReply(reply);
    } catch {
      return setError('זה לא JSON תקין. מעתיקים את כל התשובה, מהסוגר הראשון עד האחרון.');
    }
    const p = prepareScene(layout);
    if (p.errors.length) return setError(`הפריסה לא תקינה: ${p.errors.slice(0, 3).join(', ')}`);
    setError(null);
    try {
      done(await api.saveModel(job.id, layout, { source: 'paste', mode, request: text.trim() || undefined }));
      return true;
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return {
    ai,
    text,
    setText,
    mode,
    startNew,
    setStartNew,
    image,
    attach,
    busy,
    seconds,
    error,
    mic,
    send,
    stop: () => stopModelRun(job.id),
    prompt,
    paste,
  };
}

type Chat = ReturnType<typeof useModelChat>;

const PLACEHOLDER = {
  new: 'למשל: שער כנף כפולה לחניה, פתח 4 מטר, גובה 1.80. עמודים 100/100, מסגרת 60/40, מילוי 20/20 כל 12 ס״מ, צבע אפור.',
  edit: 'למשל: להגביה ב־20 ס״מ, מילוי כל 10 ס״מ, להוסיף משקוף באמצע, להחליף לשער הזזה',
};

function ChatComposer({ chat, compact = false }: { chat: Chat; compact?: boolean }) {
  const [reply, setReply] = useState('');

  if (compact) {
    if (!chat.ai) return null;
    return (
      <div className="flex items-end gap-2 pt-2">
        <textarea
          className="field min-h-12 flex-1 resize-none py-2.5"
          rows={1}
          value={chat.text}
          onChange={(e) => chat.setText(e.target.value)}
          placeholder="מה לשנות?"
          aria-label="מה לשנות"
          disabled={chat.busy}
        />
        {chat.mic.supported && (
          <button
            type="button"
            onClick={chat.mic.toggle}
            aria-label={chat.mic.listening ? 'סיום הכתבה' : 'הכתבה'}
            aria-pressed={chat.mic.listening}
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-md border ${chat.mic.listening ? 'border-danger bg-danger' : 'border-line-strong'}`}
          >
            <Icon name="mic" size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void chat.send()}
          disabled={chat.busy || chat.text.trim().length < 3}
          className="grid h-12 shrink-0 place-items-center rounded-md bg-accent px-4 font-semibold text-white disabled:opacity-50"
        >
          עדכן
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <textarea
        className="field min-h-32"
        value={chat.text}
        onChange={(e) => chat.setText(e.target.value)}
        placeholder={PLACEHOLDER[chat.mode]}
        aria-label={chat.mode === 'edit' ? 'מה לשנות' : 'תיאור העבודה'}
        disabled={chat.busy}
      />
      <div className="flex flex-wrap gap-2">
        {chat.mic.supported && (
          <button
            type="button"
            onClick={chat.mic.toggle}
            aria-pressed={chat.mic.listening}
            className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
              chat.mic.listening ? 'border-danger bg-danger text-white' : 'border-line-strong'
            }`}
          >
            <Icon name="mic" size={18} />
            {chat.mic.listening ? 'מקשיב... לחץ לסיום' : 'הכתבה'}
          </button>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold">
          <Icon name="camera" size={18} />
          {chat.image ? 'תמונה אחרת' : 'תמונה או סקיצה'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void chat.attach(e.target.files?.[0])} />
        </label>
      </div>
      {chat.image && (
        <p className="flex items-center gap-2 text-sm text-muted">
          מצורף: {chat.image.name}
          <button type="button" onClick={() => void chat.attach(undefined)} className="min-h-11 underline underline-offset-4">
            הסר
          </button>
        </p>
      )}
      {chat.error && (
        <p className="text-danger" role="alert">
          {chat.error}
        </p>
      )}

      {chat.ai ? (
        <>
          <button type="button" onClick={() => void chat.send()} disabled={chat.busy} className="btn-primary">
            <Icon name="sparkles" />
            {chat.busy ? `עובד... ${chat.seconds} שנ׳` : chat.mode === 'edit' ? 'עדכן את המודל' : 'צור הדמיה'}
          </button>
          {chat.busy && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">אפשר לעבור למסך אחר, נודיע כשמוכן.</p>
              <button type="button" onClick={chat.stop} className="min-h-11 shrink-0 px-2 text-muted underline underline-offset-4">
                עצור
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">היצירה האוטומטית לא מופעלת. אפשר דרך Gemini, Claude או ChatGPT, כאן למטה.</p>
      )}

      <OtherChat chat={chat} reply={reply} setReply={setReply} />
    </div>
  );
}

const OTHER_CHATS = [
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
];

/**
 * The same instructions through Yaal's own Gemini, Claude or ChatGPT app (often faster than the API): one tap copies
 * them and opens the app, one tap back here pastes the answer from the clipboard.
 */
function OtherChat({ chat, reply, setReply }: { chat: Chat; reply: string; setReply: (v: string) => void }) {
  const [manual, setManual] = useState(false);
  const copy = () => {
    // No await before the link opens: iPhone only allows opening an app straight from the tap
    void navigator.clipboard.writeText(chat.prompt()).then(
      () => toast(chat.image ? 'ההנחיות הועתקו. צרף שם גם את התמונה' : 'ההנחיות הועתקו. הדבק ושלח'),
      () => toast('לא הצלחתי להעתיק'),
    );
  };
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim().length < 10) return toast('בלוח אין תשובה. העתק את כל התשובה מהצ׳אט');
      await chat.paste(text);
    } catch {
      setManual(true);
      toast('לא הצלחתי לקרוא מהלוח. הדבק כאן למטה');
    }
  };
  return (
    <section className="rounded-md border border-line p-3" aria-label="דרך האפליקציה של Gemini, Claude או ChatGPT">
      <p className="text-sm text-muted">או דרך האפליקציה שלך, לרוב מהיר יותר. העתק ופתח:</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {OTHER_CHATS.map((c) => (
          <a
            key={c.name}
            href={c.url}
            target="_blank"
            rel="noreferrer"
            onClick={copy}
            aria-label={`העתק את ההנחיות ופתח את ${c.name}`}
            className="btn-secondary gap-1.5 px-1 text-[0.9rem]"
          >
            <Icon name="copy" size={16} />
            {c.name}
          </a>
        ))}
      </div>
      <button type="button" onClick={() => void pasteFromClipboard()} className="btn-secondary mt-2 w-full text-[0.9rem]">
        <Icon name="cube" size={18} />
        הדבק את התשובה והצג
      </button>
      <details className="mt-1 text-sm" open={manual}>
        <summary className="min-h-11 cursor-pointer py-2.5 text-muted">הדבקה ידנית</summary>
        <textarea
          className="field min-h-28 font-mono text-sm"
          dir="ltr"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="{ ... }"
          aria-label="התשובה מהצ׳אט"
        />
        <button
          type="button"
          onClick={() => void chat.paste(reply).then((ok) => ok && setReply(''))}
          disabled={reply.trim().length < 10}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-sunken font-semibold text-ink disabled:opacity-50"
        >
          הצג את המודל
        </button>
      </details>
    </section>
  );
}
