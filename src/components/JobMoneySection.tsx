import { useEffect, useState } from 'react';
import { api, errorMessage, receiptUrl } from '../lib/api.ts';
import type { JobDetail, JobMoney } from '../lib/api.ts';
import type { JobStatus } from '../core/types.ts';
import { EXPENSE_CATEGORY_LABELS, PAYMENT_METHOD_LABELS, jobBalance } from '../core/finance.ts';
import { formatIls, round2 } from '../core/money.ts';
import { whatsappLink } from '../core/phone.ts';
import { fmtDate } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';
import { ExpenseForm, PaymentForm } from './MoneyForms.tsx';

/** Money for one job: what the client owes, what came in, what went out. */
export function JobMoneySection({
  job,
  currentTotal,
  vatPct,
  businessName,
  onStatus,
}: {
  job: JobDetail;
  currentTotal: number;
  vatPct: number;
  businessName: string;
  onStatus: (s: JobStatus) => void;
}) {
  const [data, setData] = useState<JobMoney | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<'payment' | 'expense' | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    api
      .jobMoney(job.id)
      .then(setData)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [job.id]);

  if (error) return <p className="mt-4 text-primer-light">{error}</p>;
  if (!data) return <p className="mt-4 text-steel-300">טוען...</p>;

  const approved = data.due != null;
  const due = data.due ?? (currentTotal > 0 ? currentTotal : null);
  const b = jobBalance(due, data.payments);
  const spent = round2(data.expenses.reduce((s, e) => s + e.amount, 0));
  const spentNet = round2(data.expenses.reduce((s, e) => s + e.amount - (e.vat ?? 0), 0));
  const incomeNet = round2(b.paid / (1 + vatPct / 100));
  const reminder =
    b.balance && b.balance > 0
      ? `שלום${job.client_name ? ` ${job.client_name}` : ''}, תזכורת קטנה לגבי "${job.title}": נשארה יתרה של ${formatIls(b.balance)}. תודה! ${businessName}`
      : '';

  const remove = async (kind: 'p' | 'e', id: number) => {
    const key = `${kind}${id}`;
    if (confirmId !== key) return setConfirmId(key);
    try {
      if (kind === 'p') {
        await api.deletePayment(id);
        setData((d) => (d ? { ...d, payments: d.payments.filter((p) => p.id !== id) } : d));
      } else {
        await api.deleteExpense(id);
        setData((d) => (d ? { ...d, expenses: d.expenses.filter((x) => x.id !== id) } : d));
      }
      toast('נמחק');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div className="mt-4 space-y-8">
      <section className="plate rounded-[10px] p-4" aria-label="גבייה">
        <div className="flex items-baseline justify-between">
          <h3 className="text-steel-300">{b.balance !== null && b.balance <= 0.5 ? 'שולם במלואו' : 'נשאר לגבות'}</h3>
          {b.due !== null && <span className="tnum text-sm text-steel-300">מתוך {formatIls(b.due)}</span>}
        </div>
        <p className="tnum mt-1 font-display text-[3.25rem] leading-none text-hivis">
          {formatIls(b.balance !== null ? Math.max(0, b.balance) : 0)}
        </p>
        {b.share !== null && (
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-steel-950" role="img" aria-label={`שולמו ${Math.round(b.share * 100)}%`}>
            <div className="h-full rounded-full bg-hivis" style={{ width: `${b.share * 100}%` }} />
          </div>
        )}
        <p className="mt-2 text-sm text-steel-300">
          {approved
            ? `לפי הצעה ${job.id}-${data.due_version} שהלקוח אישר. התקבל עד עכשיו ${formatIls(b.paid)}.`
            : due
              ? 'עוד אין הצעה מאושרת, אז הסכום לפי המחיר הנוכחי של העבודה.'
              : 'כשיהיה מחיר לעבודה, היתרה תחושב כאן.'}
        </p>

        <button type="button" onClick={() => setAdding('payment')} className="btn-primary mt-4">
          <Icon name="wallet" />
          קיבלתי תשלום
        </button>
        {reminder && job.client_phone && (
          <a
            href={whatsappLink(job.client_phone, reminder)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-steel-500 font-semibold"
          >
            <Icon name="whatsapp" size={20} />
            תזכורת ללקוח על היתרה
          </a>
        )}
        {b.balance !== null && b.balance <= 0.5 && job.status !== 'paid' && (
          <button
            type="button"
            onClick={() => onStatus('paid')}
            className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-hivis font-semibold text-hivis"
          >
            <Icon name="check" size={20} />
            סמן את העבודה כשולמה
          </button>
        )}
      </section>

      <section aria-labelledby="payments-title">
        <h3 id="payments-title" className="font-display text-[2rem] leading-none">
          תשלומים שהתקבלו
        </h3>
        {data.payments.length === 0 ? (
          <p className="mt-2 text-steel-300">עוד לא התקבל תשלום.</p>
        ) : (
          <ul className="plate mt-2 divide-y divide-steel-700 rounded-[10px]">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="tnum block font-semibold">{formatIls(p.amount)}</span>
                  <span className="block text-sm text-steel-300">
                    {[fmtDate(p.paid_at), p.method && PAYMENT_METHOD_LABELS[p.method], p.notes].filter(Boolean).join(', ')}
                  </span>
                </span>
                <DeleteButton armed={confirmId === `p${p.id}`} onClick={() => void remove('p', p.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="job-expenses-title">
        <div className="flex items-center justify-between">
          <h3 id="job-expenses-title" className="font-display text-[2rem] leading-none">
            הוצאות על העבודה
          </h3>
          <button
            type="button"
            onClick={() => setAdding('expense')}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-hivis px-3 font-semibold text-hivis"
          >
            <Icon name="plus" size={20} />
            הוצאה
          </button>
        </div>
        {data.expenses.length === 0 ? (
          <p className="mt-2 text-steel-300">חומרים, צביעה, קבלן משנה. מה שתרשום כאן נכנס גם לדוח החודשי.</p>
        ) : (
          <ul className="plate mt-2 divide-y divide-steel-700 rounded-[10px]">
            {data.expenses.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="tnum block font-semibold">{formatIls(x.amount)}</span>
                  <span className="block text-sm text-steel-300">
                    {[fmtDate(x.spent_at), x.category && EXPENSE_CATEGORY_LABELS[x.category], x.supplier_name, x.notes]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </span>
                {x.receipt_key && (
                  <a href={receiptUrl(x.id)} target="_blank" rel="noreferrer" aria-label="הקבלה" className="grid h-11 w-11 place-items-center text-steel-300">
                    <Icon name="receipt" size={20} />
                  </a>
                )}
                <DeleteButton armed={confirmId === `e${x.id}`} onClick={() => void remove('e', x.id)} />
              </li>
            ))}
          </ul>
        )}
        {(data.expenses.length > 0 || b.paid > 0) && (
          <dl className="tnum mt-3 space-y-1 text-[0.95rem]">
            <div className="flex justify-between text-steel-300">
              <dt>נכנס (לפני מע״מ)</dt>
              <dd>{formatIls(incomeNet)}</dd>
            </div>
            <div className="flex justify-between text-steel-300">
              <dt>יצא על העבודה (לפני מע״מ)</dt>
              <dd>{formatIls(spentNet)}</dd>
            </div>
            <div className="flex justify-between border-t border-steel-700 pt-1 font-semibold">
              <dt>נשאר אצלך עד עכשיו</dt>
              <dd>{formatIls(round2(incomeNet - spentNet))}</dd>
            </div>
            {spent > 0 && <p className="text-sm text-steel-500">סה״כ הוצאות כולל מע״מ: {formatIls(spent)}</p>}
          </dl>
        )}
      </section>

      <Sheet open={adding === 'payment'} onClose={() => setAdding(null)} title="תשלום מהלקוח">
        {adding === 'payment' && (
          <PaymentForm
            jobId={job.id}
            suggested={b.balance}
            onSaved={(p) => {
              setData((d) => (d ? { ...d, payments: [p, ...d.payments] } : d));
              setAdding(null);
              toast('התשלום נרשם');
            }}
          />
        )}
      </Sheet>
      <Sheet open={adding === 'expense'} onClose={() => setAdding(null)} title="הוצאה על העבודה">
        {adding === 'expense' && (
          <ExpenseForm
            jobId={job.id}
            onSaved={(x) => {
              setData((d) => (d ? { ...d, expenses: [x, ...d.expenses] } : d));
              setAdding(null);
              toast('ההוצאה נרשמה');
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

export function DeleteButton({ armed, onClick }: { armed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={armed ? 'לחץ שוב כדי למחוק' : 'מחק'}
      className={`flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-semibold ${
        armed ? 'bg-primer text-soapstone' : 'text-steel-500'
      }`}
    >
      <Icon name="trash" size={18} />
      {armed && 'למחוק?'}
    </button>
  );
}
