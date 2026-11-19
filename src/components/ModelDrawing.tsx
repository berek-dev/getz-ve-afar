import { useEffect, useMemo, useState } from 'react';
import { shopDrawingSvg } from '../core/drawing.ts';
import type { CutList, ResolvedScene } from '../core/scene.ts';
import { fmtNum } from '../lib/format.ts';
import type { PageSize } from '../core/pdf.ts';
import { fileSlug, shareFile, svgToPdf, svgToPng } from '../lib/share.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

const PAGE_KEY = 'gva:pdf-page';
const savedPage = (): PageSize => {
  try {
    return localStorage.getItem(PAGE_KEY) === 'A3' ? 'A3' : 'A4';
  } catch {
    return 'A4';
  }
};

/** Shop drawing (from the model), to share with the shop as a PDF on A4 or A3, or as an image. Tap to zoom. */
export function ModelDrawing({ scene, cut, businessName }: { scene: ResolvedScene; cut: CutList; businessName: string }) {
  const date = useMemo(() => new Intl.DateTimeFormat('he-IL').format(new Date()), []);
  const sheetFor = (page?: PageSize) => shopDrawingSvg(scene, { cut, business: businessName, date, page });
  const svg = useMemo(() => shopDrawingSvg(scene, { cut, business: businessName, date }), [scene, cut, businessName, date]);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'png' | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [page, setPage] = useState<PageSize>(savedPage);
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

  const pickPage = (p: PageSize) => {
    setPage(p);
    setPending(null);
    try {
      localStorage.setItem(PAGE_KEY, p);
    } catch {
      // storage blocked: the choice lasts until the screen closes
    }
  };

  const share = async (kind: 'pdf' | 'png') => {
    setBusy(kind);
    try {
      const file =
        kind === 'pdf'
          ? new File([await svgToPdf(page === 'A3' ? svg : sheetFor('A4'), page, scene.title)], `${name}-${page}.pdf`, { type: 'application/pdf' })
          : new File([await svgToPng(svg, 3400)], `${name}.png`, { type: 'image/png' });
      const r = await shareFile(file, scene.title);
      if (r === 'needs_tap') setPending(file);
      else if (r === 'downloaded') toast('השרטוט נשמר בהורדות');
    } catch {
      toast(kind === 'pdf' ? 'לא הצלחתי להכין PDF. אפשר לשתף כתמונה' : 'לא הצלחתי להכין תמונה');
    } finally {
      setBusy(null);
    }
  };

  const sheet = <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;

  return (
    <section aria-label="שרטוט ייצור">
      <button
        type="button"
        onClick={() => setZoom(true)}
        aria-label="הגדלת השרטוט"
        className="block w-full overflow-hidden rounded-md border border-line bg-white"
      >
        {sheet}
      </button>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[0.9rem] text-muted">גודל דף</span>
        <div className="grid grid-cols-2 rounded-md border border-line-strong bg-card p-0.5" role="radiogroup" aria-label="גודל דף">
          {(['A4', 'A3'] as PageSize[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={page === p}
              onClick={() => pickPage(p)}
              className={`min-h-10 min-w-14 rounded-[5px] px-3 text-[0.9rem] font-semibold ${page === p ? 'bg-ink text-white' : 'text-muted'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
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
          <button type="button" onClick={() => void share('pdf')} disabled={busy !== null} className="btn-primary">
            <Icon name="printer" />
            {busy === 'pdf' ? 'מכין...' : 'שתף PDF'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void share('png')}
          disabled={busy !== null}
          className="flex min-h-12 items-center justify-center gap-2 rounded-md border border-line-strong font-semibold disabled:opacity-50"
        >
          <Icon name="share" size={20} />
          {busy === 'png' ? 'מכין...' : 'שתף כתמונה'}
        </button>
      </div>


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

/** Cut list from the model: piece marks as on the drawing, count and cut length. */
export function CutListTable({ cut }: { cut: CutList }) {
  return (
    <div>
      <table className="tnum w-full text-[0.95rem]">
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
              <td className="py-2.5 font-bold text-accent">{p.mark}</td>
              <td className="py-2.5">
                {p.name}
                {p.bent && <span className="text-muted"> (מכופף)</span>}
              </td>
              <td className="py-2.5 text-end">{p.count}</td>
              <td className="py-2.5 text-end font-semibold">{fmtNum(p.length)}</td>
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
      <p className="mt-2 text-sm text-faint">אורך לפי מרכז הפרופיל, חיבורי קצה ישרים. בודקים מידות באתר לפני חיתוך.</p>
    </div>
  );
}
