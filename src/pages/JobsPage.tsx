import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { JOB_KIND_LABELS, JOB_STATUS_LABELS } from '../core/types.ts';
import type { Job, JobStatus } from '../core/types.ts';
import { STAGES, STAGE_ORDER, isOpen, stageIndex } from '../core/stages.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { StageBar, stageColor } from '../components/StageBar.tsx';
import { toast } from '../components/Toast.tsx';
import { JobForm, KIND_ICON } from '../components/JobForm.tsx';
import { fmtSlotDay, fmtSlotTime } from '../lib/format.ts';

type Filter = 'open' | 'closed' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'פתוחות' },
  { id: 'closed', label: 'סגורות' },
  { id: 'all', label: 'הכל' },
];

function matches(filter: Filter, job: Job): boolean {
  if (filter === 'all') return true;
  return filter === 'open' ? isOpen(job.status) : !isOpen(job.status);
}

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [creating, setCreating] = useState(false);
  const [stageJob, setStageJob] = useState<Job | null>(null);

  const load = useCallback(() => {
    api
      .jobs()
      .then((j) => {
        setJobs(j);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const list = jobs ?? [];
    return {
      open: list.filter((j) => matches('open', j)).length,
      closed: list.filter((j) => matches('closed', j)).length,
      all: list.length,
    };
  }, [jobs]);

  const visible = (jobs ?? []).filter((j) => matches(filter, j));

  const changeStatus = async (job: Job, status: JobStatus) => {
    try {
      const updated = await api.setJobStatus(job.id, status);
      setJobs((prev) => prev?.map((j) => (j.id === job.id ? { ...j, ...updated } : j)) ?? null);
      toast(`עודכן: ${JOB_STATUS_LABELS[status]}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section>
      <h2 className="font-display text-[2.6rem] leading-none">עבודות</h2>

      <div className="mt-4 flex gap-2" role="group" aria-label="סינון עבודות">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.id)}
              className={`flex min-h-11 items-center gap-2 rounded-full border px-4 text-[0.95rem] font-semibold ${
                active ? 'border-soapstone bg-soapstone text-steel-950' : 'border-steel-700 text-steel-300'
              }`}
            >
              {f.label}
              <span className={`tnum text-sm ${active ? 'text-steel-700' : 'text-steel-500'}`}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-4 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
          {error}
        </p>
      )}

      {jobs === null && !error && <p className="mt-6 text-steel-300">טוען עבודות...</p>}

      {jobs !== null && visible.length === 0 && (
        <EmptyState filter={filter} onCreate={() => setCreating(true)} />
      )}

      <ul className="mt-4 space-y-3">
        {visible.map((job) => (
          <JobCard key={job.id} job={job} onAdvance={changeStatus} onPickStage={() => setStageJob(job)} />
        ))}
      </ul>

      {/* Main action, always in thumb reach above the bottom bar */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 bg-gradient-to-t from-steel-900 via-steel-900/90 to-transparent pb-3 pt-6">
        <div className="mx-auto max-w-xl px-4">
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            עבודה חדשה
          </button>
        </div>
      </div>

      <Sheet open={creating} onClose={() => setCreating(false)} title="עבודה חדשה">
        {creating && (
          <JobForm
            submitLabel="שמור ופתח את העבודה"
            offerTemplates
            onSubmit={async (draft) => {
              const job = await api.createJob(draft);
              setCreating(false);
              toast('העבודה נשמרה');
              window.location.hash = `#/jobs/${job.id}`;
            }}
          />
        )}
      </Sheet>

      <Sheet open={stageJob !== null} onClose={() => setStageJob(null)} title="באיזה שלב העבודה?">
        {stageJob && (
          <StagePicker
            job={stageJob}
            onPick={(status) => {
              const job = stageJob;
              setStageJob(null);
              if (status !== job.status) void changeStatus(job, status);
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

function JobCard({
  job,
  onAdvance,
  onPickStage,
}: {
  job: Job;
  onAdvance: (job: Job, status: JobStatus) => void;
  onPickStage: () => void;
}) {
  const info = STAGES[job.status];
  const index = stageIndex(job.status);
  const where = [job.client_name ?? 'בלי לקוח', job.site_address].filter(Boolean).join(', ');

  return (
    <li className="plate rounded-[10px] p-4">
      <a href={`#/jobs/${job.id}`} className="-m-1 flex items-start gap-3 rounded-lg p-1">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-steel-700 text-soapstone"
          title={JOB_KIND_LABELS[job.kind]}
        >
          <Icon name={KIND_ICON[job.kind]} size={26} />
          <span className="sr-only">{JOB_KIND_LABELS[job.kind]}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold leading-snug">{job.title}</span>
          <span className="mt-0.5 block truncate text-[0.95rem] text-steel-300">{where}</span>
          {job.scheduled_at && isOpen(job.status) && (
            <span className="tnum mt-1 flex items-center gap-1.5 text-sm font-semibold text-hivis">
              <Icon name="calendar" size={16} />
              {fmtSlotDay(job.scheduled_at)}, {fmtSlotTime(job.scheduled_at)}
            </span>
          )}
        </span>
        <Icon name="forward" size={22} className="mt-3 shrink-0 text-steel-500" />
      </a>

      <button
        type="button"
        onClick={onPickStage}
        className="mt-4 block w-full rounded-md text-start"
        aria-label={`שלב: ${JOB_STATUS_LABELS[job.status]}. לחץ כדי לשנות`}
      >
        <StageBar status={job.status} />
        <span className="mt-2 flex items-center justify-between text-[0.95rem]">
          <span className="font-semibold" style={{ color: stageColor(job.status) }}>
            {JOB_STATUS_LABELS[job.status]}
          </span>
          {index >= 0 && (
            <span className="tnum text-sm text-steel-500">
              שלב {index + 1} מתוך {STAGE_ORDER.length}
            </span>
          )}
        </span>
      </button>

      {info.next && info.advanceLabel && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-steel-700 pt-3">
          <p className="text-[0.95rem] text-steel-300">
            הצעד הבא: <span className="text-soapstone">{info.nextStep}</span>
          </p>
          <button
            type="button"
            onClick={() => onAdvance(job, info.next as JobStatus)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-[0.95rem] font-semibold text-soapstone active:bg-steel-700"
          >
            <Icon name="check" size={18} />
            {info.advanceLabel}
          </button>
        </div>
      )}
    </li>
  );
}

function StagePicker({ job, onPick }: { job: Job; onPick: (status: JobStatus) => void }) {
  const options: JobStatus[] = [...STAGE_ORDER, 'lost'];
  return (
    <div>
      <p className="mb-3 text-steel-300">{job.title}</p>
      <ul className="space-y-1.5">
        {options.map((status) => {
          const current = status === job.status;
          return (
            <li key={status}>
              <button
                type="button"
                onClick={() => onPick(status)}
                aria-current={current ? 'step' : undefined}
                className={`flex min-h-13 w-full items-center gap-3 rounded-[10px] px-4 text-start text-lg ${
                  current ? 'bg-steel-700 font-semibold' : 'active:bg-steel-700'
                } ${status === 'lost' ? 'mt-3 border border-steel-700' : ''}`}
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: stageColor(status) }} />
                <span className="flex-1">{JOB_STATUS_LABELS[status]}</span>
                {current && <Icon name="check" size={20} className="text-hivis" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState({ filter, onCreate }: { filter: Filter; onCreate: () => void }) {
  if (filter === 'closed') {
    return (
      <p className="mt-8 text-center text-steel-300">עבודות שהסתיימו ושולמו, או שלא יצאו לפועל, יופיעו כאן.</p>
    );
  }
  return (
    <div className="mt-8 rounded-[10px] border-2 border-dashed border-steel-700 px-6 py-10 text-center">
      <p className="font-display text-4xl leading-none">אין עבודות פתוחות</p>
      <p className="mx-auto mt-3 max-w-xs text-steel-300">
        כל פנייה של לקוח מתחילה כאן. רושמים אותה עכשיו, וממשיכים ממנה לביקור, להצעה ולתשלום.
      </p>
      <button type="button" onClick={onCreate} className="mt-5 font-semibold text-hivis underline underline-offset-4">
        לרשום עבודה חדשה
      </button>
    </div>
  );
}
