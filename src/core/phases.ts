/**
 * A job as four phases of numbered steps, in the order the work happens. Steps tick themselves off from
 * the job's data (a model exists, the quote was approved, payments cover it), so nothing is checked by hand.
 * The job's status still drives where it stands; this module turns it into "what to do next".
 */
import { stageIndex } from './stages.ts';
import type { JobKind, JobStatus } from './types.ts';

export type PhaseId = 'intake' | 'planning' | 'execution' | 'payment';

export const PHASES: { id: PhaseId; title: string; short: string; purpose: string }[] = [
  { id: 'intake', title: 'פנייה', short: 'פנייה', purpose: 'מהשיחה הראשונה עד שיש מידות' },
  { id: 'planning', title: 'תכנון והצעה', short: 'תכנון', purpose: 'מה בונים, כמה זה עולה, ומתי' },
  { id: 'execution', title: 'ביצוע', short: 'ביצוע', purpose: 'מהאישור עד שהעבודה עומדת' },
  { id: 'payment', title: 'תשלום וסגירה', short: 'תשלום', purpose: 'עד שהכסף בחשבון' },
];

export type StepId =
  | 'client'
  | 'description'
  | 'visit'
  | 'site'
  | 'model'
  | 'boq'
  | 'drawing'
  | 'schedule'
  | 'quote'
  | 'orders'
  | 'cutting'
  | 'install'
  | 'handover'
  | 'payments'
  | 'invoice'
  | 'expenses'
  | 'profit';

export interface StepDef {
  id: StepId;
  phase: PhaseId;
  title: string;
  /** Nice to have: never the "next step", shown as optional while not done. May depend on the job. */
  optional?: boolean | ((f: Pick<JobFacts, 'kind'>) => boolean);
}

export const STEPS: StepDef[] = [
  { id: 'client', phase: 'intake', title: 'פרטי לקוח ואתר' },
  { id: 'description', phase: 'intake', title: 'תיאור העבודה' },
  { id: 'visit', phase: 'intake', title: 'תיאום ביקור' },
  { id: 'site', phase: 'intake', title: 'מדידות ותמונות מהאתר' },
  // Fabrication starts from the drawing: the price, the shop drawing and the cut list come from it
  { id: 'model', phase: 'planning', title: 'שרטוט והדמיה', optional: (f) => f.kind !== 'fabrication' },
  { id: 'boq', phase: 'planning', title: 'מחיר וכתב כמויות' },
  { id: 'schedule', phase: 'planning', title: 'לוח זמנים' },
  { id: 'quote', phase: 'planning', title: 'הצעת מחיר ואישור' },
  { id: 'drawing', phase: 'execution', title: 'שרטוט ייצור', optional: true },
  { id: 'orders', phase: 'execution', title: 'הזמנת חומרים' },
  { id: 'cutting', phase: 'execution', title: 'חיתוך' },
  { id: 'install', phase: 'execution', title: 'ייצור והתקנה' },
  { id: 'handover', phase: 'execution', title: 'מסירה' },
  { id: 'payments', phase: 'payment', title: 'מקדמה ויתרה' },
  { id: 'invoice', phase: 'payment', title: 'חשבונית ורואה חשבון', optional: true },
  { id: 'expenses', phase: 'payment', title: 'הוצאות העבודה', optional: true },
  { id: 'profit', phase: 'payment', title: 'רווח בפועל', optional: true },
];

export const STEP_IDS = STEPS.map((s) => s.id);
export const isOptional = (s: StepDef, f: Pick<JobFacts, 'kind'>): boolean => (typeof s.optional === 'function' ? s.optional(f) : Boolean(s.optional));
export const stepDef = (id: StepId): StepDef => STEPS.find((s) => s.id === id) as StepDef;
export const phaseSteps = (phase: PhaseId): StepDef[] => STEPS.filter((s) => s.phase === phase);

/** What the steps look at (one row of /api/jobs or /api/jobs/:id) */
export interface JobFacts {
  status: JobStatus;
  kind: JobKind;
  client_name?: string | null;
  client_phone?: string | null;
  site_address?: string | null;
  description?: string | null;
  /** "YYYY-MM-DDTHH:MM" business time */
  visit_at?: string | null;
  site_notes?: string | null;
  scheduled_at?: string | null;
  ordered_at?: string | null;
  item_count?: number | null;
  model_versions?: number | null;
  /** Newest saved model version, and the one Yaal approved ("ההדמיה מוכנה") */
  model_latest_id?: number | null;
  model_approved_id?: number | null;
  photo_count?: number | null;
  expense_count?: number | null;
  /** Latest quote, status as the client sees it (expired included) */
  quote_status?: string | null;
  quote_created_at?: string | null;
  quote_total?: number | null;
  paid_total?: number | null;
}

