/** The screens of a job's steps (src/core/phases.ts), each built from the sections that already existed. */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail, JobMoney } from '../lib/api.ts';
import { JOB_KIND_LABELS, UNIT_LABELS, UNIT_PER } from '../core/types.ts';
import type { Element, Job, JobItem, JobStatus, Settings } from '../core/types.ts';
import { isCutLine, lineTotal } from '../core/quantities.ts';
import type { JobTotals } from '../core/quantities.ts';
import { amountDue, isStepDone } from '../core/phases.ts';
import type { StepId } from '../core/phases.ts';
import { stageIndex } from '../core/stages.ts';
import { formatIls, round2 } from '../core/money.ts';
import { fmtDate, fmtMeters, fmtNum, fmtSlotDay, fmtSlotTime } from '../lib/format.ts';
import { useFeatures } from '../lib/features.ts';
import { appendText, useDictation } from '../lib/speech.ts';
import { Icon } from './Icon.tsx';
import { Sheet } from './Sheet.tsx';
import { JobForm } from './JobForm.tsx';
import { toast } from './Toast.tsx';
import { ItemForm } from './ItemSheet.tsx';
import { QuoteSection } from './QuoteSection.tsx';
import { OrdersSection } from './OrdersSection.tsx';
import { PhotosSection } from './PhotosSection.tsx';
import { JobMoneySection } from './JobMoneySection.tsx';
import { DateBlock } from './ScheduleBlock.tsx';
import { AiDraft, SaveTemplateForm, TemplatePicker } from './BoqTools.tsx';

// three.js, the layout code and the drawing load only on the steps that show them
const ModelSection = lazy(() => import('./ModelSection.tsx'));
const DrawingStep = lazy(() => import('./DrawingStep.tsx'));

export interface JobCtx {
  job: JobDetail;
  settings: Settings;
  elements: Element[];
  totals: JobTotals;
  setJob: (update: (j: JobDetail) => JobDetail) => void;
  /** Merge a job row the server sent back (status, dates...) and keep the lines */
  applyJob: (j: Job) => void;
  reload: () => Promise<void>;
  changeStatus: (s: JobStatus) => Promise<void>;
}

const after = (job: Job, status: JobStatus) => stageIndex(job.status) >= stageIndex(status);
const slot = (at: string) => `${fmtSlotDay(at)}, ${fmtSlotTime(at)}`;

/** One line under each step on the job's overview */
export function stepSummary(id: StepId, ctx: JobCtx): string {
  const { job, totals } = ctx;
  switch (id) {
    case 'client':
      return job.client_name ? [job.client_name, job.client_phone].filter(Boolean).join(', ') : 'חסר שם לקוח';
    case 'description':
      return job.description?.trim() ? job.description.trim().replace(/\s+/g, ' ').slice(0, 70) : 'עוד אין תיאור';
    case 'visit':
      return job.visit_at ? slot(job.visit_at) : isStepDone('visit', job) ? 'היה ביקור' : 'עוד לא נקבע';
    case 'site':
      return [job.site_notes?.trim() ? 'יש מידות' : '', job.photo_count ? `${job.photo_count} תמונות` : ''].filter(Boolean).join(', ') || 'עוד אין מידות ותמונות';
    case 'model':
      return job.model_versions ? `גרסה ${job.model_versions}` : 'מתארים במילים, מקבלים מודל';
    case 'boq':
      return job.items.length ? `${job.items.length} שורות, ${formatIls(totals.price.total)}` : 'עוד אין שורות';
    case 'drawing':
      return job.model_versions ? 'שרטוט A3 ורשימת חיתוך' : totals.cutPlans.length ? 'תוכנית חיתוך מוטות' : 'נוצר מההדמיה';
    case 'schedule':
    case 'install':
      return job.scheduled_at ? slot(job.scheduled_at) : 'עוד לא נקבע';
    case 'quote':
      return job.quote_status === 'approved'
        ? 'הלקוח אישר'
        : job.quote_status === 'sent'
          ? `נשלחה, ${formatIls(job.quote_total ?? 0)}`
          : job.quote_status === 'expired'
            ? 'פג תוקף, צריך גרסה חדשה'
            : 'עוד לא נשלחה';
    case 'orders':
      return job.ordered_at ? `הוזמן ב־${fmtDate(job.ordered_at)}` : 'עוד לא הוזמן';
    case 'production':
      return after(job, 'in_progress') ? 'התחיל' : 'שרטוט וחיתוך לעבודה';
    case 'handover':
      return after(job, 'done') ? 'נמסר ללקוח' : 'תמונות סיום ומסירה';
    case 'payments': {
      const due = amountDue(job);
      const paid = job.paid_total ?? 0;
      return due ? `שולם ${formatIls(paid)} מתוך ${formatIls(due)}` : paid ? `שולם ${formatIls(paid)}` : 'עוד לא התקבל תשלום';
    }
    case 'invoice':
      return 'בתוכנת החשבוניות, ודוח חודשי';
    case 'expenses':
      return job.expense_count ? `${job.expense_count} הוצאות` : 'עוד לא נרשמו';
    case 'profit':
      return 'מה שתוכנן מול מה שיצא';
  }
}

