import { useEffect, useState } from 'react';
import { api, errorMessage, exportUrl, receiptUrl } from '../lib/api.ts';
import type { FinanceMonth } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { EXPENSE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS, shiftMonth } from '../core/finance.ts';
import { businessToday } from '../core/calendar.ts';
import { formatIls, round2 } from '../core/money.ts';
import { whatsappLink } from '../core/phone.ts';
import { fmtDate, fmtMonth } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { toast } from '../components/Toast.tsx';
import { ExpenseForm } from '../components/MoneyForms.tsx';
import { DeleteButton } from '../components/JobMoneySection.tsx';

type Row =
  | { kind: 'in'; id: number; date: string; amount: number; title: string; sub: string; jobId: number | null }
  | { kind: 'out'; id: number; date: string; amount: number; title: string; sub: string; jobId: number | null; receipt: boolean };

/** The month at a glance: money in, money out, who still owes, and the file for the accountant. */
export function FinancePage() {
  const thisMonth = businessToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ business_name: string } | null>(null);

  useEffect(() => {
    setData(null);
    api
      .finance(month)
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [month]);

  useEffect(() => {
    api.jobs().then(setJobs, () => undefined);
    api.settings().then(setSettings, () => undefined);
  }, []);

  const rows: Row[] = data
    ? [
        ...data.payments.map((p) => ({
          kind: 'in' as const,
          id: p.id,
          date: p.paid_at,
          amount: p.amount,
          title: p.job_title ?? 'תשלום',
          sub: [p.client_name, p.method && PAYMENT_METHOD_LABELS[p.method], p.notes].filter(Boolean).join(', '),
          jobId: p.job_id,
        })),
        ...data.expenses.map((x) => ({
          kind: 'out' as const,
          id: x.id,
          date: x.spent_at,
          amount: x.amount,
          title: x.supplier_name ?? (x.category ? EXPENSE_CATEGORY_LABELS[x.category] : 'הוצאה'),
          sub: [x.category && EXPENSE_CATEGORY_LABELS[x.category], x.job_title ?? 'כללי', x.notes].filter(Boolean).join(', '),
          jobId: x.job_id,
          receipt: Boolean(x.receipt_key),
        })),
      ].sort((a, b) => b.date.localeCompare(a.date))
    : [];

  const remove = async (row: Row) => {
    const key = `${row.kind}${row.id}`;
    if (armed !== key) return setArmed(key);
    try {
      if (row.kind === 'in') await api.deletePayment(row.id);
      else await api.deleteExpense(row.id);
      setData(await api.finance(month));
      toast('נמחק');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setArmed(null);
    }
  };

  const net = data ? round2(data.totals.income - data.totals.expenses) : 0;

  return (
    <div>
      <h1 className="font-display text-[3rem] leading-none">כספים</h1>

      <div className="mt-3 flex items-center justify-between rounded-[10px] border border-steel-700">
        <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="חודש קודם" className="grid h-12 w-12 place-items-center">
          <Icon name="back" size={22} />
        </button>
        <span className="text-lg font-semibold">{fmtMonth(month)}</span>
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= thisMonth}
          aria-label="חודש הבא"
          className="grid h-12 w-12 place-items-center disabled:opacity-30"
        >
          <Icon name="forward" size={22} />
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
          {error}
        </p>
      )}

      <section className="plate mt-4 rounded-[10px] p-4" aria-label="סיכום החודש">
        <dl className="tnum grid grid-cols-2 gap-3">
          <div>
            <dt className="text-sm text-steel-300">נכנס</dt>
            <dd className="font-display text-[2.4rem] leading-none text-heat-7">{data ? formatIls(data.totals.income) : '…'}</dd>
          </div>
          <div>
            <dt className="text-sm text-steel-300">יצא</dt>
            <dd className="font-display text-[2.4rem] leading-none text-primer-light">{data ? formatIls(data.totals.expenses) : '…'}</dd>
          </div>
        </dl>
        {data && (
          <p className="tnum mt-3 border-t border-steel-700 pt-2 text-steel-300">
            ההפרש החודש: <span className="font-semibold text-soapstone">{formatIls(net)}</span>
            {data.totals.expensesVat > 0 && <span className="block text-sm">מע״מ בהוצאות: {formatIls(data.totals.expensesVat)}</span>}
          </p>
        )}
      </section>

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={() => setAdding(true)} className="btn-primary">
          <Icon name="receipt" />
          רשום הוצאה
        </button>
        <a
          href={exportUrl(month)}
          download
          className="flex min-h-14 items-center gap-2 rounded-xl border border-steel-500 px-4 font-semibold"
          aria-label={`ייצוא ${fmtMonth(month)} לקובץ לרואה החשבון`}
        >
          <Icon name="download" size={20} />
          לרו״ח
        </a>
      </div>

      {data && data.open.length > 0 && (
        <section className="mt-8" aria-labelledby="open-title">
          <h2 id="open-title" className="font-display text-[2rem] leading-none">
            עוד לא שילמו
          </h2>
          <p className="text-sm text-steel-300">עבודות שהלקוח אישר ונשארה בהן יתרה.</p>
          <ul className="plate mt-2 divide-y divide-steel-700 rounded-[10px]">
            {data.open.map((j) => (
              <li key={j.id} className="flex items-center gap-2 pe-2">
                <a href={`#/jobs/${j.id}/money`} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{j.title}</span>
                    <span className="block truncate text-sm text-steel-300">
                      {j.client_name ?? 'בלי לקוח'}, שולם {formatIls(j.paid)} מתוך {formatIls(j.due)}
                    </span>
                  </span>
                  <span className="tnum shrink-0 font-semibold text-hivis">{formatIls(j.balance)}</span>
                </a>
                {j.client_phone && (
                  <a
                    href={whatsappLink(
                      j.client_phone,
                      `שלום${j.client_name ? ` ${j.client_name}` : ''}, תזכורת קטנה לגבי "${j.title}": נשארה יתרה של ${formatIls(j.balance)}. תודה! ${settings?.business_name ?? ''}`.trim(),
                    )}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="תזכורת בוואטסאפ"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-steel-300"
                  >
                    <Icon name="whatsapp" size={20} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="moves-title">
        <h2 id="moves-title" className="font-display text-[2rem] leading-none">
          תנועות בחודש
        </h2>
        {data && rows.length === 0 && (
          <p className="mt-2 text-steel-300">אין תנועות. תשלומים נרשמים מתוך העבודה, בלשונית כספים. הוצאות נרשמות כאן או בעבודה.</p>
        )}
        {rows.length > 0 && (
          <ul className="plate mt-2 divide-y divide-steel-700 rounded-[10px]">
            {rows.map((r) => (
              <li key={`${r.kind}${r.id}`} className="flex items-center gap-2 pe-2">
                <a href={r.jobId ? `#/jobs/${r.jobId}/money` : undefined} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 ps-4">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block truncate text-sm text-steel-300">
                      {fmtDate(r.date)}
                      {r.sub ? `, ${r.sub}` : ''}
                    </span>
                  </span>
                  <span className={`tnum shrink-0 font-semibold ${r.kind === 'in' ? 'text-heat-7' : 'text-primer-light'}`} dir="ltr">
                    {r.kind === 'in' ? '+' : '−'}
                    {formatIls(r.amount).replace(/\u200f/g, '')}
                    <span className="sr-only">{r.kind === 'in' ? ' הכנסה' : ' הוצאה'}</span>
                  </span>
                </a>
                {r.kind === 'out' && r.receipt && (
                  <a href={receiptUrl(r.id)} target="_blank" rel="noreferrer" aria-label="הקבלה" className="grid h-11 w-11 shrink-0 place-items-center text-steel-300">
                    <Icon name="receipt" size={20} />
                  </a>
                )}
                <DeleteButton armed={armed === `${r.kind}${r.id}`} onClick={() => void remove(r)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={adding} onClose={() => setAdding(false)} title="הוצאה חדשה">
        {adding && (
          <ExpenseForm
            jobId={null}
            jobs={jobs}
            onSaved={(x) => {
              setAdding(false);
              toast('ההוצאה נרשמה');
              if (x.spent_at.slice(0, 7) === month) void api.finance(month).then(setData);
              else setMonth(x.spent_at.slice(0, 7));
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
