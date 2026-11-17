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
    <div className="min-h-dvh bg-steel-900">
      <header className="bg-steel-950">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-5 py-4">
          <img src="/icons/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
          <div>
            <h1 className="font-display text-[2.4rem] leading-none">גץ ועפר</h1>
            <p className="text-sm text-steel-300">הצעת מחיר</p>
          </div>
        </div>
        <div className="weld-bead" aria-hidden="true" />
      </header>
      <main className="mx-auto max-w-xl p-5">
        {state === 'loading' && <p className="text-steel-300">טוען...</p>}
        {state === 'missing' && (
          <p className="plate rounded-[10px] p-4">ההצעה לא נמצאה או שפג תוקפה. אפשר לבקש קישור חדש.</p>
        )}
        {state === 'ok' && quote && (
          <div className="plate rounded-[10px] p-5">
            <p className="text-steel-300">סה״כ לתשלום</p>
            <p className="tnum font-display text-[3.5rem] leading-none text-hivis">
              {quote.total != null ? formatIls(quote.total) : '—'}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
