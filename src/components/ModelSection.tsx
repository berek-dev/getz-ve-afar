import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail, JobModel } from '../lib/api.ts';
import type { JobItem } from '../core/types.ts';
import { cutList, prepareScene } from '../core/scene.ts';
import type { CutList } from '../core/scene.ts';
import { buildLayoutPrompt, designRequests, parseLayoutReply } from '../core/layoutPrompt.ts';
import type { PromptBoqLine } from '../core/layoutPrompt.ts';
import { MODEL_GROUP, checkModelAgainstBoq } from '../core/modelBoq.ts';
import type { BoqCheckRow } from '../core/modelBoq.ts';
import { isCutLine } from '../core/quantities.ts';
import { compressImage } from '../lib/image.ts';
import { appendText, useDictation } from '../lib/speech.ts';
import { useFeatures } from '../lib/features.ts';
import { fmtNum } from '../lib/format.ts';
import { ModelView } from './ModelView.tsx';
import { ModelDrawing } from './ModelDrawing.tsx';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

type Mode = 'new' | 'edit';

/** The job's "הדמיה" tab: 3D model, talk to it, check it against the BOQ, shop drawing. Loaded lazily. */
export default function ModelSection({
  job,
  businessName,
  onItems,
  onVersions,
}: {
  job: JobDetail;
  businessName: string;
  onItems: (items: JobItem[]) => void;
  onVersions: (n: number) => void;
}) {
  const [model, setModel] = useState<JobModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    api
      .model(job.id)
      .then(setModel)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [job.id]);

  const apply = (m: JobModel) => {
    setModel(m);
    setWarnings(m.warnings ?? []);
    onVersions(m.history.length);
  };

  const prepared = useMemo(() => (model?.layout ? prepareScene(model.layout) : null), [model]);
  const ok = prepared && prepared.errors.length === 0 ? prepared : null;
  const cut = useMemo(() => (ok ? cutList(ok.scene) : null), [ok]);
  const designKey = String(model?.history.find((v) => v.mode === 'new')?.id ?? 'none');
  const requests = useMemo(() => (model ? designRequests(model.history) : []), [model]);
  const chat = useModelChat(job, model, apply);

  if (error) {
    return (
      <p className="mt-6 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
        {error}
      </p>
    );
  }
  if (!model) return <p className="mt-6 text-steel-300">טוען את ההדמיה...</p>;

  const undo = async () => {
    try {
      apply(await api.undoModel(job.id));
      toast('השינוי האחרון בוטל');
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const busyOverlay = chat.busy && (
    <div className="absolute inset-0 grid place-items-center bg-steel-950/55 p-6 text-center" role="status">
      <div>
        <p className="font-semibold">{chat.mode === 'edit' ? 'מעדכן את המודל' : 'בונה את המודל'}...</p>
        <p className="tnum mt-1 text-sm text-steel-300">{chat.seconds} שנ׳. לרוב פחות מדקה.</p>
        <button type="button" onClick={chat.stop} className="mt-3 min-h-11 rounded-lg border border-steel-300 px-4 text-sm font-semibold">
          עצור
        </button>
      </div>
    </div>
  );

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
          <div className="mt-3">
            <h2 className="text-xl font-semibold leading-snug">{ok.scene.title}</h2>
            <p className="tnum mt-0.5 text-sm text-steel-300">{summary(cut)}</p>
            {ok.scene.finish?.name && <p className="text-sm text-steel-300">גמר: {ok.scene.finish.name}</p>}
            {(ok.scene.notes ?? []).length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 ps-5 text-sm text-steel-300">
                {(ok.scene.notes ?? []).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <p className="mt-2 rounded-lg border border-hivis/60 p-2.5 text-sm">בדיקת הפריסה: {warnings.slice(0, 4).join('; ')}</p>
            )}
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-[10px] border-2 border-dashed border-steel-700 px-5 py-7 text-center">
          <Icon name="cube" size={36} className="mx-auto text-steel-500" />
          <p className="mt-3 text-steel-300">
            {prepared
              ? `הפריסה השמורה לא תקינה (${prepared.errors.slice(0, 2).join(', ')}). אפשר לבטל אותה או לתאר מחדש.`
              : 'מתארים את העבודה במילים, עם תמונה או סקיצה אם יש, ומקבלים מודל תלת־ממד, שרטוט ורשימת חיתוך. כתב הכמויות נשלח יחד עם התיאור.'}
          </p>
        </div>
      )}

      <section className="plate mt-6 rounded-[10px] p-4" aria-labelledby="chat-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="chat-title" className="text-lg font-semibold">
            {chat.mode === 'edit' ? 'מה לשנות?' : 'מה בונים?'}
          </h2>
          {model.layout != null && (
            <button
              type="button"
              onClick={() => chat.setStartNew(!chat.startNew)}
              className="min-h-11 text-sm text-steel-300 underline underline-offset-4"
            >
              {chat.startNew ? 'חזרה לשינויים' : 'עיצוב חדש מההתחלה'}
            </button>
          )}
        </div>
        <ChatComposer chat={chat} />

        {(requests.length > 0 || model.history.length > 0) && (
          <div className="mt-4 border-t border-steel-700 pt-3">
            {requests.length > 0 && (
              <ol className="space-y-1 text-sm text-steel-300">
                {requests.slice(-6).map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-steel-500" />
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            )}
            {model.history.length > 0 && (
              <button
                type="button"
                onClick={() => void undo()}
                disabled={chat.busy}
                className="mt-2 flex min-h-11 items-center gap-1.5 text-sm font-semibold text-steel-300"
              >
                <Icon name="undo" size={18} />
                {model.history.length > 1 ? 'בטל את השינוי האחרון' : 'מחק את ההדמיה'}
              </button>
            )}
          </div>
        )}
      </section>

      {ok && cut && (
        <>
          <BoqCheck job={job} cut={cut} onItems={onItems} />
          <ModelDrawing scene={ok.scene} cut={cut} businessName={businessName} />
          <p className="mt-6 text-sm text-steel-300">
            ההדמיה מצורפת להצעת המחיר שנשלחת ללקוח (אפשר לבטל בהצעה). הלקוח רואה את המודל, בלי מחירים ובלי רשימת חיתוך.
          </p>
        </>
      )}
    </div>
  );
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
  const [text, setText] = useState('');
  const [startNew, setStartNew] = useState(false);
  const [image, setImage] = useState<{ name: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const mic = useDictation((said) => setText((t) => appendText(t, said)));
  const mode: Mode = model?.layout != null && !startNew ? 'edit' : 'new';

  const done = (m: JobModel) => {
    onModel(m);
    setText('');
    setImage(null);
    setStartNew(false);
    toast(mode === 'edit' ? 'המודל עודכן' : 'ההדמיה מוכנה');
  };

  const send = async () => {
    const request = text.trim();
    if (request.length < 3) return setError('כתוב מה לבנות או מה לשנות.');
    setBusy(true);
    setError(null);
    setSeconds(0);
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    ctl.current = new AbortController();
    try {
      const img = image ? { mime: image.blob.type || 'image/jpeg', data: await blobToBase64(image.blob) } : null;
      done(await api.aiModel(job.id, { request, mode, image: img }, ctl.current.signal));
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') setError('נעצר. אם השינוי כבר הגיע לשרת, הוא יופיע בפעם הבאה שהמסך נטען.');
      else setError(errorMessage(e));
    } finally {
      clearInterval(tick);
      setBusy(false);
      ctl.current = null;
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
      current: mode === 'edit' ? model?.layout : undefined,
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
    stop: () => ctl.current?.abort(),
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
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border ${chat.mic.listening ? 'border-primer bg-primer' : 'border-steel-500'}`}
          >
            <Icon name="mic" size={20} />
          </button>
        )}
        <button
          type="button"
          onClick={() => void chat.send()}
          disabled={chat.busy || chat.text.trim().length < 3}
          className="grid h-12 shrink-0 place-items-center rounded-xl bg-hivis px-4 font-semibold text-steel-950 disabled:opacity-50"
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
              chat.mic.listening ? 'border-primer bg-primer text-soapstone' : 'border-steel-500'
            }`}
          >
            <Icon name="mic" size={18} />
            {chat.mic.listening ? 'מקשיב... לחץ לסיום' : 'הכתבה'}
          </button>
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold">
          <Icon name="camera" size={18} />
          {chat.image ? 'תמונה אחרת' : 'תמונה או סקיצה'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void chat.attach(e.target.files?.[0])} />
        </label>
      </div>
      {chat.image && (
        <p className="flex items-center gap-2 text-sm text-steel-300">
          מצורף: {chat.image.name}
          <button type="button" onClick={() => void chat.attach(undefined)} className="min-h-11 underline underline-offset-4">
            הסר
          </button>
        </p>
      )}
      {chat.error && (
        <p className="text-primer-light" role="alert">
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
            <button type="button" onClick={chat.stop} className="min-h-11 w-full text-steel-300 underline underline-offset-4">
              עצור
            </button>
          )}
          <p className="text-sm text-steel-500">
            התיאור, כתב הכמויות והתמונה נשלחים לשירות של Google. בלי שמות וטלפונים של לקוחות.
          </p>
        </>
      ) : (
        <p className="text-sm text-steel-300">
          היצירה האוטומטית עוד לא הופעלה בשרת. בינתיים: מעתיקים את ההנחיות, מדביקים אותן ב־Claude או ב־Gemini, ומדביקים כאן
          את התשובה.
        </p>
      )}

      <details className="rounded-lg border border-steel-700 p-3" open={!chat.ai}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">הדבקה ידנית מצ׳אט אחר</summary>
        <ol className="mt-1 list-decimal space-y-3 ps-5 text-sm text-steel-300">
          <li>
            כותבים למעלה מה לבנות או לשנות, ואז
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(chat.prompt()).then(
                  () => toast('ההנחיות הועתקו'),
                  () => toast('לא הצלחתי להעתיק'),
                );
              }}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-steel-500 font-semibold text-soapstone"
            >
              <Icon name="copy" size={18} />
              העתק הנחיות
            </button>
          </li>
          <li>מדביקים ב־Claude או ב־Gemini (עם התמונה, אם יש), ומעתיקים את כל התשובה.</li>
          <li>
            מדביקים כאן:
            <textarea
              className="field mt-2 min-h-28 font-mono text-sm"
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
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-steel-700 font-semibold text-soapstone disabled:opacity-50"
            >
              <Icon name="cube" size={18} />
              הצג את המודל
            </button>
          </li>
        </ol>
      </details>
    </div>
  );
}

