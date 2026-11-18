import { useMemo } from 'react';
import { cutList, prepareScene } from '../core/scene.ts';
import { ModelView } from './ModelView.tsx';

/** The 3D model on the client's quote page (loaded lazily). Prices and the cut list stay out. */
export default function ClientModel({ layout }: { layout: unknown }) {
  const prepared = useMemo(() => prepareScene(layout), [layout]);
  const cut = useMemo(() => (prepared.errors.length ? null : cutList(prepared.scene)), [prepared]);
  if (!cut) return null;
  return (
    <section className="no-print mt-6" aria-labelledby="model-title">
      <h2 id="model-title" className="text-lg font-semibold">
        הדמיה
      </h2>
      <p className="mt-0.5 text-sm text-steel-300">מסובבים באצבע, מגדילים בשתי אצבעות. המידות במילימטרים.</p>
      <ModelView prepared={prepared} cut={cut} designKey="client" title={prepared.scene.title} showGround={false} />
    </section>
  );
}
