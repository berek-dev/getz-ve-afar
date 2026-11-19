import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { JOB_STATUS_LABELS } from '../core/types.ts';
import type { Job } from '../core/types.ts';
import { PHASES, currentPhase, nextAction } from '../core/phases.ts';
import type { Phase } from '../core/phases.ts';
import { businessNow } from '../core/calendar.ts';
import { Icon } from '../components/Icon.tsx';
import { Mark, PageHeader, SectionTitle, actionMeta, phaseNumber } from '../components/ui.tsx';

type Filter = 'open' | 'closed';

/** All jobs, grouped by the phase they are in, with the next thing to do on each. */
export function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');

  useEffect(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const now = businessNow();
  const withPhase = useMemo(() => (jobs ?? []).map((job) => ({ job, phase: currentPhase(job, now) as Phase })), [jobs, now]);
  const q = query.trim();
  const found = withPhase.filter(({ job }) =>
    q ? [job.title, job.client_name, job.site_address, job.client_phone].some((s) => s?.includes(q)) : true,
  );
  const open = found.filter((j) => j.phase !== 'closed');
  const closed = found.filter((j) => j.phase === 'closed');

  return (
    <div>
      <PageHeader title="עבודות" />

      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">חיפוש</span>
          <Icon name="search" size={18} className="pointer-events-none absolute inset-y-0 start-3 my-auto text-faint" />
          <input className="field ps-10" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="לקוח, כתובת או עבודה" />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-line bg-card p-1" role="group" aria-label="אילו עבודות">
        {(
          [
            ['open', 'פתוחות', open.length],
            ['closed', 'סגורות', closed.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-[4px] font-semibold ${filter === id ? 'bg-ink text-white' : 'text-muted'}`}
          >
            {label}
            <span className="tnum text-[0.85rem] opacity-75">{count}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      )}
      {jobs === null && !error && <p className="mt-6 text-muted">טוען עבודות...</p>}

      {jobs !== null && filter === 'open' && (
        <div className="mt-5 space-y-6">
          {open.length === 0 && (
            <div className="plate rounded-md px-5 py-8 text-center">
              <p className="text-muted">{q ? 'לא נמצאו עבודות פתוחות.' : 'אין עבודות פתוחות. כל עבודה מתחילה כפנייה חדשה.'}</p>
              {!q && (
                <a href="#/new" className="btn-primary mt-4">
                  <Icon name="plus" />
                  פנייה חדשה
                </a>
              )}
            </div>
          )}
          {PHASES.map((p) => {
            const list = open.filter((j) => j.phase === p.id);
            if (list.length === 0) return null;
            return (
              <section key={p.id} aria-labelledby={`ph-${p.id}`}>
                <SectionTitle id={`ph-${p.id}`} aside={list.length}>
                  {phaseNumber(p.id)} {p.title}
                </SectionTitle>
                <ul className="plate divide-y divide-line rounded-md">
                  {list.map(({ job }) => (
                    <JobRow key={job.id} job={job} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {jobs !== null && filter === 'closed' && (
        <div className="mt-5">
          {closed.length === 0 ? (
            <p className="px-1 text-muted">עבודות ששולמו, או שלא יצאו לפועל, יופיעו כאן.</p>
          ) : (
            <ul className="plate divide-y divide-line rounded-md">
              {closed.map(({ job }) => (
                <li key={job.id}>
                  <a href={`#/jobs/${job.id}`} className="flex min-h-14 items-center gap-3 px-3.5 py-2.5 active:bg-sunken">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{job.title}</span>
                      <span className="block truncate text-[0.85rem] text-muted">{[job.client_name, job.site_address].filter(Boolean).join(', ')}</span>
                    </span>
                    <span className={`shrink-0 text-[0.85rem] ${job.status === 'lost' ? 'text-faint' : 'text-ok'}`}>{JOB_STATUS_LABELS[job.status]}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({ job, now }: { job: Job; now: string }) {
  const action = nextAction(job, now);
  const meta = action ? actionMeta(action) : null;
  const phase = currentPhase(job, now);
  return (
    <li>
      <a href={`#/jobs/${job.id}`} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5 active:bg-sunken">
        {phase !== 'closed' && <Mark n={phaseNumber(phase)} state={action?.kind === 'do' && meta?.urgent ? 'next' : 'todo'} />}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug">{job.title}</span>
          <span className="block truncate text-[0.85rem] text-muted">{[job.client_name, job.site_address].filter(Boolean).join(', ')}</span>
          {action && (
            <span className="mt-0.5 block text-[0.85rem]">
              <span className={action.kind === 'do' ? 'text-ink' : 'text-muted'}>{action.label}</span>
              {meta && <span className={`tnum ${meta.urgent ? 'font-semibold text-accent' : 'text-muted'}`}>, {meta.text}</span>}
            </span>
          )}
        </span>
        <Icon name="forward" size={18} className="shrink-0 text-faint" />
      </a>
    </li>
  );
}
