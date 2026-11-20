/**
 * Building from a sketch: a photo of a hand drawing, a tablet drawing or a PDF goes to Gemini, which reads it into
 * the builder's grid and parts; or Yaal's own AI app reads it (copy the instructions, paste the answer back).
 * Nothing is saved here: the builder opens the reading as a draft to check and correct.
 */
import { useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail } from '../lib/api.ts';
import { blobToBase64, compressImage } from '../lib/image.ts';
import { useFeatures } from '../lib/features.ts';
import { buildDesignPrompt, designFromReply } from '../core/designPrompt.ts';
import { readDesign } from '../core/design.ts';
import type { Design } from '../core/design.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function SketchReader({ job, onRead }: { job: JobDetail; onRead: (design: Design, notes: string[], problems: string[]) => void }) {
  const ai = useFeatures().ai;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; blob: Blob; preview: string | null } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState('');
  const abort = useRef<AbortController | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.type === 'application/pdf') {
        if (f.size > MAX_PDF_BYTES) return toast('ה־PDF גדול מ־10 מגה. אפשר לצלם את הדף במקום.');
        setFile({ name: f.name, blob: f, preview: null });
      } else {
        // Sketch text needs detail: keep up to 2,000 px on the long side
        const blob = await compressImage(f, 2000, 0.85);
        setFile({ name: f.name, blob, preview: URL.createObjectURL(blob) });
      }
    } catch {
      toast('לא הצלחתי לפתוח את הקובץ. אפשר תמונה או PDF.');
    }
  };

  const read = async () => {
    if (!file) return;
    setBusy(true);
    abort.current = new AbortController();
    try {
      const mime = file.blob.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
      const r = await api.sketchModel(job.id, { file: { mime, data: await blobToBase64(file.blob) }, note: note.trim() || undefined }, abort.current.signal);
      const design = readDesign(r.design);
      if (!design) throw new Error('bad_response');
      onRead(design, r.notes, r.problems);
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') toast(errorMessage(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const copyInstructions = () =>
    void navigator.clipboard.writeText(buildDesignPrompt({ job, note })).then(
      () => toast('ההנחיות הועתקו. מדביקים באפליקציה, מצרפים את הסקיצה, ומדביקים כאן את התשובה.'),
      () => toast('לא הצלחתי להעתיק'),
    );

  const loadPasted = (text: string) => {
    try {
      const r = designFromReply(text);
      onRead(r.design, r.notes, r.problems);
    } catch {
      toast('לא מצאתי בתשובה רשת ומידות. מדביקים את כל התשובה.');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[0.9rem] text-muted">צילום של שרטוט ביד, שרטוט מהטאבלט או PDF. המידות שכתובות עליו נכנסות לרשת, ומה שלא נקרא יופיע כהערה.</p>
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {file ? (
        <div className="flex items-center gap-3 rounded-md border border-line p-2">
          {file.preview ? <img src={file.preview} alt="" className="h-16 w-16 rounded object-cover" /> : <Icon name="receipt" size={28} />}
          <span dir="ltr" className="min-w-0 flex-1 truncate text-end text-[0.9rem]">
            {file.name}
          </span>
          <button type="button" onClick={() => input.current?.click()} className="text-[0.9rem] font-semibold text-accent underline underline-offset-4">
            החלף
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="btn-secondary w-full">
          <Icon name="camera" size={20} />
          צילום או קובץ
        </button>
      )}
      <textarea
        className="field min-h-20"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="הערה (לא חובה): מה זה, ומידות שלא כתובות"
        aria-label="הערה לסקיצה"
      />
      {ai && (
        <div className="flex gap-2">
          <button type="button" onClick={() => void read()} disabled={!file || busy} className="btn-primary flex-1 disabled:opacity-50">
            <Icon name="sparkles" />
            {busy ? 'קורא את הסקיצה...' : 'לקרוא את הסקיצה'}
          </button>
          {busy && (
            <button type="button" onClick={() => abort.current?.abort()} className="btn-secondary px-4">
              עצור
            </button>
          )}
        </div>
      )}

      <details className="rounded-md border border-line p-3" open={!ai}>
        <summary className="cursor-pointer font-semibold">
          באפליקציה שלך: <bdi>Gemini</bdi>, <bdi>Claude</bdi> או <bdi>ChatGPT</bdi>
        </summary>
        <div className="mt-3 space-y-2">
          <button type="button" onClick={copyInstructions} className="btn-secondary w-full">
            <Icon name="copy" size={18} />
            העתק הנחיות
          </button>
          <textarea
            className="field min-h-24"
            dir="ltr"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="הדבק כאן את התשובה"
            aria-label="התשובה מהאפליקציה"
          />
          <button type="button" onClick={() => loadPasted(pasted)} disabled={pasted.trim().length < 10} className="btn-secondary w-full disabled:opacity-50">
            לטעון את התשובה
          </button>
        </div>
      </details>
    </div>
  );
}
