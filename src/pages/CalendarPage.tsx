import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, TouchEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { addDays, addMonths, businessNow, businessToday, eventSegments, jobEvents, layoutDay, monthGrid, weekDays, weekStart } from '../core/calendar.ts';
import type { EventSegment, JobEvent } from '../core/calendar.ts';
import { fmtHours, fmtLongDay, fmtMonth, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader, SectionTitle } from '../components/ui.tsx';

export function wazeLink(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

type View = 'list' | 'week' | 'month';
const VIEWS: { id: View; label: string }[] = [
  { id: 'list', label: 'רשימה' },
  { id: 'week', label: 'שבוע' },
  { id: 'month', label: 'חודש' },
];
const VIEW_KEY = 'gva:calendar-view';
const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const HOUR_PX = 44;

type Seg = EventSegment<Job>;

function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'month' ? v : 'week';
  } catch {
    return 'week';
  }
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const stepOf = (e: JobEvent<Job>) => (e.kind === 'visit' ? 'visit' : 'install');
const rangeFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const utc = (d: string) => new Date(`${d}T00:00:00Z`);

/** Visits and work days: what's next as a list, or the week and month at a glance like a phone calendar. */
export function CalendarPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(savedView);
  const today = businessToday();
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);

  useEffect(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // the choice just isn't remembered
    }
  };

  const byDay = useMemo(() => {
    const map = new Map<string, Seg[]>();
    for (const e of jobEvents(jobs ?? [], { history: true })) {
      for (const s of eventSegments(e)) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startMin - b.startMin);
    return map;
  }, [jobs]);

  const move = (dir: 1 | -1) => {
    const next = view === 'month' ? addMonths(anchor, dir) : addDays(anchor, 7 * dir);
    setAnchor(next);
    const inPeriod = view === 'month' ? today.slice(0, 7) === next.slice(0, 7) : weekStart(today) === weekStart(next);
    setSelected(inPeriod ? today : view === 'month' ? `${next.slice(0, 7)}-01` : weekStart(next));
  };
  const goToday = () => {
    setAnchor(today);
    setSelected(today);
  };

  const days = view === 'week' ? weekDays(anchor) : [];
  const title =
    view === 'month'
      ? fmtMonth(anchor.slice(0, 7))
      : rangeFmt.formatRange(utc(days[0] ?? anchor), utc(days[6] ?? anchor));
  const showsToday = view === 'month' ? anchor.slice(0, 7) === today.slice(0, 7) : weekStart(anchor) === weekStart(today);

  return (
    <div>
      <PageHeader title="יומן">
        <div className="mt-3 grid grid-cols-3 rounded-md border border-line-strong bg-card p-0.5" role="tablist" aria-label="תצוגה">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`min-h-10 rounded-[5px] text-[0.9rem] font-semibold ${view === v.id ? 'bg-ink text-white' : 'text-muted'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {error && (
        <p className="mb-4 rounded-md border border-danger bg-danger-soft p-3 text-danger" role="alert">
          {error}
        </p>
      )}
      {!jobs && !error && <p className="text-muted">טוען...</p>}

      {jobs && view === 'list' && <ListView jobs={jobs} today={today} />}

      {jobs && view !== 'list' && (
        <>
          <div className="mb-2 flex items-center gap-1">
            <button type="button" onClick={() => move(-1)} aria-label={view === 'month' ? 'החודש הקודם' : 'השבוע הקודם'} className="grid h-11 w-11 place-items-center rounded-md text-ink active:bg-sunken">
              <Icon name="back" size={22} />
            </button>
            <h2 className="tnum flex-1 text-center font-semibold" aria-live="polite">
              {title}
            </h2>
            <button type="button" onClick={() => move(1)} aria-label={view === 'month' ? 'החודש הבא' : 'השבוע הבא'} className="grid h-11 w-11 place-items-center rounded-md text-ink active:bg-sunken">
              <Icon name="forward" size={22} />
            </button>
          </div>
          {!showsToday && (
            <button type="button" onClick={goToday} className="mx-auto mb-2 block min-h-9 rounded-md border border-line-strong bg-card px-4 text-[0.85rem] font-semibold">
              חזרה להיום
            </button>
          )}

          <Swipe onSwipe={move}>
            {view === 'week' ? (
              <WeekView days={days} byDay={byDay} today={today} selected={selected} onSelect={setSelected} />
            ) : (
              <MonthView anchor={anchor} byDay={byDay} today={today} selected={selected} onSelect={setSelected} />
            )}
          </Swipe>
          <p className="mt-2 flex items-center gap-4 px-1 text-[0.8rem] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[2px] border-s-[3px] border-accent bg-accent-soft" aria-hidden="true" />
              עבודה
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-[2px] border-s-[3px] border-ink bg-sunken" aria-hidden="true" />
              ביקור ומדידה
            </span>
          </p>

          <DayAgenda date={selected} today={today} segments={byDay.get(selected) ?? []} />
        </>
      )}

      {jobs && <WaitingLists jobs={jobs} today={today} />}
    </div>
  );
}

/** Swiping the grid sideways moves a week or a month (in right-to-left, the next period is to the left) */
function Swipe({ onSwipe, children }: { onSwipe: (dir: 1 | -1) => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      onTouchStart={(e: TouchEvent) => {
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e: TouchEvent) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx > 0 ? 1 : -1);
      }}
    >
      {children}
    </div>
  );
}

const closed = (job: Job) => job.status === 'done' || job.status === 'paid';

function blockClass(seg: Seg): string {
  const kind = seg.event.kind === 'work' ? 'border-accent bg-accent-soft' : 'border-ink bg-sunken';
  return `${kind} border-s-[3px] text-ink ${closed(seg.event.job) ? 'opacity-55' : ''}`;
}

// ------------------------------------------------------------------------------------------------ week

function WeekView({
  days,
  byDay,
  today,
  selected,
  onSelect,
}: {
  days: string[];
  byDay: Map<string, Seg[]>;
  today: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const segs = days.flatMap((d) => byDay.get(d) ?? []);
  const fromH = Math.min(7, ...segs.map((s) => Math.floor(s.startMin / 60)));
  const toH = Math.max(19, ...segs.map((s) => Math.ceil(s.endMin / 60)));
  const hours = Array.from({ length: toH - fromH }, (_, i) => fromH + i);
  const height = (toH - fromH) * HOUR_PX;
  const now = businessNow();
  const nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16));

  return (
    <div className="plate overflow-hidden rounded-md">
      <div className="grid grid-cols-[2.4rem_repeat(7,minmax(0,1fr))] border-b border-line">
        <span />
        {days.map((d, i) => (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={selected === d}
            aria-label={fmtLongDay(d)}
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 ${selected === d ? 'bg-sunken' : ''}`}
          >
            <span className="text-[0.7rem] text-muted">{WEEKDAYS[i]}</span>
            <span
              className={`tnum grid h-7 w-7 place-items-center rounded-full text-[0.9rem] font-semibold ${
                d === today ? 'bg-accent text-white' : selected === d ? 'border border-ink' : ''
              }`}
            >
              {Number(d.slice(8))}
            </span>
          </button>
        ))}
      </div>
      <div className="relative grid grid-cols-[2.4rem_repeat(7,minmax(0,1fr))]" style={{ height }}>
        {hours.map((h, i) => (
          <div key={h} className="pointer-events-none absolute inset-x-0 z-[1] border-t border-line" style={{ top: i * HOUR_PX }}>
            <span className="tnum absolute -top-[0.45rem] start-1 bg-card px-0.5 text-[0.62rem] text-faint">{i > 0 ? `${h}:00` : ''}</span>
          </div>
        ))}
        <span />
        {days.map((d, i) => (
          <div key={d} className={`relative border-s border-line ${i === 6 ? 'bg-sunken/60' : ''}`}>
            {layoutDay(byDay.get(d) ?? []).map((s) => {
              const top = ((s.startMin - fromH * 60) / 60) * HOUR_PX;
              const h = Math.max(20, ((s.endMin - s.startMin) / 60) * HOUR_PX - 2);
              return (
                <a
                  key={`${s.event.job.id}-${s.event.kind}-${s.part}`}
                  href={`#/jobs/${s.event.job.id}/${stepOf(s.event)}`}
                  className={`absolute z-[2] overflow-hidden rounded-[3px] px-0.5 py-0.5 text-[0.62rem] leading-tight ${blockClass(s)}`}
                  style={{ top: top + 1, height: h, width: `calc(${100 / s.cols}% - 2px)`, insetInlineStart: `calc(${(100 / s.cols) * s.col}% + 1px)` }}
                  aria-label={`${s.event.kind === 'visit' ? 'ביקור' : 'עבודה'}: ${s.event.job.title}, ${fmtLongDay(d)} ${hhmm(s.startMin)}`}
                >
                  <span className="tnum block text-muted">{hhmm(s.startMin)}</span>
                  <span className="block font-semibold [overflow-wrap:anywhere]">{s.event.job.title}</span>
                </a>
              );
            })}
            {d === today && nowMin >= fromH * 60 && nowMin <= toH * 60 && (
              <span
                className="pointer-events-none absolute inset-x-0 z-[3] border-t-2 border-accent"
                style={{ top: ((nowMin - fromH * 60) / 60) * HOUR_PX }}
                aria-hidden="true"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------- month

function MonthView({
  anchor,
  byDay,
  today,
  selected,
  onSelect,
}: {
  anchor: string;
  byDay: Map<string, Seg[]>;
  today: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const month = anchor.slice(0, 7);
  return (
    <div className="plate overflow-hidden rounded-md">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1.5 text-center text-[0.72rem] text-muted">
            {w}
          </span>
        ))}
      </div>
      {monthGrid(anchor).map((week) => (
        <div key={week[0]} className="grid grid-cols-7 border-b border-line last:border-b-0">
          {week.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const outside = d.slice(0, 7) !== month;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelect(d)}
                aria-pressed={selected === d}
                aria-label={`${fmtLongDay(d)}${list.length ? `, ${list.length} ${list.length === 1 ? 'אירוע' : 'אירועים'}` : ''}`}
                className={`flex min-h-[4.6rem] min-w-0 flex-col items-stretch gap-0.5 px-0.5 pb-1 pt-1 text-start ${i > 0 ? 'border-s border-line' : ''} ${
                  selected === d ? 'bg-sunken' : i === 6 ? 'bg-sunken/50' : ''
                }`}
              >
                <span
                  className={`tnum mx-auto grid h-6 w-6 place-items-center rounded-full text-[0.8rem] ${
                    d === today ? 'bg-accent font-semibold text-white' : outside ? 'text-faint' : selected === d ? 'border border-ink font-semibold' : ''
                  }`}
                >
                  {Number(d.slice(8))}
                </span>
                {list.slice(0, 2).map((s) => (
                  <span
                    key={`${s.event.job.id}-${s.event.kind}-${s.part}`}
                    className={`block truncate rounded-[2px] px-0.5 text-[0.6rem] leading-[1.05rem] ${blockClass(s)} ${outside ? 'opacity-50' : ''}`}
                  >
                    {s.event.job.title}
                  </span>
                ))}
                {list.length > 2 && <span className="text-center text-[0.6rem] text-muted">{`+${list.length - 2}`}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayAgenda({ date, today, segments }: { date: string; today: string; segments: Seg[] }) {
  return (
    <section className="mt-5" aria-label={fmtLongDay(date)}>
      <SectionTitle>
        <span className={date === today ? 'text-accent' : undefined}>{date === today ? `היום, ${fmtLongDay(date)}` : fmtLongDay(date)}</span>
      </SectionTitle>
      {segments.length === 0 ? (
        <p className="plate rounded-md px-4 py-3 text-[0.9rem] text-muted">אין ביקורים או עבודות ביום הזה.</p>
      ) : (
        <ul className="plate divide-y divide-line rounded-md">
          {segments.map((s) => (
            <EventRow
              key={`${s.event.job.id}-${s.event.kind}-${s.part}`}
              event={s.event}
              time={hhmm(s.startMin)}
              note={s.parts > 1 ? `יום ${s.part} מתוך ${s.parts}` : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ list

/** What's coming up, nearest first */
function ListView({ jobs, today }: { jobs: Job[]; today: string }) {
  const tomorrow = addDays(today, 1);
  const days = useMemo(() => {
    const byDay = new Map<string, JobEvent<Job>[]>();
    for (const e of jobEvents(jobs)) {
      const d = e.start.slice(0, 10);
      if (d < today) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [jobs, today]);
  const dayTitle = (d: string) => (d === today ? 'היום' : d === tomorrow ? 'מחר' : fmtSlotDay(`${d}T00:00`));

  if (days.length === 0) {
    return <p className="plate rounded-md p-5 text-center text-muted">אין מועדים קרובים.</p>;
  }
  return (
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
  );
}

function EventRow({ event: e, time, note }: { event: JobEvent<Job>; time?: string; note?: string }) {
  const job = e.job;
  return (
    <li className="flex items-stretch">
      <a href={`#/jobs/${job.id}/${stepOf(e)}`} className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 active:bg-sunken">
        <span className="tnum w-12 shrink-0">
          <span className="block font-semibold leading-tight">{time ?? fmtSlotTime(e.start)}</span>
          {e.kind === 'work' && job.scheduled_hours ? <span className="block text-xs text-muted">{fmtHours(job.scheduled_hours)}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.85rem] text-muted">
            {e.kind === 'visit' ? 'ביקור ומדידה' : 'עבודה'}
            {note ? `, ${note}` : ''}
          </span>
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

// ------------------------------------------------------------------------------------- still to date

function WaitingLists({ jobs, today }: { jobs: Job[]; today: string }) {
  const { late, needDate, needVisit } = useMemo(() => {
    const events = jobEvents(jobs);
    return {
      late: events.filter((e) => e.start.slice(0, 10) < today && !(e.kind === 'work' && e.job.status === 'quoted')),
      needDate: jobs.filter((j) => !j.scheduled_at && (j.status === 'approved' || j.status === 'in_progress')),
      needVisit: jobs.filter((j) => !j.visit_at && j.status === 'lead'),
    };
  }, [jobs, today]);
  return (
    <>
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
    </>
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