// -------------------------------------------------------------------------------------- BOQ check

const STATUS: Record<BoqCheckRow['status'], { text: string; className: string }> = {
  match: { text: 'תואם', className: 'text-heat-7' },
  differs: { text: 'שונה', className: 'text-hivis' },
  model_only: { text: 'רק בהדמיה', className: 'text-hivis' },
  boq_only: { text: 'רק בכתב הכמויות', className: 'text-steel-300' },
};

const amount = (pieces: number, mm: number) => (mm > 0 ? `${pieces} יח׳, ${fmtNum(Math.round(mm / 100) / 10)} מ׳` : '–');

function BoqCheck({ job, cut, onItems }: { job: JobDetail; cut: CutList; onItems: (items: JobItem[]) => void }) {
  const [busy, setBusy] = useState(false);
  const own = job.items.filter((i) => i.group_name !== MODEL_GROUP);
  const fromModel = job.items.length - own.length;
  const ownCut = own.some(isCutLine);
  const rows = checkModelAgainstBoq(cut, ownCut ? own : job.items);
  const matching = rows.filter((r) => r.status === 'match').length;

  const add = async () => {
    setBusy(true);
    try {
      const r = await api.modelToBoq(job.id);
      onItems((await api.job(job.id)).items);
      toast(`${r.lines} שורות ב"${MODEL_GROUP}"${r.unpriced ? `, ${r.unpriced} בלי מחיר` : ''}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8" aria-labelledby="check-title">
      <h2 id="check-title" className="font-display text-[2.2rem] leading-none">
        מול כתב הכמויות
      </h2>
      {ownCut || fromModel ? (
        <p className="mt-1 text-sm text-steel-300">
          {matching} מתוך {rows.length} פרופילים תואמים (עד 3% הפרש).
          {fromModel > 0 && ` ${fromModel} שורות כבר נוספו מההדמיה.`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-steel-300">עוד אין פרופילים בכתב הכמויות. אפשר להוסיף את כל מה שבמודל בלחיצה.</p>
      )}
      <ul className="plate mt-3 divide-y divide-steel-700 rounded-[10px]">
        {rows.map((r) => (
          <li key={r.name} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{r.name}</span>
              <span className={`shrink-0 text-sm font-semibold ${STATUS[r.status].className}`}>{STATUS[r.status].text}</span>
            </div>
            <p className="tnum mt-0.5 text-sm text-steel-300">
              הדמיה: {amount(r.modelPieces, r.modelMm)}. כתב כמויות: {amount(r.boqPieces, r.boqMm)}
            </p>
          </li>
        ))}
      </ul>
      {ownCut && (
        <p className="mt-3 text-sm text-steel-300">
          כתב הכמויות כבר כולל פרופילים. השורות מההדמיה נכנסות לקבוצה נפרדת, &quot;{MODEL_GROUP}&quot;. מוחקים את מה שכפול.
        </p>
      )}
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className={`mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
          ownCut ? 'border-steel-500' : 'border-hivis text-hivis'
        }`}
      >
        <Icon name="plus" size={20} />
        {busy ? 'מוסיף...' : fromModel ? `עדכן את "${MODEL_GROUP}" לפי המודל` : 'הוסף את המודל לכתב הכמויות'}
      </button>
      <p className="mt-2 text-sm text-steel-500">פרופילים לפי אורכי חיתוך, פחים ופרזול. עבודה, צביעה והתקנה מוסיפים בנפרד.</p>
    </section>
  );
}
