import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail } from '../lib/api.ts';
import { JOB_KIND_LABELS, JOB_STATUS_LABELS } from '../core/types.ts';
import type { Element, JobStatus, Settings } from '../core/types.ts';
import { computeJob } from '../core/quantities.ts';
import { PHASES, currentPhase, neighbours, nextAction, phaseStatus, phaseSteps, stepDef } from '../core/phases.ts';
import type { PhaseId, StepId } from '../core/phases.ts';
import { STAGE_ORDER } from '../core/stages.ts';
import { businessNow } from '../core/calendar.ts';
import { whatsappLink } from '../core/phone.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { toast } from '../components/Toast.tsx';
import { Mark, actionMeta, phaseNumber, phaseTitle } from '../components/ui.tsx';
import { EditJobSheet, StepBody, stepSummary } from '../components/JobSteps.tsx';
import type { JobCtx } from '../components/JobSteps.tsx';
import { wazeLink } from './CalendarPage.tsx';

/** One job: the overview of its four phases, or one of its steps (#/jobs/9/boq). */
export function JobPage({ jobId, step }: { jobId: number; step: StepId | null }) {
  const [job, setJobState] = useState<JobDetail | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [elements, setElements] = useState<Element[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.job(jobId), api.settings(), api.elements()])
      .then(([j, s, e]) => {
        setJobState(j);
        setSettings(s);
        setElements(e);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [jobId]);

  const totals = useMemo(() => (job && settings ? computeJob(job.items, settings) : null), [job, settings]);

  if (error) {
    return (
      <div>
        <BackLink href="#/jobs" label="עבודות" />
        <p className="mt-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!job || !settings || !totals) {
    return (
      <div>
        <BackLink href="#/jobs" label="עבודות" />
        <p className="mt-6 text-muted">טוען את העבודה...</p>
      </div>
    );
  }

  const ctx: JobCtx = {
    job,
    settings,
    elements,
    totals,
    setJob: (update) => setJobState((j) => (j ? update(j) : j)),
    applyJob: (row) => setJobState((j) => (j ? { ...j, ...row, items: j.items } : j)),
    reload: async () => {
      const j = await api.job(jobId);
      setJobState(j);
    },
    changeStatus: async (status) => {
      try {
        const row = await api.setJobStatus(jobId, status);
        setJobState((j) => (j ? { ...j, ...row, items: j.items } : j));
        toast(`עודכן: ${JOB_STATUS_LABELS[status]}`);
      } catch (e) {
        toast(errorMessage(e));
      }
    },
  };

  return step ? <StepScreen ctx={ctx} step={step} /> : <Overview ctx={ctx} />;
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="-ms-1 inline-flex min-h-11 items-center gap-0.5 px-1 font-medium text-accent">
      <Icon name="back" size={20} />
      {label}
    </a>
  );
}

// ------------------------------------------------------------------------------------------- overview

