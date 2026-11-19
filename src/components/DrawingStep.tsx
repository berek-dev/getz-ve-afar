import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';
import type { JobModel } from '../lib/api.ts';
import { cutList, prepareScene } from '../core/scene.ts';
import type { CutPlan } from '../core/quantities.ts';
import { fmtMeters, fmtNum } from '../lib/format.ts';
import { ModelDrawing } from './ModelDrawing.tsx';
import { CutPlanView } from './CutPlanView.tsx';

/** Shop drawing and cut list from the 3D model, and the bar cutting plan from the BOQ. Loaded lazily. */
export default function DrawingStep({
  jobId,
  cutPlans,
  businessName,
  barLengthMm,
  kerfMm,
}: {
  jobId: number;
  cutPlans: CutPlan[];
  businessName: string;
  barLengthMm: number;
  kerfMm: number;
}) {
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

  return (
    <div>
      {model === null && <p className="text-muted">טוען...</p>}
      {model === 'none' && (
        <p className="plate rounded-md p-4 text-muted">
          שרטוט ייצור ורשימת חיתוך עם סימון חלקים נוצרים מההדמיה.{' '}
          <a href={`#/jobs/${jobId}/model`} className="font-semibold text-accent underline underline-offset-4">
            ליצירת הדמיה
          </a>
        </p>
      )}
      {ok && cut && (
        <div className="-mt-8">
          <ModelDrawing scene={ok.scene} cut={cut} businessName={businessName} />
        </div>
      )}

      {cutPlans.length > 0 && (
        <section className="mt-8" aria-labelledby="bars-title">
          <h2 id="bars-title" className="px-1 text-[1.05rem] font-bold">
            חיתוך מוטות
          </h2>
          <p className="mt-1 px-1 text-[0.85rem] text-muted">
            מוט של {fmtMeters(barLengthMm)}, {fmtNum(kerfMm)} מ״מ פחת בכל חיתוך, לפי כתב הכמויות. החלקים הארוכים נחתכים ראשונים; המקווקו הוא שארית.
          </p>
          <div className="mt-3 space-y-3">
            {cutPlans.map((plan) => (
              <CutPlanView key={plan.key} plan={plan} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
