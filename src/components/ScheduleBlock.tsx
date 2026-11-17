import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage, icsUrl } from '../lib/api.ts';
import type { JobDetail } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { addDays, businessToday, googleCalendarUrl } from '../core/calendar.ts';
import { whatsappLink } from '../core/phone.ts';
import { fmtHours, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';

const QUICK_HOURS = [1, 2, 4, 8];

export function slotLabel(job: Pick<Job, 'status'>): string {
  return job.status === 'lead' || job.status === 'visit' ? 'ביקור מדידה' : 'מועד העבודה';
}

/** The job's date: shown under the stage bar, opens a sheet to set it, links to the phone's calendar. */
export function ScheduleBlock({
  job,
  businessName,
  onChange,
}: {
  job: JobDetail;
  businessName: string;
  onChange: (j: Job) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = slotLabel(job);
  const closed = job.status === 'done' || job.status === 'paid' || job.status === 'lost';

  if (!job.scheduled_at) {
    if (closed) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 flex min-h-12 w-full items-center gap-2 rounded-[10px] border border-dashed border-steel-500 px-4 font-semibold text-steel-300"
        >
          <Icon name="calendar" size={20} />
          קבע {label === 'ביקור מדידה' ? 'ביקור מדידה' : 'מועד לעבודה'}
        </button>
        <ScheduleSheet open={open} job={job} onClose={() => setOpen(false)} onSaved={onChange} />
      </>
    );
  }

  const slot = { start: job.scheduled_at, hours: job.scheduled_hours ?? 2 };
  const details = [job.client_name && `לקוח: ${job.client_name}${job.client_phone ? `, ${job.client_phone}` : ''}`, `${window.location.origin}/#/jobs/${job.id}`]
    .filter(Boolean)
    .join('\n');
  const confirmText = `שלום${job.client_name ? ` ${job.client_name}` : ''}, נקבע ${fmtSlotDay(job.scheduled_at)} בשעה ${fmtSlotTime(job.scheduled_at)}${
    job.site_address ? ` ב${job.site_address}` : ''
  }. אם משהו משתנה, תעדכנו אותי. ${businessName}`;

  return (
    <div className="mt-4 rounded-[10px] border border-steel-700 p-3">
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-start">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-steel-800 text-hivis">
          <Icon name="calendar" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-steel-300">{label}</span>
          <span className="tnum block font-semibold">
            {fmtSlotDay(job.scheduled_at)}, {fmtSlotTime(job.scheduled_at)}
            {job.scheduled_hours ? <span className="font-normal text-steel-300">, {fmtHours(job.scheduled_hours)}</span> : null}
          </span>
        </span>
        <Icon name="pencil" size={18} className="shrink-0 text-steel-500" />
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={googleCalendarUrl(slot, { title: job.title, location: job.site_address, details })}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold"
        >
          <Icon name="calendar" size={18} />
          ליומן Google
        </a>
        <a href={icsUrl(job.id)} className="flex min-h-11 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold">
          <Icon name="download" size={18} />
          ליומן אחר
        </a>
        {job.site_address && (
          <a
            href={`https://waze.com/ul?q=${encodeURIComponent(job.site_address)}&navigate=yes`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold"
          >
            <Icon name="navigate" size={18} />
            ניווט
          </a>
        )}
        {job.client_phone && (
          <a
            href={whatsappLink(job.client_phone, confirmText)}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold"
          >
            <Icon name="whatsapp" size={18} />
            אישור ללקוח
          </a>
        )}
      </div>
      <ScheduleSheet open={open} job={job} onClose={() => setOpen(false)} onSaved={onChange} />
    </div>
  );
}

function ScheduleSheet({ open, job, onClose, onSaved }: { open: boolean; job: JobDetail; onClose: () => void; onSaved: (j: Job) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={slotLabel(job)}>
      {open && <ScheduleForm job={job} onDone={(j) => { onSaved(j); onClose(); }} />}
    </Sheet>
  );
}

function ScheduleForm({ job, onDone }: { job: JobDetail; onDone: (j: Job) => void }) {
  const [date, setDate] = useState(job.scheduled_at?.slice(0, 10) ?? addDays(businessToday(), 1));
  const [time, setTime] = useState(job.scheduled_at?.slice(11, 16) ?? '08:00');
  const [hours, setHours] = useState(String(job.scheduled_hours ?? (job.status === 'lead' || job.status === 'visit' ? 1 : 8)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!date || !time) return setError('בחר תאריך ושעה.');
    setBusy(true);
    setError(null);
    try {
      const h = Number(hours);
      const j = await api.schedule(job.id, `${date}T${time}`, Number.isFinite(h) && h > 0 ? h : null);
      toast('המועד נשמר');
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
      const j = await api.schedule(job.id, null, null);
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
      <fieldset>
        <legend className="mb-1.5 font-semibold">כמה זמן</legend>
        <div className="flex flex-wrap gap-2">
          {QUICK_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(String(h))}
              aria-pressed={Number(hours) === h}
              className={`min-h-11 rounded-lg border px-3 font-semibold ${
                Number(hours) === h ? 'border-hivis bg-hivis text-steel-950' : 'border-steel-500'
              }`}
            >
              {h === 8 ? 'יום עבודה' : fmtHours(h)}
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
            <span className="text-steel-300">שעות</span>
          </label>
        </div>
      </fieldset>
      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn-primary">
        <Icon name="check" />
        {busy ? 'שומר...' : 'שמור מועד'}
      </button>
      {job.scheduled_at && (
        <button type="button" onClick={clear} disabled={busy} className="min-h-11 w-full text-primer-light underline underline-offset-4">
          הסר את המועד
        </button>
      )}
    </form>
  );
}
