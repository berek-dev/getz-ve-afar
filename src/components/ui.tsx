/** Small shared pieces of the "shop sheet" look. */
import type { ReactNode } from 'react';
import { PHASES } from '../core/phases.ts';
import type { NextAction, Phase, PhaseId } from '../core/phases.ts';
import { formatIls } from '../core/money.ts';
import { fmtShortDay, fmtSlotTime } from '../lib/format.ts';
import { businessToday } from '../core/calendar.ts';

export const phaseNumber = (p: PhaseId) => PHASES.findIndex((x) => x.id === p) + 1;
export const phaseTitle = (p: Phase) => (p === 'closed' ? 'סגורה' : (PHASES.find((x) => x.id === p)?.title ?? ''));

/** A numbered circle, like a part mark on the shop drawing */
export function Mark({ n, state = 'todo', label }: { n: number | string; state?: 'todo' | 'done' | 'next'; label?: string }) {
  return (
    <span className={`mark ${state === 'done' ? 'mark-done' : state === 'next' ? 'mark-next' : ''}`} aria-label={label} aria-hidden={label ? undefined : true}>
      {n}
    </span>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-5">
      {eyebrow && <p className="text-[0.9rem] text-muted">{eyebrow}</p>}
      <h1 className="text-[1.75rem] font-bold leading-tight">{title}</h1>
      {children}
    </header>
  );
}

export function SectionTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
      <h2 id={id} className="text-[0.95rem] font-semibold">
        {children}
      </h2>
      {aside && <span className="text-[0.8rem] text-muted">{aside}</span>}
    </div>
  );
}

/** What goes at the end of a "next action" row: since when, until when, how much */
export function actionMeta(a: NextAction): { text: string; urgent: boolean } | null {
  if (a.meta?.amount != null) return { text: formatIls(a.meta.amount), urgent: false };
  if (a.meta?.days != null) return { text: a.meta.days === 0 ? 'היום' : a.meta.days === 1 ? 'יום אחד' : `${a.meta.days} ימים`, urgent: a.meta.days >= 5 };
  if (a.meta?.at) {
    const today = businessToday();
    const day = a.meta.at.slice(0, 10);
    const when = day === today ? `היום ${fmtSlotTime(a.meta.at)}` : day < today ? `עבר, ${fmtShortDay(a.meta.at)}` : fmtShortDay(a.meta.at);
    return { text: when, urgent: day <= today };
  }
  return null;
}
