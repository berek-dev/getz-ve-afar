import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { addDays, businessToday, jobEvents } from '../core/calendar.ts';
import type { JobEvent } from '../core/calendar.ts';
import { fmtHours, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader, SectionTitle } from '../components/ui.tsx';

export function wazeLink(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

/** Measuring visits and work days, nearest first, plus what still needs a date. */
export function CalendarPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const today = businessToday();
  const tomorrow = addDays(today, 1);

  const { days, late, needDate, needVisit } = useMemo(() => {
    const list = jobs ?? [];
    const events = jobEvents(list);
    const byDay = new Map<string, JobEvent<Job>[]>();
    for (const e of events) {
      const d = e.start.slice(0, 10);
      if (d < today) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    return {
      days: [...byDay.entries()],
      late: events.filter((e) => e.start.slice(0, 10) < today && !(e.kind === 'work' && e.job.status === 'quoted')),
      needDate: list.filter((j) => !j.scheduled_at && (j.status === 'approved' || j.status === 'in_progress')),
      needVisit: list.filter((j) => !j.visit_at && j.status === 'lead'),
    };
  }, [jobs, today]);

  const dayTitle = (d: string) => (d === today ? 'היום' : d === tomorrow ? 'מחר' : fmtSlotDay(`${d}T00:00`));

  return (
    <div>
      <PageHeader title="יומן" />
      {error && (
        <p className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      )}
      {!jobs && !error && <p className="text-muted">טוען...</p>}

      {jobs && days.length === 0 && (
        <p className="plate rounded-md p-5 text-center text-muted">אין מועדים קרובים. ביקור קובעים בשלב הפנייה, ומועד לעבודה בלוח הזמנים של העבודה.</p>
      )}

      <div className="space-y-6">
        {days.map(([day, list]) => (
          <section key={day} aria-label={dayTitle(day)}>
            <SectionTitle aside={day === today || day === tomorrow ? fmtSlotDay(`${day}T00:00`) : undefined}>
              <span className={day === today ? 'text-accent' : undefined}>{dayTitle(day)}</span>
            </SectionTitle>
            <ul className="plate divide-y divide-line rounded-md">
              {list.map((e) => (
                <EventRow key={`${e.job.id}-${e.kind}`} event={e} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {late.length > 0 && (
        <Waiting
          title="המועד עבר"
          hint="לקבוע מועד חדש, או לקדם את העבודה לשלב הבא."
          rows={late.map((e) => ({ job: e.job, step: e.kind === 'visit' ? 'visit' : 'schedule', text: `${e.kind === 'visit' ? 'ביקור' : 'עבודה'}, ${fmtSlotDay(e.start)}` }))}
        />
      )}
      {needDate.length > 0 && (
        <Waiting title="מאושרות, בלי מועד" hint="הלקוח אישר. נשאר לתאם מתי מבצעים." rows={needDate.map((job) => ({ job, step: 'schedule', text: job.client_name ?? '' }))} />
      )}
      {needVisit.length > 0 && (
        <Waiting title="פניות שמחכות לביקור" hint="לתאם מדידה בשטח." rows={needVisit.map((job) => ({ job, step: 'visit', text: job.client_name ?? '' }))} />
      )}
    </div>
  );
}

function EventRow({ event: e }: { event: JobEvent<Job> }) {
  const job = e.job;
  return (
    <li className="flex items-stretch">
      <a href={`#/jobs/${job.id}/${e.kind === 'visit' ? 'visit' : 'install'}`} className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 active:bg-sunken">
        <span className="tnum w-12 shrink-0">
          <span className="block font-semibold leading-tight">{fmtSlotTime(e.start)}</span>
          {e.kind === 'work' && job.scheduled_hours ? <span className="block text-xs text-muted">{fmtHours(job.scheduled_hours)}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.85rem] text-muted">{e.kind === 'visit' ? 'ביקור ומדידה' : 'עבודה'}</span>
          <span className="block truncate font-semibold">{job.title}</span>
          <span className="block truncate text-[0.85rem] text-muted">{[job.client_name, job.site_address].filter(Boolean).join(', ')}</span>
        </span>
      </a>
      <span className="flex shrink-0 flex-col justify-center pe-1.5">
        {job.site_address && (
          <a href={wazeLink(job.site_address)} target="_blank" rel="noreferrer" aria-label="ניווט בוויז" className="grid h-11 w-11 place-items-center text-muted">
            <Icon name="navigate" size={20} />
          </a>
        )}
        {job.client_phone && (
          <a href={`tel:${job.client_phone}`} aria-label={`התקשר ל${job.client_name ?? 'לקוח'}`} className="grid h-11 w-11 place-items-center text-muted">
            <Icon name="phone" size={20} />
          </a>
        )}
      </span>
    </li>
  );
}

function Waiting({ title, hint, rows }: { title: string; hint: string; rows: { job: Job; step: string; text: string }[] }) {
  return (
    <section className="mt-8">
      <SectionTitle>{title}</SectionTitle>
      <p className="-mt-1 mb-2 px-1 text-[0.85rem] text-muted">{hint}</p>
      <ul className="plate divide-y divide-line rounded-md">
        {rows.map(({ job, step, text }) => (
          <li key={`${job.id}-${step}`}>
            <a href={`#/jobs/${job.id}/${step}`} className="flex min-h-14 items-center gap-3 px-3.5 py-2 active:bg-sunken">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{job.title}</span>
                {text && <span className="block truncate text-[0.85rem] text-muted">{text}</span>}
              </span>
              <Icon name="forward" size={18} className="shrink-0 text-faint" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
