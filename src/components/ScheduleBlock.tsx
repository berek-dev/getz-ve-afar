import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage, icsUrl } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { addDays, businessToday, googleCalendarUrl } from '../core/calendar.ts';
import { whatsappLink } from '../core/phone.ts';
import { fmtHours, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';

export type DateKind = 'visit' | 'work';

const QUICK_HOURS = [2, 4, 8, 16];
const LABEL: Record<DateKind, string> = { visit: 'ביקור ומדידה', work: 'מועד העבודה' };

/**
 * One of the job's dates – the measuring visit or the work – with links to the phone's calendar,
 * Waze, and a WhatsApp confirmation for the client.
 */
export function DateBlock({
  job,
  kind,
  businessName,
  onChange,
}: {
  job: Job;
  kind: DateKind;
  businessName: string;
  onChange: (j: Job) => void;
}) {
  const [open, setOpen] = useState(false);
  const at = kind === 'visit' ? job.visit_at : job.scheduled_at;
  const hours = kind === 'visit' ? 1 : (job.scheduled_hours ?? 8);

  if (!at) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className="btn-primary">
          <Icon name="calendar" />
          {kind === 'visit' ? 'לקבוע ביקור' : 'לקבוע מועד'}
        </button>
        <DateSheet open={open} job={job} kind={kind} onClose={() => setOpen(false)} onSaved={onChange} />
      </>
    );
  }

  const title = kind === 'visit' ? `ביקור ומדידה: ${job.title}` : job.title;
  const details = [job.client_name && `לקוח: ${job.client_name}${job.client_phone ? `, ${job.client_phone}` : ''}`, `${window.location.origin}/#/jobs/${job.id}`]
    .filter(Boolean)
    .join('\n');
  const confirmText = `שלום${job.client_name ? ` ${job.client_name}` : ''}, ${kind === 'visit' ? 'אגיע למדידה' : 'נקבע'} ${fmtSlotDay(at)} בשעה ${fmtSlotTime(at)}${
    job.site_address ? ` ב${job.site_address}` : ''
  }. אם משהו משתנה, תעדכנו אותי. ${businessName}`;

  return (
    <div className="plate rounded-md">
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 p-4 text-start active:bg-sunken">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-line text-accent">
          <Icon name="calendar" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.85rem] text-muted">{LABEL[kind]}</span>
          <span className="tnum block text-[1.05rem] font-semibold">
            {fmtSlotDay(at)}, {fmtSlotTime(at)}
            {kind === 'work' && job.scheduled_hours ? <span className="font-normal text-muted">, {fmtHours(job.scheduled_hours)}</span> : null}
          </span>
        </span>
        <span className="text-[0.85rem] font-semibold text-accent">שינוי</span>
      </button>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <a href={googleCalendarUrl({ start: at, hours }, { title, location: job.site_address, details })} target="_blank" rel="noreferrer" className="btn-secondary text-[0.9rem]">
          <Icon name="calendar" size={18} />
          ליומן Google
        </a>
        <a href={icsUrl(job.id, kind)} className="btn-secondary text-[0.9rem]">
          <Icon name="download" size={18} />
          ליומן אחר
        </a>
        {job.site_address && (
          <a href={`https://waze.com/ul?q=${encodeURIComponent(job.site_address)}&navigate=yes`} target="_blank" rel="noreferrer" className="btn-secondary text-[0.9rem]">
            <Icon name="navigate" size={18} />
            ניווט
          </a>
        )}
        {job.client_phone && (
          <a href={whatsappLink(job.client_phone, confirmText)} target="_blank" rel="noreferrer" className="btn-secondary text-[0.9rem]">
            <Icon name="whatsapp" size={18} />
            אישור ללקוח
          </a>
        )}
      </div>
      <DateSheet open={open} job={job} kind={kind} onClose={() => setOpen(false)} onSaved={onChange} />
    </div>
  );
}

function DateSheet({ open, job, kind, onClose, onSaved }: { open: boolean; job: Job; kind: DateKind; onClose: () => void; onSaved: (j: Job) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={LABEL[kind]}>
      {open && (
        <DateForm
          job={job}
          kind={kind}
          onDone={(j) => {
            onSaved(j);
            onClose();
          }}
        />
      )}
    </Sheet>
  );
}

function DateForm({ job, kind, onDone }: { job: Job; kind: DateKind; onDone: (j: Job) => void }) {
  const current = kind === 'visit' ? job.visit_at : job.scheduled_at;
  const [date, setDate] = useState(current?.slice(0, 10) ?? addDays(businessToday(), 1));
  const [time, setTime] = useState(current?.slice(11, 16) ?? (kind === 'visit' ? '08:00' : '07:00'));
  const [hours, setHours] = useState(String(job.scheduled_hours ?? 8));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!date || !time) return setError('בחר תאריך ושעה.');
    setBusy(true);
    setError(null);
    try {
      const h = Number(hours);
      const j = await api.schedule(job.id, kind, `${date}T${time}`, kind === 'work' && Number.isFinite(h) && h > 0 ? h : null);
      toast(kind === 'visit' ? 'הביקור נקבע' : 'המועד נשמר');
      onDone(j);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const j = await api.schedule(job.id, kind, null, null);
      toast('המועד הוסר');
      onDone(j);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block font-semibold">תאריך</span>
          <input className="field tnum" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-semibold">שעה</span>
          <input className="field tnum" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>
      {kind === 'work' && (
        <fieldset>
          <legend className="mb-1.5 font-semibold">כמה זמן</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(String(h))}
                aria-pressed={Number(hours) === h}
                className={`min-h-11 rounded-md border px-3 font-semibold ${Number(hours) === h ? 'border-ink bg-ink text-white' : 'border-line-strong bg-card'}`}
              >
                {h === 8 ? 'יום עבודה' : h === 16 ? 'יומיים' : fmtHours(h)}
              </button>
            ))}
            <label className="flex items-center gap-2">
              <input
                className="field tnum w-24"
                type="number"
                inputMode="decimal"
                min="0.5"
                max="240"
                step="0.5"
                dir="ltr"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-label="שעות"
              />
              <span className="text-muted">שעות</span>
            </label>
          </div>
        </fieldset>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        <Icon name="check" />
        {busy ? 'שומר...' : 'שמור'}
      </button>
      {current && (
        <button type="button" onClick={clear} disabled={busy} className="min-h-11 w-full text-danger underline underline-offset-4">
          הסר את המועד
        </button>
      )}
    </form>
  );
}