export function StepBody({ step, ctx }: { step: StepId; ctx: JobCtx }) {
  const { job, settings } = ctx;
  const onPhotoCount = useCallback((n: number) => ctx.setJob((j) => (j.photo_count === n ? j : { ...j, photo_count: n })), [ctx]);

  switch (step) {
    case 'client':
      return <ClientStep ctx={ctx} />;
    case 'description':
      return <DescriptionStep ctx={ctx} />;
    case 'visit':
      return (
        <div className="space-y-4">
          <DateBlock job={job} kind="visit" businessName={settings.business_name} onChange={ctx.applyJob} />
          <Hint>הביקור נכנס ליומן של האפליקציה, ואפשר להוסיף אותו גם ליומן בטלפון. במקום רושמים מידות ומצלמים, בצעד הבא.</Hint>
        </div>
      );
    case 'site':
      return (
        <div className="space-y-6">
          <SiteNotes ctx={ctx} />
          <PhotosSection jobId={job.id} onCount={onPhotoCount} />
        </div>
      );
    case 'model':
      return (
        <Suspense fallback={<p className="text-muted">טוען את ההדמיה...</p>}>
          <ModelSection
            job={job}
            businessName={settings.business_name}
            onItems={(items) => ctx.setJob((j) => ({ ...j, items, item_count: items.length }))}
            onVersions={(n) => ctx.setJob((j) => ({ ...j, model_versions: n }))}
          />
        </Suspense>
      );
    case 'boq':
      return <BoqStep ctx={ctx} />;
    case 'drawing':
      return (
        <Suspense fallback={<p className="text-muted">טוען...</p>}>
          <DrawingStep jobId={job.id} cutPlans={ctx.totals.cutPlans} businessName={settings.business_name} barLengthMm={settings.bar_length_mm} kerfMm={settings.kerf_mm} />
        </Suspense>
      );
    case 'schedule':
      return (
        <div className="space-y-4">
          <DateBlock job={job} kind="work" businessName={settings.business_name} onChange={ctx.applyJob} />
          <Hint>מתי מתחילים ולכמה זמן. התאריך נכנס ליומן, ולפיו מזמינים חומרים ומתאמים עם הלקוח.</Hint>
        </div>
      );
    case 'quote':
      return (
        <div>
          <QuoteSection bare job={job} currentTotal={ctx.totals.price.total} businessName={settings.business_name} onJobStatusMaybeChanged={() => void ctx.reload()} />
          {job.status === 'quoted' && (
            <button type="button" onClick={() => void ctx.changeStatus('approved')} className="btn-secondary mt-4 w-full">
              <Icon name="check" size={20} />
              הלקוח אישר בטלפון
            </button>
          )}
        </div>
      );
    case 'orders':
      return <OrdersStep ctx={ctx} />;
    case 'production':
      return (
        <div className="space-y-4">
          {job.status === 'approved' && (
            <button type="button" onClick={() => void ctx.changeStatus('in_progress')} className="btn-primary">
              <Icon name="check" />
              התחלתי לעבוד
            </button>
          )}
          <Suspense fallback={<p className="text-muted">טוען...</p>}>
            <DrawingStep jobId={job.id} cutPlans={ctx.totals.cutPlans} businessName={settings.business_name} barLengthMm={settings.bar_length_mm} kerfMm={settings.kerf_mm} />
          </Suspense>
        </div>
      );
    case 'install':
      return (
        <div className="space-y-4">
          <DateBlock job={job} kind="work" businessName={settings.business_name} onChange={ctx.applyJob} />
          <Hint>יום לפני: אישור ללקוח בוואטסאפ, ניווט לאתר מהכפתור.</Hint>
        </div>
      );
    case 'handover':
      return (
        <div className="space-y-6">
          {!after(job, 'done') && (
            <button type="button" onClick={() => void ctx.changeStatus('done')} className="btn-primary">
              <Icon name="check" />
              נמסר ללקוח
            </button>
          )}
          <PhotosSection jobId={job.id} onCount={onPhotoCount} />
        </div>
      );
    case 'payments':
      return (
        <div className="-mt-4">
          <JobMoneySection
            part="payments"
            job={job}
            currentTotal={ctx.totals.price.total}
            vatPct={settings.vat_pct}
            businessName={settings.business_name}
            onStatus={(s) => void ctx.changeStatus(s)}
          />
        </div>
      );
    case 'invoice':
      return <InvoiceStep />;
    case 'expenses':
      return (
        <div className="-mt-4">
          <JobMoneySection
            part="expenses"
            job={job}
            currentTotal={ctx.totals.price.total}
            vatPct={settings.vat_pct}
            businessName={settings.business_name}
            onStatus={(s) => void ctx.changeStatus(s)}
          />
        </div>
      );
    case 'profit':
      return <ProfitStep ctx={ctx} />;
  }
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 text-[0.9rem] leading-relaxed text-muted">{children}</p>;
}