const at = (status: JobStatus) => stageIndex(status);
const IDX = { visit: at('visit'), quoted: at('quoted'), approved: at('approved'), in_progress: at('in_progress'), done: at('done') };
const text = (s: string | null | undefined) => Boolean(s && s.trim());

/** The model was approved and has not changed since */
export function modelApproved(f: JobFacts): boolean {
  return f.model_approved_id != null && f.model_approved_id === f.model_latest_id;
}

/** What the client owes: the approved quote's total, if any */
export function amountDue(f: JobFacts): number | null {
  return f.quote_status === 'approved' && f.quote_total != null && f.quote_total > 0 ? f.quote_total : null;
}

export function isStepDone(id: StepId, f: JobFacts): boolean {
  const i = at(f.status);
  switch (id) {
    case 'client':
      return text(f.client_name);
    case 'description':
      return text(f.description);
    case 'visit':
      return Boolean(f.visit_at) || i >= IDX.quoted;
    case 'site':
      return text(f.site_notes) || (f.photo_count ?? 0) > 0 || i >= IDX.quoted;
    case 'model':
    case 'drawing':
      return (f.model_versions ?? 0) > 0 && modelApproved(f);
    case 'boq':
      return (f.item_count ?? 0) > 0;
    case 'schedule':
      return Boolean(f.scheduled_at) || i >= IDX.done;
    case 'quote':
      return f.quote_status === 'approved' || i >= IDX.approved;
    case 'orders':
      return Boolean(f.ordered_at) || i >= IDX.done;
    case 'cutting':
      return i >= IDX.in_progress;
    case 'install':
    case 'handover':
      return i >= IDX.done;
    case 'payments': {
      const due = amountDue(f);
      return f.status === 'paid' || (due !== null && (f.paid_total ?? 0) >= due - 0.5);
    }
    case 'invoice':
      return f.status === 'paid';
    case 'expenses':
      return (f.expense_count ?? 0) > 0;
    case 'profit':
      return f.status === 'paid';
  }
}

export type Phase = PhaseId | 'closed';

/** The phase the job is in now. `now` is business time "YYYY-MM-DDTHH:MM". */
export function currentPhase(f: JobFacts, now: string): Phase {
  switch (f.status) {
    case 'paid':
    case 'lost':
      return 'closed';
    case 'done':
      return 'payment';
    case 'approved':
    case 'in_progress':
      return 'execution';
    case 'quoted':
      return 'planning';
    case 'lead':
      return 'intake';
    case 'visit':
      // Booked and still ahead: the visit is the next thing. Once it happened, planning starts.
      return f.visit_at && f.visit_at > now ? 'intake' : 'planning';
  }
}

export type NextKind = 'do' | 'wait';

export interface NextAction {
  step: StepId;
  /** Plain words: what to do (or what we are waiting for) */
  label: string;
  kind: NextKind;
  /** A status change the user confirms with one tap ("הלקוח אישר") */
  advance?: { status: JobStatus; label: string };
  /** For the UI to format: a date ("YYYY-MM-DD..."), an amount, or days waiting */
  meta?: { at?: string; amount?: number; days?: number };
}

