import { useEffect, useMemo, useState } from 'react';
import { shopDrawingSvg } from '../core/drawing.ts';
import type { CutList, ResolvedScene } from '../core/scene.ts';
import { fmtNum } from '../lib/format.ts';
import { downloadFile, fileSlug, shareFile, svgToPng } from '../lib/share.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

/** Shop drawing (A3, from the model) and the cut list, to share with the shop or print. */
export function ModelDrawing({ scene, cut, businessName }: { scene: ResolvedScene; cut: CutList; businessName: string }) {
  const svg = useMemo(
    () => shopDrawingSvg(scene, { cut, business: businessName, date: new Intl.DateTimeFormat('he-IL').format(new Date()) }),
    [scene, cut, businessName],
  );
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const name = `shop-drawing-${fileSlug(scene.title)}`;

  useEffect(() => {
    if (!zoom) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [zoom]);

  const sharePng = async () => {
    setBusy(true);
    try {
      const file = new File([await svgToPng(svg, 3400)], `${name}.png`, { type: 'image/png' });
      const r = await shareFile(file, scene.title);
      if (r === 'needs_tap') setPending(file);
      else if (r === 'downloaded') toast('השרטוט נשמר בהורדות');
    } catch {
      toast('לא הצלחתי להכין תמונה. אפשר להוריד SVG');
    } finally {
      setBusy(false);
    }
  };

  const sheet = <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;

  return (
    <section className="mt-8" aria-labelledby="drawing-title">
      <h2 id="drawing-title" className="text-[1.2rem] font-bold leading-tight">
        שרטוט ייצור
      </h2>
      <p className="mt-1 text-sm text-muted">נוצר מהמודל: מבט חזית, מידות וסימון חלקים. לחיצה מגדילה.</p>
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label="הגדלת השרטוט"
        className="mt-3 block w-full overflow-hidden rounded-md border border-line bg-white"
      >
        {sheet}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {pending ? (
          <button
            type="button"
            onClick={() => {
              void shareFile(pending, scene.title);
              setPending(null);
            }}
            className="btn-primary"
          >
            <Icon name="share" />
            מוכן, שתף
          </button>
        ) : (
          <button type="button" onClick={() => void sharePng()} disabled={busy} className="btn-primary">
            <Icon name="share" />
            {busy ? 'מכין...' : 'שתף כתמונה'}
          </button>
        )}
        <button
          type="button"
          onClick={() => downloadFile(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`)}
          className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-line-strong font-semibold"
        >
          <Icon name="download" size={20} />
          SVG להדפסה
        </button>
      </div>

      <h3 className="mt-6 font-semibold">רשימת חיתוך</h3>
      <table className="tnum mt-2 w-full text-[0.95rem]">
        <thead className="text-start text-sm text-muted">
          <tr>
            <th className="py-1 text-start font-normal">סימון</th>
            <th className="py-1 text-start font-normal">פרופיל</th>
            <th className="py-1 text-end font-normal">כמות</th>
            <th className="py-1 text-end font-normal">אורך (מ״מ)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {cut.pieces.map((p) => (
            <tr key={p.mark}>
              <td className="py-2 font-bold text-accent">{p.mark}</td>
              <td className="py-2">
                {p.name}
                {p.bent && <span className="text-muted"> (מכופף)</span>}
              </td>
              <td className="py-2 text-end">{p.count}</td>
              <td className="py-2 text-end">{fmtNum(p.length)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(cut.plates.length > 0 || cut.parts.length > 0) && (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {cut.plates.map((p) => `${p.name} ${fmtNum(p.w)}/${fmtNum(p.h)}: ${p.count}`).join(', ')}
          {cut.plates.length > 0 && cut.parts.length > 0 && '. '}
          {cut.parts.length > 0 && `פרזול: ${cut.parts.map((p) => `${p.label} ${p.count}`).join(', ')}`}
        </p>
      )}
      <p className="mt-2 text-sm text-faint">
        אורכים לפי מרכז הפרופיל, חיבורי קצה ישרים. משקל משוער {fmtNum(Math.round(cut.totalKg))} ק״ג. בודקים מידות באתר לפני חיתוך.
      </p>

      {zoom && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="שרטוט ייצור">
          <div
            className="flex items-center justify-between gap-2 border-b border-line bg-card px-3"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <p className="min-h-12 truncate py-3 font-semibold">{scene.title}</p>
            <button
              type="button"
              onClick={() => setZoom(false)}
              className="flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold"
            >
              <Icon name="close" size={18} />
              סגור
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain" dir="ltr">
            <div className="w-[260%] max-w-[2400px] sm:w-[160%]">{sheet}</div>
          </div>
        </div>
      )}
    </section>
  );
}