// ---------------------------------------------------------------------------------------------- intake

function ClientStep({ ctx }: { ctx: JobCtx }) {
  const { job } = ctx;
  const [editing, setEditing] = useState(false);
  const rows: [string, string | null | undefined, string | null][] = [
    ['לקוח', job.client_name, null],
    ['טלפון', job.client_phone, job.client_phone ? `tel:${job.client_phone}` : null],
    ['כתובת', job.site_address, job.site_address ? `https://waze.com/ul?q=${encodeURIComponent(job.site_address)}&navigate=yes` : null],
    ['סוג עבודה', JOB_KIND_LABELS[job.kind], null],
  ];
  return (
    <div className="space-y-4">
      <dl className="plate divide-y divide-line rounded-md">
        {rows.map(([label, value, href]) => (
          <div key={label} className="flex min-h-13 items-center gap-3 px-4 py-2.5">
            <dt className="w-20 shrink-0 text-[0.9rem] text-muted">{label}</dt>
            <dd className="min-w-0 flex-1 font-medium">
              {value ? (
                href ? (
                  <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="text-accent underline-offset-4 hover:underline" dir={label === 'טלפון' ? 'ltr' : undefined}>
                    {value}
                  </a>
                ) : (
                  value
                )
              ) : (
                <span className="text-faint">חסר</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={() => setEditing(true)} className="btn-secondary w-full">
        <Icon name="pencil" size={18} />
        עריכת פרטים
      </button>
      <EditJobSheet ctx={ctx} open={editing} onClose={() => setEditing(false)} />
    </div>
  );
}

function DescriptionStep({ ctx }: { ctx: JobCtx }) {
  const { job } = ctx;
  const [text, setText] = useState(job.description ?? '');
  const [busy, setBusy] = useState(false);
  const mic = useDictation((said) => setText((t) => appendText(t, said)));
  const dirty = text.trim() !== (job.description ?? '').trim();

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateJob(job.id, {
        title: job.title,
        kind: job.kind,
        client_name: job.client_name ?? '',
        client_phone: job.client_phone ?? '',
        site_address: job.site_address ?? '',
        description: text,
      });
      ctx.applyJob(updated);
      toast('התיאור נשמר');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">תיאור העבודה</span>
        <textarea
          className="field min-h-44 leading-relaxed"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="מה הלקוח ביקש, במילים שלו: מה בונים, איפה, מידות משוערות, צבע, מתי צריך."
        />
      </label>
      <div className="flex gap-2">
        {mic.supported && (
          <button type="button" onClick={mic.toggle} aria-pressed={mic.listening} className={`btn-secondary ${mic.listening ? 'border-danger text-danger' : ''}`}>
            <Icon name="mic" size={18} />
            {mic.listening ? 'מקשיב... לסיום' : 'הכתבה'}
          </button>
        )}
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="btn-primary flex-1 disabled:opacity-40">
          {busy ? 'שומר...' : dirty ? 'שמור תיאור' : 'נשמר'}
        </button>
      </div>
      <Hint>התיאור מופיע גם בהצעת המחיר ללקוח, אז בלי מחירים ובלי הערות פנימיות.</Hint>
    </div>
  );
}

function SiteNotes({ ctx }: { ctx: JobCtx }) {
  const { job } = ctx;
  const [text, setText] = useState(job.site_notes ?? '');
  const [busy, setBusy] = useState(false);
  const mic = useDictation((said) => setText((t) => appendText(t, said)));
  const dirty = text.trim() !== (job.site_notes ?? '').trim();

  const save = async () => {
    setBusy(true);
    try {
      ctx.applyJob(await api.jobFields(job.id, { site_notes: text }));
      toast('המידות נשמרו');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="site-notes-title" className="space-y-3">
      <h2 id="site-notes-title" className="px-1 font-semibold">
        מידות והערות מהאתר
      </h2>
      <textarea
        className="field min-h-36 leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="פתח 4,020 מ״מ בין הקירות, גובה 1,800. ריצוף ישר. חשמל למנוע בצד ימין."
        aria-labelledby="site-notes-title"
      />
      <div className="flex gap-2">
        {mic.supported && (
          <button type="button" onClick={mic.toggle} aria-pressed={mic.listening} className={`btn-secondary ${mic.listening ? 'border-danger text-danger' : ''}`}>
            <Icon name="mic" size={18} />
            {mic.listening ? 'מקשיב...' : 'הכתבה'}
          </button>
        )}
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="btn-primary flex-1 disabled:opacity-40">
          {busy ? 'שומר...' : dirty ? 'שמור מידות' : 'נשמר'}
        </button>
      </div>
    </section>
  );
}

export function EditJobSheet({ ctx, open, onClose }: { ctx: JobCtx; open: boolean; onClose: () => void }) {
  const { job } = ctx;
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Sheet
      open={open}
      onClose={() => {
        setConfirmDelete(false);
        onClose();
      }}
      title="פרטי העבודה"
    >
      {open && (
        <div className="space-y-5">
          <JobForm
            initial={{
              title: job.title,
              kind: job.kind,
              client_name: job.client_name ?? '',
              client_phone: job.client_phone ?? '',
              site_address: job.site_address ?? '',
              description: job.description ?? '',
            }}
            submitLabel="שמור שינויים"
            onSubmit={async (draft) => {
              const updated = await api.updateJob(job.id, draft);
              ctx.applyJob(updated);
              onClose();
              toast('פרטי העבודה עודכנו');
            }}
          />
          <button
            type="button"
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              try {
                await api.deleteJob(job.id);
                toast('העבודה נמחקה');
                window.location.hash = '#/jobs';
              } catch (e) {
                toast(errorMessage(e));
              }
            }}
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-md border font-semibold ${
              confirmDelete ? 'border-danger bg-danger text-white' : 'border-line bg-card text-danger'
            }`}
          >
            <Icon name="trash" size={20} />
            {confirmDelete ? 'לחץ שוב: העבודה וכל מה שבה יימחקו' : 'מחק עבודה'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------- planning

const NO_GROUP = 'שונות';
type BoqSheet = 'template-save' | 'template-add' | 'ai' | null;

function quantityText(item: JobItem): string {
  if (isCutLine(item)) {
    return `${item.pieces} יח׳ באורך ${fmtNum(item.length_mm ?? 0)} מ״מ, סה״כ ${fmtNum(item.quantity)} מ׳, ${formatIls(item.unit_cost)} למטר`;
  }
  return `${fmtNum(item.quantity)} ${UNIT_LABELS[item.unit]}, ${formatIls(item.unit_cost)} ${UNIT_PER[item.unit]}`;
}

function BoqStep({ ctx }: { ctx: JobCtx }) {
  const { job, settings, elements, totals } = ctx;
  const features = useFeatures();
  const [editing, setEditing] = useState<JobItem | 'new' | null>(null);
  const [sheet, setSheet] = useState<BoqSheet>(null);

  const groups = useMemo(() => {
    const map = new Map<string, JobItem[]>();
    for (const item of job.items) {
      const key = item.group_name ?? NO_GROUP;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [job.items]);

  const setItems = (items: JobItem[]) => ctx.setJob((j) => ({ ...j, items, item_count: items.length }));
  const offcutCost = totals.materials - totals.materialsNet;
  const barsBought = totals.cutPlans.reduce((s, p) => s + p.bars.length, 0);

  return (
    <div>
      <section className="plate rounded-md p-4" aria-labelledby="price-title">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="price-title" className="text-[0.9rem] text-muted">
            מחיר ללקוח, כולל מע״מ
          </h2>
          <p className="tnum text-[2rem] font-bold leading-none tracking-tight">{formatIls(totals.price.total)}</p>
        </div>
        {job.items.length === 0 ? (
          <p className="mt-3 text-muted">המחיר יופיע ברגע שיהיו שורות בכתב הכמויות.</p>
        ) : (
          <dl className="tnum mt-3 grid grid-cols-2 gap-x-5 gap-y-1 border-t border-line pt-2.5 text-[0.9rem]">
            <PriceRow label="חומרים" value={totals.materials} />
            <PriceRow label="עבודה" value={totals.labor} />
            <PriceRow label={`תקורה ${fmtNum(settings.overhead_pct)}%`} value={totals.price.overhead} />
            <PriceRow label={`רווח ${fmtNum(settings.margin_pct)}%`} value={totals.price.margin} />
            <PriceRow label={`מע״מ ${fmtNum(settings.vat_pct)}%`} value={totals.price.vat} />
            <PriceRow label="לפני מע״מ" value={totals.price.beforeVat} />
          </dl>
        )}
        {barsBought > 0 && offcutCost > 0.005 && (
          <p className="mt-2.5 text-[0.85rem] leading-snug text-muted">
            הברזל מתומחר לפי {barsBought} מוטות שלמים, כולל {formatIls(offcutCost)} של שאריות.
          </p>
        )}
      </section>

      <div className={`mt-3 grid gap-2 ${features.ai ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button type="button" onClick={() => setEditing('new')} className="btn-secondary border-accent text-accent">
          <Icon name="plus" size={18} />
          שורה
        </button>
        <button type="button" onClick={() => setSheet('template-add')} className="btn-secondary">
          <Icon name="layers" size={18} />
          מתבנית
        </button>
        {features.ai && (
          <button type="button" onClick={() => setSheet('ai')} className="btn-secondary">
            <Icon name="sparkles" size={18} />
            מתיאור
          </button>
        )}
      </div>

      {job.items.length === 0 ? (
        <p className="plate mt-3 rounded-md px-5 py-6 text-center text-muted">
          כל פרופיל, פרזול, צביעה ושעת עבודה הם שורה. אפשר להתחיל מתבנית של עבודה קודמת, מתיאור במילים, או מההדמיה.
        </p>
      ) : (
        <div className="plate mt-3 rounded-md">
          {groups.map(([name, items], gi) => (
            <div key={name} className={gi > 0 ? 'border-t border-line' : ''}>
              <h3 className="px-4 pt-2.5 text-[0.78rem] font-semibold text-muted">{name}</h3>
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => setEditing(item)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-start active:bg-sunken">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold leading-snug">{item.description}</span>
                        <span className="tnum block text-[0.85rem] text-muted">{quantityText(item)}</span>
                      </span>
                      {item.unit_cost > 0 ? (
                        <span className="tnum shrink-0 font-semibold">{formatIls(lineTotal(item))}</span>
                      ) : (
                        <span className="shrink-0 rounded-[4px] border border-accent px-1.5 py-0.5 text-[0.8rem] font-semibold text-accent">חסר מחיר</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {totals.weightKg > 0 && (
        <p className="tnum mt-3 px-1 text-[0.9rem] text-muted">
          משקל ברזל משוער {fmtNum(Math.round(totals.weightKg))} ק״ג, {totals.cutPlans.length > 0 ? `${barsBought} מוטות של ${fmtMeters(settings.bar_length_mm)}` : ''}
        </p>
      )}
      {job.items.length > 0 && (
        <button type="button" onClick={() => setSheet('template-save')} className="mt-4 min-h-11 w-full text-[0.9rem] text-muted underline underline-offset-4">
          לשמור את השורות כתבנית לעבודות הבאות
        </button>
      )}

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'template-save' ? 'שמירה כתבנית' : sheet === 'ai' ? 'שורות מתיאור' : 'הוספה מתבנית'}>
        {sheet === 'template-save' && <SaveTemplateForm job={job} onDone={() => setSheet(null)} />}
        {sheet === 'template-add' && (
          <TemplatePicker
            actionLabel="הוסף"
            onPick={async (t) => {
              setItems(await api.applyTemplate(job.id, t.id));
              setSheet(null);
              toast(`נוספו השורות של "${t.name}". עדכן מידות`);
            }}
          />
        )}
        {sheet === 'ai' && (
          <AiDraft
            job={job}
            elements={elements}
            onAdded={(items) => {
              setItems(items);
              setSheet(null);
            }}
          />
        )}
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'שורה חדשה' : 'עריכת שורה'}>
        {editing !== null && (
          <ItemForm
            key={editing === 'new' ? 'new' : editing.id}
            jobId={job.id}
            item={editing === 'new' ? null : editing}
            elements={elements}
            groups={groups.map(([g]) => g).filter((g) => g !== NO_GROUP)}
            onSaved={(item, isNew) => {
              setItems(isNew ? [...job.items, item] : job.items.map((i) => (i.id === item.id ? item : i)));
              setEditing(null);
              toast(isNew ? 'השורה נוספה' : 'השורה עודכנה');
            }}
            onDeleted={(itemId) => {
              setItems(job.items.filter((i) => i.id !== itemId));
              setEditing(null);
              toast('השורה נמחקה');
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd>{formatIls(value)}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- execution

function OrdersStep({ ctx }: { ctx: JobCtx }) {
  const { job } = ctx;
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      ctx.applyJob(await api.jobFields(job.id, { ordered: !job.ordered_at }));
      toast(job.ordered_at ? 'סומן כלא הוזמן' : 'סומן: החומרים הוזמנו');
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="plate flex items-center gap-3 rounded-md p-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${job.ordered_at ? 'bg-ok text-white' : 'border border-line-strong text-faint'}`}>
          <Icon name="check" size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{job.ordered_at ? 'החומרים הוזמנו' : 'עוד לא הוזמן'}</span>
          <span className="block text-[0.85rem] text-muted">{job.ordered_at ? fmtDate(job.ordered_at) : 'שולחים לכל ספק את הרשימה שלו, ומסמנים כאן.'}</span>
        </span>
        <button type="button" onClick={() => void toggle()} disabled={busy} className={job.ordered_at ? 'btn-secondary text-[0.9rem]' : 'btn-secondary border-accent text-[0.9rem] text-accent'}>
          {job.ordered_at ? 'ביטול' : 'הזמנתי'}
        </button>
      </div>
      <OrdersSection job={job} cutPlans={ctx.totals.cutPlans} businessName={ctx.settings.business_name} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- payment

function InvoiceStep() {
  return (
    <div className="space-y-4">
      <div className="plate space-y-2 rounded-md p-4 leading-relaxed">
        <p>חשבונית מס וקבלה עדיין מוציאים בתוכנת החשבוניות שלך. החיבור הישיר יגיע בהמשך, כשנבחר שירות חשבוניות.</p>
        <p className="text-muted">התשלומים וההוצאות שנרשמים כאן נכנסים לדוח החודשי לרואה החשבון.</p>
      </div>
      <a href="#/money" className="btn-secondary w-full">
        <Icon name="wallet" size={18} />
        לדוח החודשי
      </a>
    </div>
  );
}

function ProfitStep({ ctx }: { ctx: JobCtx }) {
  const { job, settings, totals } = ctx;
  const [money, setMoney] = useState<JobMoney | null>(null);
  useEffect(() => {
    api.jobMoney(job.id).then(setMoney, () => undefined);
  }, [job.id]);
  if (!money) return <p className="text-muted">טוען...</p>;

  const vat = 1 + settings.vat_pct / 100;
  const price = money.due ?? totals.price.total;
  const priceNet = round2(price / vat);
  const plannedCost = round2(totals.materials + totals.labor);
  const paid = round2(money.payments.reduce((s, p) => s + p.amount, 0));
  const spentNet = round2(money.expenses.reduce((s, x) => s + x.amount - (x.vat ?? 0), 0));
  const paidNet = round2(paid / vat);

  return (
    <div className="space-y-4">
      <section className="plate rounded-md p-4" aria-label="לפי ההצעה">
        <h2 className="text-[0.9rem] text-muted">לפי ההצעה (לפני מע״מ)</h2>
        <dl className="tnum mt-2 space-y-1">
          <Line label={money.due ? 'מחיר שאושר' : 'מחיר נוכחי'} value={priceNet} />
          <Line label="עלות חומרים ועבודה מתוכננת" value={-plannedCost} />
          <Line label="רווח מתוכנן" value={round2(priceNet - plannedCost)} strong />
        </dl>
      </section>
      <section className="plate rounded-md p-4" aria-label="בפועל">
        <h2 className="text-[0.9rem] text-muted">בפועל עד עכשיו (לפני מע״מ)</h2>
        <dl className="tnum mt-2 space-y-1">
          <Line label="התקבל מהלקוח" value={paidNet} />
          <Line label="הוצאות שנרשמו על העבודה" value={-spentNet} />
          <Line label="נשאר אצלך" value={round2(paidNet - spentNet)} strong />
        </dl>
        <p className="mt-2 text-[0.85rem] text-muted">שעות העבודה שלך לא נכנסות להוצאות; הן חלק ממה שנשאר אצלך.</p>
      </section>
      {job.status === 'done' && (
        <button type="button" onClick={() => void ctx.changeStatus('paid')} className="btn-primary">
          <Icon name="check" />
          העבודה שולמה, לסגור
        </button>
      )}
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-line pt-1.5 font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt>
      <dd className={value < 0 ? 'text-muted' : ''}>{value < 0 ? `−${formatIls(-value)}` : formatIls(value)}</dd>
    </div>
  );
}