function Overview({ ctx }: { ctx: JobCtx }) {
  const { job } = ctx;
  const now = businessNow();
  const phase = currentPhase(job, now);
  const [view, setView] = useState<PhaseId>(phase === 'closed' ? 'payment' : phase);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const action = nextAction(job, now);
  const meta = action ? actionMeta(action) : null;
  const where = [job.client_name, job.site_address].filter(Boolean).join(', ');
  const current = phaseStatus(view, job, now);
  const phaseIndex = phase === 'closed' ? PHASES.length : PHASES.findIndex((p) => p.id === phase);

  return (
    <article>
      <div className="flex items-center justify-between">
        <BackLink href="#/jobs" label="עבודות" />
        <div className="flex gap-2">
          {job.client_phone && (
            <a href={`tel:${job.client_phone}`} aria-label="התקשר ללקוח" className="grid h-11 w-11 place-items-center rounded-md border border-line-strong bg-card">
              <Icon name="phone" size={20} />
            </a>
          )}
          {job.client_phone && (
            <a href={whatsappLink(job.client_phone, '')} target="_blank" rel="noreferrer" aria-label="וואטסאפ ללקוח" className="grid h-11 w-11 place-items-center rounded-md border border-line-strong bg-card">
              <Icon name="whatsapp" size={20} />
            </a>
          )}
          {job.site_address && (
            <a href={wazeLink(job.site_address)} target="_blank" rel="noreferrer" aria-label="ניווט לאתר" className="grid h-11 w-11 place-items-center rounded-md border border-line-strong bg-card">
              <Icon name="navigate" size={20} />
            </a>
          )}
          <button type="button" onClick={() => setEditing(true)} aria-label="עריכת פרטי העבודה" className="grid h-11 w-11 place-items-center rounded-md border border-line-strong bg-card">
            <Icon name="pencil" size={18} />
          </button>
        </div>
      </div>

      <header className="mt-2">
        <p className="text-[0.85rem] text-muted">{JOB_KIND_LABELS[job.kind]}</p>
        <h1 className="text-[1.5rem] font-bold leading-snug">{job.title}</h1>
        {where && <p className="text-[0.95rem] text-muted">{where}</p>}
      </header>

      <div className="mt-5 grid grid-cols-4" role="list" aria-label="שלבי העבודה">
        {PHASES.map((p, i) => {
          const st = phaseStatus(p.id, job, now);
          const done = i < phaseIndex;
          const isCurrent = i === phaseIndex;
          return (
            <button
              key={p.id}
              type="button"
              role="listitem"
              onClick={() => setView(p.id)}
              aria-current={isCurrent ? 'step' : undefined}
              aria-pressed={view === p.id}
              className="flex flex-col items-stretch gap-1.5 pb-1 text-start"
            >
              <span
                className={`h-2.5 border-t-[3px] border-s-2 ${i === PHASES.length - 1 ? 'border-e-2' : ''} ${
                  done ? 'border-ink' : isCurrent ? 'border-accent' : 'border-dashed border-line-strong'
                }`}
                aria-hidden="true"
              />
              <span className={`text-[0.85rem] leading-tight ${isCurrent ? 'font-bold text-accent' : done ? 'font-semibold' : 'font-medium text-muted'} ${view === p.id ? 'underline decoration-2 underline-offset-4' : ''}`}>
                {i + 1} {p.short}
              </span>
              <span className="tnum text-[0.75rem] text-muted">{done ? 'הושלם' : isCurrent ? `${st.done} מתוך ${st.total}` : ' '}</span>
            </button>
          );
        })}
      </div>

      {action ? (
        <section aria-label="הצעד הבא" className="plate mt-4 rounded-md p-4">
          <p className="text-[0.8rem] text-muted">{action.kind === 'wait' ? 'ממתינים' : 'הצעד הבא'}</p>
          <p className="text-[1.1rem] font-semibold leading-snug">
            {action.label}
            {meta && <span className={`tnum font-normal ${meta.urgent ? 'text-accent' : 'text-muted'}`}>, {meta.text}</span>}
          </p>
          <div className="mt-3 grid gap-2">
            <a href={`#/jobs/${job.id}/${action.step}`} className={action.kind === 'do' && !action.advance ? 'btn-primary' : 'btn-secondary min-h-12'}>
              {stepDef(action.step).title}
            </a>
            {action.advance && (
              <button type="button" onClick={() => void ctx.changeStatus(action.advance!.status)} className="btn-primary">
                <Icon name="check" />
                {action.advance.label}
              </button>
            )}
          </div>
        </section>
      ) : (
        <p className="plate mt-4 rounded-md p-4 font-semibold">{job.status === 'lost' ? 'העבודה לא יצאה לפועל.' : 'העבודה שולמה וסגורה.'}</p>
      )}

      <section className="mt-6" aria-labelledby="steps-title">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 id="steps-title" className="text-[1.05rem] font-bold">
            {phaseNumber(view)} {phaseTitle(view)}
          </h2>
          <span className="tnum text-[0.8rem] text-muted">
            {current.done} מתוך {current.total} הושלמו
          </span>
        </div>
        <ol className="plate divide-y divide-line rounded-md">
          {current.steps.map((s, i) => (
            <li key={s.id}>
              <a href={`#/jobs/${job.id}/${s.id}`} className={`flex min-h-16 items-center gap-3 px-3.5 py-2.5 active:bg-sunken ${s.state === 'next' ? 'bg-accent-soft' : ''}`}>
                <Mark n={i + 1} state={s.state === 'done' ? 'done' : s.state === 'next' ? 'next' : 'todo'} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{s.title}</span>
                  <span className="block truncate text-[0.85rem] text-muted">{stepSummary(s.id, ctx)}</span>
                </span>
                {s.state === 'done' ? (
                  <Icon name="check" size={20} className="shrink-0 text-ok" />
                ) : s.state === 'next' ? (
                  <span className="shrink-0 text-[0.85rem] font-bold text-accent">הבא</span>
                ) : s.state === 'optional' ? (
                  <span className="shrink-0 text-[0.8rem] text-muted">לא חובה</span>
                ) : null}
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6" aria-labelledby="other-phases">
        <h2 id="other-phases" className="mb-2 px-1 text-[0.9rem] font-semibold text-muted">
          שאר השלבים
        </h2>
        <ul className="plate divide-y divide-line rounded-md">
          {PHASES.filter((p) => p.id !== view).map((p) => {
            const i = PHASES.findIndex((x) => x.id === p.id);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setView(p.id)} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-start active:bg-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {i + 1} {p.title}
                    </span>
                    <span className="block truncate text-[0.85rem] text-muted">
                      {i < phaseIndex ? 'הושלם: ' : ''}
                      {phaseSteps(p.id)
                        .map((s) => s.title)
                        .join(', ')}
                    </span>
                  </span>
                  <Icon name="forward" size={18} className="shrink-0 text-faint" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-6 text-center">
        <button type="button" onClick={() => setPicking(true)} className="min-h-11 text-[0.9rem] text-muted underline underline-offset-4">
          שינוי שלב ידני ({JOB_STATUS_LABELS[job.status]})
        </button>
      </p>

      <Sheet open={picking} onClose={() => setPicking(false)} title="באיזה שלב העבודה?">
        {picking && (
          <StagePicker
            status={job.status}
            onPick={(s) => {
              setPicking(false);
              if (s !== job.status) void ctx.changeStatus(s);
            }}
          />
        )}
      </Sheet>
      <EditJobSheet ctx={ctx} open={editing} onClose={() => setEditing(false)} />
    </article>
  );
}

function StagePicker({ status, onPick }: { status: JobStatus; onPick: (s: JobStatus) => void }) {
  return (
    <div>
      <p className="mb-3 text-muted">השלב מתעדכן לבד לפי מה שנעשה. כאן אפשר לתקן ידנית.</p>
      <ul className="plate divide-y divide-line rounded-md">
        {[...STAGE_ORDER, 'lost' as const].map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              aria-current={s === status ? 'step' : undefined}
              className={`flex min-h-12 w-full items-center gap-3 px-4 text-start ${s === status ? 'font-semibold' : ''} ${s === 'lost' ? 'text-danger' : ''}`}
            >
              <span className="flex-1">{JOB_STATUS_LABELS[s]}</span>
              {s === status && <Icon name="check" size={20} className="text-accent" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- one step

function StepScreen({ ctx, step }: { ctx: JobCtx; step: StepId }) {
  const { job } = ctx;
  const def = stepDef(step);
  const steps = phaseSteps(def.phase);
  const index = steps.findIndex((s) => s.id === step);
  const { prev, next } = neighbours(step);

  return (
    <article>
      <BackLink href={`#/jobs/${job.id}`} label={job.title} />
      <header className="mt-1">
        <p className="text-[0.85rem] text-muted">
          {phaseTitle(def.phase)}, צעד {index + 1} מתוך {steps.length}
        </p>
        <h1 className="text-[1.5rem] font-bold leading-snug">{def.title}</h1>
      </header>

      <div className="mt-4">
        <StepBody step={step} ctx={ctx} />
      </div>

      <nav
        aria-label="צעדים"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-line bg-page/95 backdrop-blur"
      >
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-2 px-4 py-2.5">
          {prev ? (
            <a href={`#/jobs/${job.id}/${prev.id}`} className="btn-secondary min-h-12 justify-start text-[0.9rem]">
              <Icon name="back" size={18} />
              <span className="truncate">{prev.title}</span>
            </a>
          ) : (
            <a href={`#/jobs/${job.id}`} className="btn-secondary min-h-12 justify-start text-[0.9rem]">
              <Icon name="back" size={18} />
              כל השלבים
            </a>
          )}
          {next ? (
            <a href={`#/jobs/${job.id}/${next.id}`} className="flex min-h-12 items-center justify-end gap-1 rounded-md bg-ink px-3 text-[0.9rem] font-semibold text-white">
              <span className="truncate">{next.title}</span>
              <Icon name="forward" size={18} />
            </a>
          ) : (
            <a href={`#/jobs/${job.id}`} className="flex min-h-12 items-center justify-end gap-1 rounded-md bg-ink px-3 text-[0.9rem] font-semibold text-white">
              כל השלבים
              <Icon name="forward" size={18} />
            </a>
          )}
        </div>
      </nav>
    </article>
  );
}
