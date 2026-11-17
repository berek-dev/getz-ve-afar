import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { JOB_STATUS_LABELS } from '../core/types.ts';
import { addDays, businessToday } from '../core/calendar.ts';
import { fmtHours, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { KIND_ICON } from '../components/JobForm.tsx';
import { slotLabel } from '../components/ScheduleBlock.tsx';

const ACTIVE = new Set(['lead', 'visit', 'quoted', 'approved', 'in_progress']);

export function wazeLink(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

/** What's on: visits and work days, nearest first, plus what still needs a date. */
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
    const list = (jobs ?? []).filter((j) => ACTIVE.has(j.status));
    const dated = list.filter((j) => j.scheduled_at).sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''));
    const byDay = new Map<string, Job[]>();
    for (const j of dated) {
      const d = (j.scheduled_at as string).slice(0, 10);
      if (d < today) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), j]);
    }
    return {
      days: [...byDay.entries()],
      late: dated.filter((j) => (j.scheduled_at as string).slice(0, 10) < today && j.status !== 'quoted'),
      needDate: list.filter((j) => !j.scheduled_at && (j.status === 'approved' || j.status === 'in_progress')),
      needVisit: list.filter((j) => !j.scheduled_at && j.status === 'lead'),
    };
  }, [jobs, today]);

  const dayTitle = (d: string) => (d === today ? 'היום' : d === tomorrow ? 'מחר' : fmtSlotDay(`${d}T00:00`));

  return (
    <div>
      <h1 className="font-display text-[3rem] leading-none">יומן</h1>
      {error && (
        <p className="mt-4 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
          {error}
        </p>
      )}
      {!jobs && !error && <p className="mt-4 text-steel-300">טוען...</p>}

      {jobs && days.length === 0 && (
        <p className="mt-4 rounded-[10px] border-2 border-dashed border-steel-700 p-5 text-center text-steel-300">
          אין מועדים קרובים. קובעים מועד מתוך העבודה, מתחת לשלב שלה.
        </p>
      )}

      {days.map(([day, list]) => (
        <section key={day} className="mt-6" aria-label={dayTitle(day)}>
          <h2 className={`mb-2 text-lg font-semibold ${day === today ? 'text-hivis' : ''}`}>
            {dayTitle(day)}
            {day === today || day === tomorrow ? <span className="ms-2 text-sm font-normal text-steel-300">{fmtSlotDay(`${day}T00:00`)}</span> : null}
          </h2>
          <ul className="space-y-2">
            {list.map((j) => (
              <SlotCard key={j.id} job={j} />
            ))}
          </ul>
        </section>
      ))}

      {late.length > 0 && (
        <Waiting title="המועד עבר" hint="עדכן מועד חדש או קדם את העבודה לשלב הבא." jobs={late} showDate />
      )}
      {needDate.length > 0 && <Waiting title="מאושרות, בלי מועד" hint="הלקוח אישר. נשאר לתאם מתי מבצעים." jobs={needDate} />}
      {needVisit.length > 0 && <Waiting title="פניות שמחכות לביקור" hint="לתאם מדידה בשטח." jobs={needVisit} />}
    </div>
  );
}

function SlotCard({ job }: { job: Job }) {
  const at = job.scheduled_at as string;
  return (
    <li className="plate flex items-stretch rounded-[10px]">
      <a href={`#/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3">
        <span className="tnum w-14 shrink-0 text-center">
          <span className="block text-lg font-semibold leading-tight">{fmtSlotTime(at)}</span>
          {job.scheduled_hours ? <span className="block text-xs text-steel-300">{fmtHours(job.scheduled_hours)}</span> : null}
        </span>
        <span className="min-w-0 flex-1 border-s border-steel-700 ps-3">
          <span className="flex items-center gap-1.5 text-sm text-steel-300">
            <Icon name={KIND_ICON[job.kind]} size={16} />
            {slotLabel(job)}
          </span>
          <span className="block truncate font-semibold">{job.title}</span>
          <span className="block truncate text-sm text-steel-300">
            {[job.client_name, job.site_address].filter(Boolean).join(', ')}
          </span>
        </span>
      </a>
      <span className="flex shrink-0 flex-col justify-center gap-1 pe-2">
        {job.site_address && (
          <a href={wazeLink(job.site_address)} target="_blank" rel="noreferrer" aria-label="ניווט בוויז" className="grid h-11 w-11 place-items-center rounded-lg text-steel-300">
            <Icon name="navigate" size={20} />
          </a>
        )}
        {job.client_phone && (
          <a href={`tel:${job.client_phone}`} aria-label={`התקשר ל${job.client_name ?? 'לקוח'}`} className="grid h-11 w-11 place-items-center rounded-lg text-steel-300">
            <Icon name="phone" size={20} />
          </a>
        )}
      </span>
    </li>
  );
}

function Waiting({ title, hint, jobs, showDate = false }: { title: string; hint: string; jobs: Job[]; showDate?: boolean }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-steel-300">{hint}</p>
      <ul className="plate mt-2 divide-y divide-steel-700 rounded-[10px]">
        {jobs.map((j) => (
          <li key={j.id}>
            <a href={`#/jobs/${j.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <Icon name={KIND_ICON[j.kind]} size={20} className="shrink-0 text-steel-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{j.title}</span>
                <span className="block truncate text-sm text-steel-300">
                  {showDate && j.scheduled_at ? `${fmtSlotDay(j.scheduled_at)}, ` : ''}
                  {j.client_name ?? JOB_STATUS_LABELS[j.status]}
                </span>
              </span>
              <Icon name="forward" size={18} className="shrink-0 text-steel-500" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
