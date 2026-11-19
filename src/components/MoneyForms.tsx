import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { ExpenseDraft } from '../lib/api.ts';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../core/finance.ts';
import type { Expense, ExpenseCategory, Payment, PaymentMethod } from '../core/finance.ts';
import type { Job, Supplier } from '../core/types.ts';
import { businessToday } from '../core/calendar.ts';
import { compressImage } from '../lib/image.ts';
import { useFeatures } from '../lib/features.ts';
import { Icon } from './Icon.tsx';

function Chips<T extends string>({
  options,
  labels,
  value,
  onChange,
  legend,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={`min-h-11 rounded-lg border px-3 font-semibold ${
              value === o ? 'border-accent bg-accent text-white' : 'border-line-strong'
            }`}
          >
            {labels[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function AmountField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-semibold">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-lg text-muted">₪</span>
        <input
          className="field tnum ps-9 text-left text-xl font-semibold"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </span>
    </label>
  );
}

export function PaymentForm({ jobId, suggested, onSaved }: { jobId: number; suggested: number | null; onSaved: (p: Payment) => void }) {
  const [amount, setAmount] = useState(suggested && suggested > 0 ? String(Math.round(suggested * 100) / 100) : '');
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [date, setDate] = useState(businessToday());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError('כתוב סכום.');
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.addPayment(jobId, { amount: n, method, paid_at: date, notes }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <AmountField label="כמה התקבל" value={amount} onChange={setAmount} />
      <Chips legend="איך שולם" options={PAYMENT_METHODS} labels={PAYMENT_METHOD_LABELS} value={method} onChange={setMethod} />
      <label className="block">
        <span className="mb-1.5 block font-semibold">תאריך</span>
        <input className="field tnum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1.5 block font-semibold">הערה</span>
        <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: מקדמה, מספר צ׳ק" />
      </label>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        <Icon name="check" />
        {busy ? 'שומר...' : 'שמור תשלום'}
      </button>
    </form>
  );
}

export function ExpenseForm({
  jobId,
  jobs,
  onSaved,
}: {
  /** Fixed job (from the job screen); otherwise the user may pick one */
  jobId: number | null;
  jobs?: Job[];
  onSaved: (e: Expense) => void;
}) {
  const features = useFeatures();
  const [amount, setAmount] = useState('');
  const [hasVat, setHasVat] = useState(true);
  const [category, setCategory] = useState<ExpenseCategory>('materials');
  const [supplier, setSupplier] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [job, setJob] = useState<string>(jobId ? String(jobId) : '');
  const [date, setDate] = useState(businessToday());
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.suppliers().then(setSuppliers, () => undefined);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError('כתוב סכום.');
    setBusy(true);
    setError(null);
    try {
      const known = suppliers.find((s) => s.name === supplier.trim());
      const draft: ExpenseDraft = {
        amount: n,
        has_vat: hasVat,
        category,
        spent_at: date,
        job_id: job ? Number(job) : null,
        supplier_id: known?.id ?? null,
        supplier_name: known ? undefined : supplier.trim() || undefined,
        notes,
      };
      let saved = await api.addExpense(draft);
      if (receipt) {
        try {
          saved = await api.uploadReceipt(saved.id, await compressImage(receipt, 2000, 0.85));
        } catch (err) {
          setError(`ההוצאה נשמרה, אבל הקבלה לא עלתה: ${errorMessage(err)}`);
        }
      }
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const openJobs = (jobs ?? []).filter((j) => j.status !== 'lost');

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <AmountField label="סכום בקבלה" value={amount} onChange={setAmount} />
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={hasVat} onChange={(e) => setHasVat(e.target.checked)} className="h-6 w-6 accent-accent" />
        <span>
          הסכום כולל מע״מ <span className="text-sm text-muted">(בטל אם הספק עוסק פטור)</span>
        </span>
      </label>
      <Chips legend="על מה" options={EXPENSE_CATEGORIES} labels={EXPENSE_CATEGORY_LABELS} value={category} onChange={setCategory} />
      <label className="block">
        <span className="mb-1.5 block font-semibold">ספק</span>
        <input
          className="field"
          list="expense-suppliers"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="ממי קנית"
          autoComplete="off"
        />
        <datalist id="expense-suppliers">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
      </label>
      {jobId === null && (
        <label className="block">
          <span className="mb-1.5 block font-semibold">שייך לעבודה</span>
          <select className="field" value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">הוצאה כללית של העסק</option>
            {openJobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block font-semibold">תאריך</span>
        <input className="field tnum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {features.photos && (
        <div>
          <input
            id="receipt-input"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor="receipt-input"
            className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line-strong font-semibold"
          >
            <Icon name="receipt" size={20} />
            {receipt ? 'הקבלה צורפה. להחלפה לחץ שוב' : 'צלם את הקבלה'}
          </label>
        </div>
      )}
      <label className="block">
        <span className="mb-1.5 block font-semibold">הערה</span>
        <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        <Icon name="check" />
        {busy ? 'שומר...' : 'שמור הוצאה'}
      </button>
    </form>
  );
}
