/** Execution steps that work from the approved 3D model: the shop drawing and the cutting. Loaded lazily. */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api.ts';
import type { JobModel } from '../lib/api.ts';
import type { Job } from '../core/types.ts';
import { cutList, prepareScene } from '../core/scene.ts';
import type { CutPlan } from '../core/quantities.ts';
import { fmtMeters, fmtNum } from '../lib/format.ts';
import { CutListTable, ModelDrawing } from './ModelDrawing.tsx';
import { CutPlanView } from './CutPlanView.tsx';

function useModelScene(jobId: number) {
  const [model, setModel] = useState<JobModel | null | 'none'>(null);
  useEffect(() => {
    api.model(jobId).then(
      (m) => setModel(m.layout ? m : 'none'),
      () => setModel('none'),
    );
  }, [jobId]);
  const prepared = useMemo(() => (model && model !== 'none' ? prepareScene(model.layout) : null), [model]);
  const ok = prepared && prepared.errors.length === 0 ? prepared : null;
  const cut = useMemo(() => (ok ? cutList(ok.scene) : null), [ok]);
  return { loading: model === null, none: model === 'none', scene: ok?.scene ?? null, cut };
}

function ModelNotice({ job, children }: { job: Job; children?: ReactNode }) {
  if (!job.model_versions) {
    return (
      <p className="plate rounded-md p-4 text-muted">
        {children ?? 'נוצר מההדמיה.'}{' '}
        <a href={`#/jobs/${job.id}/model`} className="font-semibold text-accent underline underline-offset-4">
          ליצירת הדמיה
        </a>
      </p>
    );
  }
  if (job.model_approved_id !== job.model_latest_id) {
    return (
      <p className="mb-3 rounded-md bg-accent-soft px-3 py-2.5 text-[0.9rem]">
        {job.model_approved_id ? 'ההדמיה השתנתה מאז שאושרה.' : 'ההדמיה עוד לא אושרה.'}{' '}
        <a href={`#/jobs/${job.id}/model`} className="font-semibold text-accent underline underline-offset-4">
          לאשר
        </a>
      </p>
    );
  }
  return null;
}

export function DrawingStep({ job, businessName }: { job: Job; businessName: string }) {
  const { loading, scene, cut } = useModelScene(job.id);
  return (
    <div>
      <ModelNotice job={job}>שרטוט ייצור עם מידות וסימון חלקים נוצר מההדמיה.</ModelNotice>
      {loading && <p className="text-muted">טוען...</p>}
      {scene && cut && <ModelDrawing scene={scene} cut={cut} businessName={businessName} />}
    </div>
  );
}

export function CuttingStep({
  job,
  cutPlans,
  barLengthMm,
  kerfMm,
  action,
}: {
  job: Job;
  cutPlans: CutPlan[];
  barLengthMm: number;
  kerfMm: number;
  action?: ReactNode;
}) {
  const { scene, cut } = useModelScene(job.id);
  const bars = cutPlans.reduce((s, p) => s + p.bars.length, 0);
  return (
    <div className="space-y-6">
      {action}
      {job.model_versions ? <ModelNotice job={job} /> : null}
      {scene && cut && (
        <section aria-labelledby="pieces-title">
          <h2 id="pieces-title" className="mb-2 px-1 font-semibold">
            חלקים לחיתוך
          </h2>
          <div className="plate rounded-md px-4 py-2">
            <CutListTable cut={cut} />
          </div>
        </section>
      )}
      {cutPlans.length > 0 ? (
        <section aria-labelledby="bars-title">
          <h2 id="bars-title" className="px-1 font-semibold">
            איך לחתוך כל מוט
          </h2>
          <p className="mb-2 px-1 text-[0.85rem] text-muted">
            {bars} מוטות של {fmtMeters(barLengthMm)}, {fmtNum(kerfMm)} מ״מ פחת לכל חיתוך. המקווקו הוא שארית.
          </p>
          <div className="space-y-3">
            {cutPlans.map((plan) => (
              <CutPlanView key={plan.key} plan={plan} />
            ))}
          </div>
        </section>
      ) : (
        !scene && <p className="plate rounded-md p-4 text-muted">אין פרופילים לחיתוך בכתב הכמויות.</p>
      )}
    </div>
  );
}
