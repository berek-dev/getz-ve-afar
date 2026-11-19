import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { todayList } from '../core/phases.ts';
import { addDays, businessNow, jobEvents } from '../core/calendar.ts';
import type { JobEvent } from '../core/calendar.ts';
import { fmtLongDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Mark, PageHeader, SectionTitle, actionMeta, phaseNumber } from '../components/ui.tsx';

/** The home screen: what needs doing now across all jobs, and what is on the calendar. */
export function TodayPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const now = businessNow();
  const today = now.slice(0, 10);
  const tomorrow = addDays(today, 1);
  const items = useMemo(() => todayList(jobs ?? [], now), [jobs, now]);
  const events = useMemo(() => jobEvents(jobs ?? []), [jobs]);
  const todays = events.filter((e) => e.start.slice(0, 10) === today);
  const tomorrows = events.filter((e) => e.start.slice(0, 10) === tomorrow);
  const toDo = items.filter((i) => i.action.kind === 'do').length;

  return (
    <div>
      <PageHeader eyebrow={fmtLongDay(`${today}T00:00`)} title="היום">
        {jobs && (
          <p className="mt-0.5 text-[0.95rem] text-muted">
            {toDo === 0 ? 'אין משהו דחוף' : toDo === 1 ? 'דבר אחד לטפל בו' : `${toDo} דברים לטפל בהם`}
            {todays.length > 0 && `, ${todays.length === 1 ? 'אחד' : todays.length} ביומן`}
          </p>
        )}
      </PageHeader>

      {error && (
        <p className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      )}
      {!jobs && !error && <p className="text-muted">טוען...</p>}

      {jobs && (
        <section aria-labelledby="todo-title">
          <SectionTitle id="todo-title" aside="1 פנייה, 2 תכנון, 3 ביצוע, 4 תשלום">
            לטפל עכשיו
          </SectionTitle>
          {items.length === 0 ? (
            <div className="plate rounded-md px-5 py-7 text-center">
              <p className="text-muted">
                {jobs.length === 0 ? 'כל עבודה מתחילה כפנייה. רושמים אותה בכפתור ＋ למטה.' : 'אין עבודות פתוחות. פנייה חדשה מתחילה בכפתור ＋ למטה.'}
              </p>
            </div>
          ) : (
            <ul className="plate divide-y divide-line rounded-md">
              {items.map(({ job, phase, action }) => {
                const meta = actionMeta(action);
                return (
                  <li key={job.id}>
                    <a href={`#/jobs/${job.id}/${action.step}`} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5 active:bg-sunken">
                      <Mark n={phaseNumber(phase)} state={action.kind === 'do' && meta?.urgent ? 'next' : 'todo'} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold leading-snug">{action.label}</span>
                        <span className="block truncate text-[0.85rem] text-muted">
                          {[job.title, job.client_name].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      {meta && (
                        <span className={`tnum shrink-0 text-[0.85rem] ${meta.urgent ? 'font-semibold text-accent' : 'text-muted'}`}>{meta.text}</span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {jobs && (
        <section className="mt-7" aria-labelledby="cal-title">
          <SectionTitle
            id="cal-title"
            aside={
              <a href="#/calendar" className="font-semibold text-accent">
                כל היומן
              </a>
            }
          >
            {todays.length > 0 || tomorrows.length === 0 ? 'ביומן היום' : 'ביומן מחר'}
          </SectionTitle>
          {todays.length === 0 && tomorrows.length === 0 ? (
            <p className="px-1 text-muted">אין מועדים היום ומחר.</p>
          ) : (
            <EventList events={todays.length > 0 ? todays : tomorrows} />
          )}
        </section>
      )}
    </div>
  );
}

export function EventList({ events }: { events: JobEvent<Job>[] }) {
  return (
    <ul className="plate divide-y divide-line rounded-md">
      {events.map((e) => (
        <li key={`${e.job.id}-${e.kind}`}>
          <a href={`#/jobs/${e.job.id}/${e.kind === 'visit' ? 'visit' : 'install'}`} className="flex min-h-14 items-center gap-3.5 px-3.5 py-2.5 active:bg-sunken">
            <span className="tnum w-12 shrink-0 font-semibold">{fmtSlotTime(e.start)}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{e.kind === 'visit' ? 'ביקור ומדידה' : 'עבודה'}</span>
              <span className="block truncate text-[0.85rem] text-muted">{[e.job.title, e.job.site_address].filter(Boolean).join(', ')}</span>
            </span>
            <Icon name="forward" size={18} className="shrink-0 text-faint" />
          </a>
        </li>
      ))}
    </ul>
  );
}
