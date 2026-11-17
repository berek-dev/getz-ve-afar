import { useEffect, useState } from 'react';
import { formatIls } from '../core/money.ts';

interface PublicQuote {
  status: string;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  valid_until: string | null;
  approved_at: string | null;
}

/** The page the client opens from WhatsApp. Public: no login. Fully built in M3. */
export function QuotePublicPage({ token }: { token: string }) {
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    fetch(`/api/public/quotes/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setQuote((await res.json()) as PublicQuote);
        setState('ok');
      })
      .catch(() => setState('missing'));
  }, [token]);

  return (
    <div className="mx-auto max-w-xl p-6">
      <header className="mb-6 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
        <div>
          <h1 className="text-2xl font-extrabold">גץ ועפר</h1>
          <p className="text-sm text-stone-500">הצעת מחיר</p>
        </div>
      </header>
      {state === 'loading' && <p className="text-stone-500">טוען...</p>}
      {state === 'missing' && <p className="rounded-xl bg-white p-4">ההצעה לא נמצאה או שפג תוקפה.</p>}
      {state === 'ok' && quote && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-stone-500">סה״כ לתשלום</p>
          <p className="text-4xl font-extrabold">{quote.total != null ? formatIls(quote.total) : '—'}</p>
        </div>
      )}
    </div>
  );
}
