import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail } from '../lib/api.ts';
import type { QuoteSummary } from '../core/types.ts';
import { formatIls } from '../core/money.ts';
import { whatsappLink } from '../core/phone.ts';
import { fmtDate, fmtDateTime } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

const STATUS_TEXT: Record<QuoteSummary['status'], string> = {
  sent: 'נשלחה, מחכה לאישור הלקוח',
  approved: 'הלקוח אישר',
  expired: 'לא בתוקף',
  rejected: 'נדחתה',
  draft: 'טיוטה',
};

export function QuoteSection({
  job,
  currentTotal,
  businessName,
  onJobStatusMaybeChanged,
}: {
  job: JobDetail;
  currentTotal: number;
  businessName: string;
  onJobStatusMaybeChanged: () => void;
}) {
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasModel = (job.model_versions ?? 0) > 0;
  const [withModel, setWithModel] = useState(true);

  useEffect(() => {
    api
      .quotes(job.id)
      .then(setQuotes)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [job.id]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const q = await api.createQuote(job.id, hasModel && withModel);
      setQuotes((prev) => [q, ...(prev ?? []).map((p) => (p.status === 'sent' ? { ...p, status: 'expired' as const } : p))]);
      toast('ההצעה מוכנה לשליחה');
      onJobStatusMaybeChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const latest = quotes?.[0];
  const older = quotes?.slice(1) ?? [];
  const url = latest ? `${window.location.origin}/q/${latest.token}` : '';
  const message = `שלום${job.client_name ? ` ${job.client_name}` : ''}, זו הצעת המחיר של ${businessName} עבור "${job.title}". אפשר לעבור עליה ולאשר כאן:\n${url}`;
  const outdated = latest && latest.total != null && Math.abs(latest.total - currentTotal) > 0.5;

  const modelToggle = hasModel && (!latest || latest.status !== 'approved') && (
    <label className="mt-3 flex min-h-11 items-center gap-3">
      <input type="checkbox" className="h-6 w-6 accent-hivis" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} />
      <span>
        לצרף את ההדמיה בתלת־ממד
        <span className="block text-sm text-steel-300">הלקוח יוכל לסובב את המודל ולפתוח את השער.</span>
      </span>
    </label>
  );

  return (
    <section className="mt-8" aria-labelledby="quote-title">
      <h2 id="quote-title" className="font-display text-[2.2rem] leading-none">
        הצעת מחיר ללקוח
      </h2>

      {quotes === null && !error && <p className="mt-3 text-steel-300">טוען...</p>}

      {quotes !== null && !latest && (
        <div className="mt-3">
          <p className="text-steel-300">
            הלקוח מקבל לינק עם מה שכלול בעבודה והמחיר הסופי, בלי העלויות שלך. הוא יכול לאשר בלחיצה, וזה מסמן את העבודה
            כמאושרת.
          </p>
          {modelToggle}
          <button type="button" onClick={create} disabled={busy || job.items.length === 0} className="btn-primary mt-4">
            <Icon name="link" />
            {busy ? 'מכין...' : 'הכן הצעה לשליחה'}
          </button>
          {job.items.length === 0 && <p className="mt-2 text-sm text-steel-500">קודם מוסיפים שורות לכתב הכמויות.</p>}
        </div>
      )}

      {latest && (
        <div className="plate mt-3 rounded-[10px] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">
              הצעה {job.id}-{latest.version}
            </p>
            <p className="tnum font-semibold">{formatIls(latest.total ?? 0)}</p>
          </div>
          <p className={`mt-1 flex items-center gap-1.5 ${latest.status === 'approved' ? 'text-heat-7' : 'text-steel-300'}`}>
            {latest.status === 'approved' && <Icon name="check" size={18} />}
            {latest.status === 'approved'
              ? `${latest.approved_name} אישר/ה, ${fmtDateTime(latest.approved_at)}`
              : `${STATUS_TEXT[latest.status]}. נוצרה ${fmtDate(latest.created_at)}`}
          </p>

          {outdated && latest.status !== 'approved' && (
            <p className="mt-3 rounded-lg border border-hivis/60 p-2.5 text-sm">
              המחיר בעבודה השתנה מאז ({formatIls(currentTotal)}). הכן גרסה חדשה כדי שהלקוח יראה את המחיר המעודכן.
            </p>
          )}

          {latest.status === 'sent' && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={whatsappLink(job.client_phone, message)}
                target="_blank"
                rel="noreferrer"
                className="btn-primary col-span-2"
              >
                <Icon name="whatsapp" />
                שלח ללקוח בוואטסאפ
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => toast('הלינק הועתק'))
                    .catch(() => toast(url));
                }}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-steel-500 font-semibold"
              >
                <Icon name="copy" size={20} />
                העתק לינק
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-steel-500 font-semibold"
              >
                <Icon name="eye" size={20} />
                כמו שהלקוח רואה
              </a>
            </div>
          )}

          {modelToggle}
          {latest.status !== 'approved' && (
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="mt-3 min-h-11 w-full rounded-xl text-steel-300 underline underline-offset-4"
            >
              {busy ? 'מכין...' : 'הכן גרסה חדשה מהמחיר הנוכחי'}
            </button>
          )}
          {latest.status === 'approved' && (
            <a href={url} target="_blank" rel="noreferrer" className="mt-3 block text-steel-300 underline underline-offset-4">
              צפייה בהצעה המאושרת
            </a>
          )}
        </div>
      )}

      {older.length > 0 && (
        <details className="mt-3 text-sm text-steel-300">
          <summary className="min-h-11 cursor-pointer py-2">גרסאות קודמות ({older.length})</summary>
          <ul className="space-y-1">
            {older.map((q) => (
              <li key={q.id} className="tnum flex justify-between">
                <span>
                  גרסה {q.version}, {fmtDate(q.created_at)}, {STATUS_TEXT[q.status]}
                </span>
                <span>{formatIls(q.total ?? 0)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <p className="mt-3 text-primer-light" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