function daysBetween(fromIso: string, today: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** The one thing to do next on this job, or null once it is closed. */
export function nextAction(f: JobFacts, now: string): NextAction | null {
  const phase = currentPhase(f, now);
  const done = (id: StepId) => isStepDone(id, f);
  const today = now.slice(0, 10);

  if (phase === 'intake') {
    if (!done('client')) return { step: 'client', label: 'להשלים פרטי לקוח', kind: 'do' };
    if (!f.visit_at) return { step: 'visit', label: 'לתאם ביקור ומדידה', kind: 'do' };
    return { step: 'visit', label: 'ביקור ומדידה', kind: 'wait', meta: { at: f.visit_at } };
  }
  if (phase === 'planning') {
    if (!done('site') && f.status === 'visit') return { step: 'site', label: 'לרשום מידות ותמונות מהאתר', kind: 'do' };
    if ((f.model_versions ?? 0) > 0 && !modelApproved(f) && f.status !== 'quoted') {
      return { step: 'model', label: f.model_approved_id ? 'השרטוט השתנה, לאשר מחדש' : 'לסיים את השרטוט ולאשר', kind: 'do' };
    }
    if (!done('boq')) {
      return f.kind === 'fabrication' && !(f.model_versions ?? 0)
        ? { step: 'model', label: 'להתחיל בשרטוט', kind: 'do' }
        : { step: 'boq', label: 'לבנות את המחיר', kind: 'do' };
    }
    if (f.quote_status === 'sent' || (f.status === 'quoted' && f.quote_status !== 'expired' && f.quote_status !== 'rejected')) {
      return {
        step: 'quote',
        label: 'הצעה מחכה לתשובה',
        kind: 'wait',
        advance: { status: 'approved', label: 'הלקוח אישר' },
        meta: f.quote_created_at ? { days: daysBetween(f.quote_created_at, today) } : undefined,
      };
    }
    return { step: 'quote', label: f.quote_status === 'expired' ? 'לשלוח הצעה מעודכנת' : 'לשלוח הצעת מחיר', kind: 'do' };
  }
  if (phase === 'execution') {
    if (!done('orders')) return { step: 'orders', label: 'להזמין חומרים', kind: 'do', meta: f.scheduled_at ? { at: f.scheduled_at } : undefined };
    if (!f.scheduled_at) return { step: 'install', label: 'לקבוע מועד לעבודה', kind: 'do' };
    if (f.status === 'approved') {
      return { step: 'cutting', label: 'לחתוך ולהתחיל בייצור', kind: 'do', advance: { status: 'in_progress', label: 'התחלתי לעבוד' }, meta: { at: f.scheduled_at } };
    }
    return { step: 'handover', label: 'להתקין ולמסור', kind: 'do', advance: { status: 'done', label: 'נמסר ללקוח' }, meta: { at: f.scheduled_at } };
  }
  if (phase === 'payment') {
    const due = amountDue(f);
    const paid = f.paid_total ?? 0;
    if (due !== null && paid < due - 0.5) return { step: 'payments', label: 'לגבות יתרה', kind: 'do', meta: { amount: Math.round((due - paid) * 100) / 100 } };
    if (due === null && paid <= 0) return { step: 'payments', label: 'לרשום תשלום', kind: 'do' };
    return { step: 'profit', label: 'לסגור את העבודה', kind: 'do', advance: { status: 'paid', label: 'העבודה שולמה, לסגור' } };
  }
  return null;
}

export type StepState = 'done' | 'next' | 'todo' | 'optional';

export interface StepStatus extends StepDef {
  state: StepState;
}

/** Every step of a phase with its state, for the job screen */
export function phaseStatus(phase: PhaseId, f: JobFacts, now: string): { steps: StepStatus[]; done: number; total: number } {
  const next = nextAction(f, now);
  const steps = phaseSteps(phase).map((s): StepStatus => {
    const done = isStepDone(s.id, f);
    const optional = isOptional(s, f);
    const state: StepState = done ? 'done' : next?.step === s.id ? 'next' : optional ? 'optional' : 'todo';
    return { ...s, optional, state };
  });
  const required = steps.filter((s) => !s.optional);
  return { steps, done: required.filter((s) => s.state === 'done').length, total: required.length };
}

/** Steps in order for prev / next links between step screens */
export function neighbours(id: StepId): { prev: StepDef | null; next: StepDef | null } {
  const i = STEP_IDS.indexOf(id);
  return { prev: i > 0 ? STEPS[i - 1] : null, next: i < STEPS.length - 1 ? STEPS[i + 1] : null };
}

/** Old links (#/jobs/9/money) keep working */
export const LEGACY_TABS: Record<string, StepId> = { boq: 'boq', model: 'model', orders: 'orders', photos: 'site', money: 'payments', production: 'cutting' };

export interface TodayItem<J> {
  job: J;
  phase: PhaseId;
  action: NextAction;
}

/** Every open job's next action, grouped by phase in order, things to do before things we wait for */
export function todayList<J extends JobFacts>(jobs: J[], now: string): TodayItem<J>[] {
  const order = PHASES.map((p) => p.id);
  const items: TodayItem<J>[] = [];
  for (const job of jobs) {
    const phase = currentPhase(job, now);
    if (phase === 'closed') continue;
    const action = nextAction(job, now);
    if (action) items.push({ job, phase, action });
  }
  return items.sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase) || (a.action.kind === b.action.kind ? 0 : a.action.kind === 'do' ? -1 : 1));
}
