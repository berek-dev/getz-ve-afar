import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { NewJob } from '../lib/api.ts';
import { JOB_KIND_LABELS, JOB_STATUS_LABELS } from '../core/types.ts';
import type { Job, JobKind, JobStatus } from '../core/types.ts';
import { STAGES, STAGE_ORDER, isOpen, stageIndex } from '../core/stages.ts';
import { Icon } from '../components/Icon.tsx';
import type { IconName } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { StageBar, stageColor } from '../components/StageBar.tsx';
import { toast } from '../components/Toast.tsx';

const KIND_ICON: Record<JobKind, IconName> = {
  fabrication: 'frame',
  pipe: 'pipe',
  service: 'wrench',
  earthworks: 'excavator',
};

const KIND_HINT: Record<JobKind, string> = {
  fabrication: 'שערים, מעקות, פרגולות',
  pipe: 'קווי מים וצינורות',
  service: 'תיקון מהיר אצל לקוח',
  earthworks: 'חפירה, פילוס, פינוי',
};

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
        <NewJobForm
          onCreated={(job) => {
            setJobs((prev) => [job, ...(prev ?? [])]);
            setFilter('open');
            setCreating(false);
            toast('העבודה נשמרה');
          }}
        />
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
      <div className="flex items-start gap-3">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-steel-700 text-soapstone"
          title={JOB_KIND_LABELS[job.kind]}
        >
          <Icon name={KIND_ICON[job.kind]} size={26} />
          <span className="sr-only">{JOB_KIND_LABELS[job.kind]}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold leading-snug">{job.title}</p>
          <p className="mt-0.5 truncate text-[0.95rem] text-steel-300">{where}</p>
        </div>
      </div>

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

function NewJobForm({ onCreated }: { onCreated: (job: Job) => void }) {
  const [form, setForm] = useState<NewJob>({ title: '', kind: 'fabrication' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleMissing, setTitleMissing] = useState(false);

  const set = <K extends keyof NewJob>(key: K, value: NewJob[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setTitleMissing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onCreated(await api.createJob(form));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 font-semibold">סוג העבודה</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(JOB_KIND_LABELS) as JobKind[]).map((kind) => {
            const selected = form.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() => set('kind', kind)}
                className={`relative flex min-h-24 flex-col items-start gap-1 rounded-[10px] border-2 p-3 text-start ${
                  selected ? 'border-hivis bg-steel-950' : 'border-steel-700 bg-steel-900'
                }`}
              >
                <Icon name={KIND_ICON[kind]} size={28} className={selected ? 'text-hivis' : 'text-steel-300'} />
                <span className="font-semibold">{JOB_KIND_LABELS[kind]}</span>
                <span className="text-sm leading-tight text-steel-300">{KIND_HINT[kind]}</span>
                {selected && (
                  <span className="absolute end-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-hivis text-steel-950">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block font-semibold">מה העבודה?</span>
        <input
          className="field"
          value={form.title}
          onChange={(e) => {
            set('title', e.target.value);
            if (e.target.value.trim()) setTitleMissing(false);
          }}
          placeholder="למשל: שער כנף כפולה 4 מ׳"
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? 'title-error' : undefined}
        />
        {titleMissing && (
          <span id="title-error" className="mt-1.5 block text-sm text-primer-light">
            כתוב במילה או שתיים מה העבודה, כדי שתזהה אותה ברשימה.
          </span>
        )}
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">שם הלקוח</span>
        <input
          className="field"
          value={form.client_name ?? ''}
          onChange={(e) => set('client_name', e.target.value)}
          placeholder="למשל: משפחת כהן"
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">איפה?</span>
        <input
          className="field"
          value={form.site_address ?? ''}
          onChange={(e) => set('site_address', e.target.value)}
          placeholder="יישוב או כתובת"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block font-semibold">פרטים</span>
        <textarea
          className="field min-h-28"
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
          placeholder="מידות, חומרים, מה הלקוח ביקש"
        />
        <span className="mt-1.5 flex items-center gap-1.5 text-sm text-steel-300">
          <Icon name="mic" size={16} />
          אפשר להכתיב: לוחצים על המיקרופון במקלדת.
        </span>
      </label>

      {error && (
        <p className="text-primer-light" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? 'שומר...' : 'שמור עבודה'}
      </button>
    </form>
  );
}
