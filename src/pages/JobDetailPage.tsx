import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import type { JobDetail } from '../lib/api.ts';
import { JOB_KIND_LABELS, JOB_STATUS_LABELS, UNIT_LABELS, UNIT_PER } from '../core/types.ts';
import type { Element, JobItem, Settings } from '../core/types.ts';
import { computeJob, isCutLine, lineTotal } from '../core/quantities.ts';
import { formatIls } from '../core/money.ts';
import { STAGES } from '../core/stages.ts';
import { fmtMeters, fmtNum } from '../lib/format.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { StageBar, stageColor } from '../components/StageBar.tsx';
import { ItemForm } from '../components/ItemSheet.tsx';
import { CutPlanView } from '../components/CutPlanView.tsx';
import { JobForm } from '../components/JobForm.tsx';
import { QuoteSection } from '../components/QuoteSection.tsx';
import { toast } from '../components/Toast.tsx';

const NO_GROUP = 'שונות';

export function JobDetailPage({ jobId }: { jobId: number }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [elements, setElements] = useState<Element[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<JobItem | 'new' | null>(null);
  const [editingJob, setEditingJob] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setJob(null);
    Promise.all([api.job(jobId), api.settings(), api.elements()])
      .then(([j, s, e]) => {
        setJob(j);
        setSettings(s);
        setElements(e);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [jobId]);

  const totals = useMemo(() => (job && settings ? computeJob(job.items, settings) : null), [job, settings]);

  const groups = useMemo(() => {
    const map = new Map<string, JobItem[]>();
    for (const item of job?.items ?? []) {
      const key = item.group_name ?? NO_GROUP;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [job]);

  if (error) {
    return (
      <div>
        <BackLink />
        <p className="mt-4 rounded-[10px] border border-primer bg-primer/15 p-3 text-primer-light" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!job || !settings || !totals) {
    return (
      <div>
        <BackLink />
        <p className="mt-6 text-steel-300">טוען את העבודה...</p>
      </div>
    );
  }

  const where = [job.client_name ?? 'בלי לקוח', job.site_address].filter(Boolean).join(', ');
  const next = STAGES[job.status].nextStep;
  const barsBought = totals.cutPlans.reduce((s, p) => s + p.bars.length, 0);
  const metersBought = totals.cutPlans.reduce((s, p) => s + p.boughtLengthMm, 0);
  const metersNet = totals.cutPlans.reduce((s, p) => s + p.netLengthMm, 0);
  const offcutCost = totals.materials - totals.materialsNet;

  const saved = (item: JobItem, isNew: boolean) => {
    setJob((j) =>
      j ? { ...j, items: isNew ? [...j.items, item] : j.items.map((i) => (i.id === item.id ? item : i)) } : j,
    );
    setEditing(null);
    toast(isNew ? 'השורה נוספה' : 'השורה עודכנה');
  };

  const deleted = (itemId: number) => {
    setJob((j) => (j ? { ...j, items: j.items.filter((i) => i.id !== itemId) } : j));
    setEditing(null);
    toast('השורה נמחקה');
  };

  return (
    <article>
      <BackLink />

      <header className="mt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-steel-300">{JOB_KIND_LABELS[job.kind]}</p>
            <h1 className="mt-0.5 text-2xl font-semibold leading-snug">{job.title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setEditingJob(true)}
            aria-label="עריכת פרטי העבודה"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-steel-700 text-steel-300"
          >
            <Icon name="pencil" size={18} />
          </button>
        </div>
        <p className="mt-1 text-steel-300">{where}</p>
        <div className="mt-4">
          <StageBar status={job.status} />
          <p className="mt-2 text-[0.95rem]">
            <span className="font-semibold" style={{ color: stageColor(job.status) }}>
              {JOB_STATUS_LABELS[job.status]}
            </span>
            {next && <span className="text-steel-300">. הצעד הבא: {next}</span>}
          </p>
        </div>
        {job.description && (
          <p className="mt-4 whitespace-pre-line rounded-[10px] bg-steel-800 p-3 text-[0.95rem] leading-relaxed text-steel-300">
            {job.description}
          </p>
        )}
      </header>

      {/* The number the whole screen is about */}
      <section className="plate mt-6 rounded-[10px] p-4" aria-labelledby="price-title">
        <h2 id="price-title" className="text-steel-300">
          מחיר ללקוח, כולל מע״מ
        </h2>
        <p className="tnum mt-1 font-display text-[3.75rem] leading-none text-hivis">{formatIls(totals.price.total)}</p>
        {job.items.length === 0 ? (
          <p className="mt-3 text-steel-300">המחיר יופיע ברגע שתוסיף שורות לכתב הכמויות.</p>
        ) : (
          <dl className="tnum mt-4 space-y-1.5 border-t border-steel-700 pt-3 text-[0.95rem]">
            <PriceRow label="חומרים" value={totals.materials} />
            <PriceRow label="עבודה" value={totals.labor} />
            <PriceRow label={`הוצאות כלליות (${fmtNum(settings.overhead_pct)}%)`} value={totals.price.overhead} />
            <PriceRow label={`רווח (${fmtNum(settings.margin_pct)}%)`} value={totals.price.margin} />
            <PriceRow label={`מע״מ (${fmtNum(settings.vat_pct)}%)`} value={totals.price.vat} />
            <div className="flex justify-between border-t border-steel-700 pt-1.5 text-steel-300">
              <dt>לפני מע״מ</dt>
              <dd>{formatIls(totals.price.beforeVat)}</dd>
            </div>
          </dl>
        )}
        {barsBought > 0 && offcutCost > 0.005 && (
          <p className="mt-3 text-sm leading-snug text-steel-300">
            הברזל מתומחר לפי {barsBought} מוטות שקונים ({fmtMeters(metersBought)}), לא רק לפי {fmtMeters(metersNet)} שנכנסים
            לעבודה. הפחת מוסיף {formatIls(offcutCost)} לחומרים.
          </p>
        )}
      </section>

      <QuoteSection
        job={job}
        currentTotal={totals.price.total}
        businessName={settings.business_name}
        onJobStatusMaybeChanged={() => {
          void api.job(job.id).then((j) => setJob((prev) => (prev ? { ...prev, status: j.status } : prev)));
        }}
      />

      <section className="mt-8" aria-labelledby="boq-title">
        <div className="flex items-center justify-between">
          <h2 id="boq-title" className="font-display text-[2.2rem] leading-none">
            כתב כמויות
          </h2>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-hivis px-3 font-semibold text-hivis"
          >
            <Icon name="plus" size={20} />
            שורה
          </button>
        </div>

        {job.items.length === 0 ? (
          <div className="mt-4 rounded-[10px] border-2 border-dashed border-steel-700 px-5 py-8 text-center">
            <p className="text-steel-300">
              עוד אין שורות. כל פרופיל, פרזול, צביעה ושעת עבודה הם שורה. המחיר והחיתוך מחושבים מהן.
            </p>
            <button type="button" onClick={() => setEditing('new')} className="btn-primary mt-4">
              <Icon name="plus" />
              הוסף שורה ראשונה
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {groups.map(([name, items]) => (
              <div key={name}>
                <h3 className="mb-1 text-sm font-semibold text-steel-300">{name}</h3>
                <ul className="plate divide-y divide-steel-700 rounded-[10px]">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start active:bg-steel-700"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold leading-snug">{item.description}</span>
                          <span className="tnum mt-0.5 block text-sm text-steel-300">{quantityText(item)}</span>
                        </span>
                        <span className="tnum shrink-0 font-semibold">{formatIls(lineTotal(item))}</span>
                        <Icon name="forward" size={18} className="shrink-0 text-steel-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {totals.cutPlans.length > 0 && (
        <section className="mt-8" aria-labelledby="cut-title">
          <h2 id="cut-title" className="flex items-center gap-2 font-display text-[2.2rem] leading-none">
            <Icon name="saw" size={26} className="text-steel-300" />
            חיתוך מוטות
          </h2>
          <p className="mt-1 text-sm text-steel-300">
            מוט של {fmtMeters(settings.bar_length_mm)}, {fmtNum(settings.kerf_mm)} מ״מ פחת בכל חיתוך. החתיכות הארוכות נחתכות
            ראשונות; האזור המקווקו הוא שארית.
          </p>
          <div className="mt-3 space-y-3">
            {totals.cutPlans.map((plan) => (
              <CutPlanView key={plan.key} plan={plan} />
            ))}
          </div>
        </section>
      )}

      {totals.weightKg > 0 && (
        <p className="tnum mt-6 text-steel-300">משקל ברזל משוער: {fmtNum(Math.round(totals.weightKg))} ק״ג</p>
      )}

      <Sheet open={editingJob} onClose={() => { setEditingJob(false); setConfirmDelete(false); }} title="פרטי העבודה">
        {editingJob && (
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
                setJob((j) => (j ? { ...j, ...updated } : j));
                setEditingJob(false);
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
                  setError(errorMessage(e));
                }
              }}
              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border font-semibold ${
                confirmDelete ? 'border-primer bg-primer text-soapstone' : 'border-steel-700 text-primer-light'
              }`}
            >
              <Icon name="trash" size={20} />
              {confirmDelete ? 'לחץ שוב: העבודה וכל השורות שלה יימחקו' : 'מחק עבודה'}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'שורה חדשה' : 'עריכת שורה'}
      >
        {editing !== null && (
          <ItemForm
            key={editing === 'new' ? 'new' : editing.id}
            jobId={job.id}
            item={editing === 'new' ? null : editing}
            elements={elements}
            groups={groups.map(([g]) => g).filter((g) => g !== NO_GROUP)}
            onSaved={saved}
            onDeleted={deleted}
          />
        )}
      </Sheet>
    </article>
  );
}

function BackLink() {
  return (
    <a href="#/jobs" className="-ms-2 inline-flex min-h-11 items-center gap-1 px-2 font-semibold text-steel-300">
      <Icon name="back" size={20} />
      כל העבודות
    </a>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-steel-300">{label}</dt>
      <dd>{formatIls(value)}</dd>
    </div>
  );
}

function quantityText(item: JobItem): string {
  if (isCutLine(item)) {
    return `${item.pieces} × ${fmtNum(item.length_mm ?? 0)} מ״מ = ${fmtNum(item.quantity)} מ׳, ${formatIls(item.unit_cost)} למטר`;
  }
  return `${fmtNum(item.quantity)} ${UNIT_LABELS[item.unit]}, ${formatIls(item.unit_cost)} ${UNIT_PER[item.unit]}`;
}
