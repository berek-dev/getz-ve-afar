import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api } from '../lib/api.ts';
import type { PublicQuote } from '../lib/api.ts';
import { formatIls } from '../core/money.ts';
import { fmtDate, fmtNum } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';

/** The page the client opens from WhatsApp. Public: no login. Prints as a clean document. */
export function QuotePublicPage({ token }: { token: string }) {
  const [data, setData] = useState<PublicQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    api
      .publicQuote(token)
      .then((q) => {
        setData(q);
        setState('ok');
        document.title = `הצעת מחיר ${q.number} – ${q.quote.business.name}`;
      })
      .catch(() => setState('missing'));
  }, [token]);

  const q = data?.quote;

  return (
    <div className="print-doc min-h-dvh bg-steel-900">
      <header className="bg-steel-950">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
            <span className="font-display text-[2.6rem] leading-none">{q?.business.name ?? 'גץ ועפר'}</span>
          </div>
          {q?.business.phone && (
            <a href={`tel:${q.business.phone}`} className="tnum text-steel-300" dir="ltr">
              {q.business.phone}
            </a>
          )}
        </div>
        <div className="weld-bead" aria-hidden="true" />
      </header>

      <main className="mx-auto max-w-2xl px-5 py-6">
        {state === 'loading' && <p className="text-steel-300">טוען את ההצעה...</p>}
        {state === 'missing' && (
          <p className="plate rounded-[10px] p-4">
            ההצעה לא נמצאה. ייתכן שהקישור לא הועתק עד הסוף. אפשר לבקש קישור חדש.
          </p>
        )}

        {state === 'ok' && data && q && (
          <>
            <StatusBanner data={data} />

            <h1 className="font-display text-[3rem] leading-none">הצעת מחיר</h1>
            <p className="tnum mt-1 text-steel-300">
              מספר {data.number}, מתאריך {fmtDate(data.created_at)}
              {data.valid_until && `, בתוקף עד ${fmtDate(data.valid_until)}`}
            </p>

            {(q.job.client_name || q.job.site_address) && (
              <p className="mt-4">
                <span className="text-steel-300">עבור </span>
                <span className="font-semibold">{[q.job.client_name, q.job.site_address].filter(Boolean).join(', ')}</span>
              </p>
            )}

            <section className="plate mt-5 rounded-[10px] p-5">
              <h2 className="text-xl font-semibold">{q.job.title}</h2>
              {q.job.description && <p className="mt-2 whitespace-pre-line leading-relaxed text-steel-300">{q.job.description}</p>}
            </section>

            <section className="mt-6" aria-labelledby="scope-title">
              <h2 id="scope-title" className="text-lg font-semibold">
                מה כלול בעבודה
              </h2>
              <div className="mt-2 space-y-4">
                {q.scope.map((g) => (
                  <div key={g.group}>
                    <h3 className="mb-1 text-sm font-semibold text-steel-300">{g.group}</h3>
                    <ul className="divide-y divide-steel-700 rounded-[10px] border border-steel-700">
                      {g.lines.map((l, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                          <span>{l.text}</span>
                          {l.detail && <span className="tnum shrink-0 text-sm text-steel-300">{l.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section className="plate mt-6 rounded-[10px] p-5" aria-label="מחיר">
              <dl className="tnum space-y-1.5">
                <div className="flex justify-between">
                  <dt className="text-steel-300">לפני מע״מ</dt>
                  <dd>{formatIls(q.totals.beforeVat)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-steel-300">מע״מ ({fmtNum(q.totals.vatPct)}%)</dt>
                  <dd>{formatIls(q.totals.vat)}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-baseline justify-between border-t border-steel-700 pt-3">
                <span className="text-lg font-semibold">סה״כ לתשלום</span>
                <span className="tnum font-display text-[3rem] leading-none text-hivis">{formatIls(q.totals.total)}</span>
              </div>
            </section>

            {q.terms && (
              <section className="mt-6">
                <h2 className="font-semibold">תנאים</h2>
                <p className="mt-1 whitespace-pre-line leading-relaxed text-steel-300">{q.terms}</p>
              </section>
            )}

            {data.status === 'sent' && <ApproveForm token={token} onApproved={(a) => setData({ ...data, ...a, status: 'approved' })} />}

            <button
              type="button"
              onClick={() => window.print()}
              className="no-print mx-auto mt-8 flex min-h-11 items-center gap-2 px-4 text-steel-300 underline underline-offset-4"
            >
              <Icon name="printer" size={20} />
              שמירה כ־PDF או הדפסה
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function StatusBanner({ data }: { data: PublicQuote }) {
  if (data.status === 'approved') {
    return (
      <p className="mb-6 flex items-center gap-2 rounded-[10px] border border-heat-6 bg-heat-6/15 p-4 font-semibold" role="status">
        <Icon name="check" size={22} />
        ההצעה אושרה על ידי {data.approved_name}, {fmtDate(data.approved_at)}. תודה!
      </p>
    );
  }
  if (data.status === 'expired') {
    return (
      <p className="mb-6 rounded-[10px] border border-primer bg-primer/15 p-4 text-primer-light" role="status">
        ההצעה הזו כבר לא בתוקף, או שהוחלפה בהצעה מעודכנת. אפשר לבקש את ההצעה העדכנית.
      </p>
    );
  }
  return null;
}

function ApproveForm({
  token,
  onApproved,
}: {
  token: string;
  onApproved: (a: { approved_at: string; approved_name: string }) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError('כתוב את שמך המלא כדי לאשר.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.approveQuote(token, name.trim());
      onApproved(r);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'אי אפשר לאשר את ההצעה הזו כי היא כבר לא בתוקף. בקש הצעה מעודכנת.'
          : 'האישור לא נשלח. בדוק חיבור ונסה שוב.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="no-print plate mt-8 rounded-[10px] p-5">
      <h2 className="text-lg font-semibold">מאשרים את ההצעה?</h2>
      <p className="mt-1 text-steel-300">כתבו את השם שלכם ולחצו על אישור. נחזור אליכם לתיאום מועד.</p>
      <label className="mt-4 block">
        <span className="mb-1.5 block font-semibold">שם מלא</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      {error && (
        <p className="mt-2 text-primer-light" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary mt-4">
        <Icon name="check" />
        {busy ? 'שולח...' : 'אני מאשר/ת את ההצעה'}
      </button>
    </form>
  );
}
