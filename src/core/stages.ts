import type { JobStatus } from './types.ts';

/** The normal life of a job, first call to paid. `lost` sits outside this line. */
export const STAGE_ORDER: readonly JobStatus[] = ['lead', 'visit', 'quoted', 'approved', 'in_progress', 'done', 'paid'];

export interface StageInfo {
  /** What Yaal should do next, in plain words. Null when the job is closed. */
  nextStep: string | null;
  /** Button text: what he says once he has done it. Moves the job to `next`. */
  advanceLabel: string | null;
  next: JobStatus | null;
}

export const STAGES: Record<JobStatus, StageInfo> = {
  lead: { nextStep: 'לתאם ביקור אצל הלקוח', advanceLabel: 'תיאמתי ביקור', next: 'visit' },
  visit: { nextStep: 'למדוד ולשלוח הצעת מחיר', advanceLabel: 'שלחתי הצעה', next: 'quoted' },
  quoted: { nextStep: 'לקבל אישור מהלקוח', advanceLabel: 'הלקוח אישר', next: 'approved' },
  approved: { nextStep: 'להזמין חומרים ולהתחיל', advanceLabel: 'התחלתי לעבוד', next: 'in_progress' },
  in_progress: { nextStep: 'לסיים ולהתקין', advanceLabel: 'סיימתי את העבודה', next: 'done' },
  done: { nextStep: 'לגבות תשלום', advanceLabel: 'קיבלתי תשלום', next: 'paid' },
  paid: { nextStep: null, advanceLabel: null, next: null },
  lost: { nextStep: null, advanceLabel: null, next: null },
};

/** 0-based position on the line, or -1 for `lost`. */
export function stageIndex(status: JobStatus): number {
  return STAGE_ORDER.indexOf(status);
}

/** Open = still needs something from Yaal (including collecting payment). */
export function isOpen(status: JobStatus): boolean {
  return status !== 'paid' && status !== 'lost';
}
