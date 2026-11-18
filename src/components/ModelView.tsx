import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CutList, Prepared } from '../core/scene.ts';
import type { PickInfo, Viewer } from '../viewer3d/viewer.js';
import { fileSlug, shareFile } from '../lib/share.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { toast } from './Toast.tsx';

/**
 * The 3D model card: rotate, zoom, tap a part, open and close the gate, full screen.
 * three.js loads only when this mounts (its own chunk). `designKey` changes when a new design starts:
 * the camera is reframed then, and kept while the same design is being changed.
 */
export function ModelView({
  prepared,
  cut,
  designKey,
  title,
  footer,
  overlay,
  showGround = true,
}: {
  prepared: Prepared;
  cut: CutList;
  designKey: string;
  title: string;
  /** Shown under the toolbar in full screen (the chat bar) */
  footer?: ReactNode;
  /** Drawn over the model (e.g. "working on it") */
  overlay?: ReactNode;
  showGround?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const shownKey = useRef<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [pick, setPick] = useState<PickInfo | null>(null);
  const [open, setOpen] = useState(0);
  const [movers, setMovers] = useState(false);
  const [dims, setDims] = useState(true);
  const [under, setUnder] = useState(false);
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState<File | null>(null);

  useEffect(() => {
    let gone = false;
    Promise.all([import('../viewer3d/viewer.js'), import('../viewer3d/core.ts')])
      .then(([{ createViewer }, { VIEWER_CORE }]) => {
        if (gone || !host.current) return;
        viewer.current = createViewer(host.current, { core: VIEWER_CORE, onPick: setPick, onOpenChange: setOpen });
        setState('ok');
      })
      .catch(() => !gone && setState('failed'));
    return () => {
      gone = true;
      viewer.current?.dispose();
      viewer.current = null;
      shownKey.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (state !== 'ok' || !v) return;
    v.show(prepared, cut, { keepCamera: shownKey.current === designKey });
    shownKey.current = designKey;
    setMovers(v.hasMovers);
  }, [state, prepared, cut, designKey]);

  useEffect(() => {
    const v = viewer.current;
    if (v) {
      v.resize();
      v.frame('3d');
    }
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  const shot = async () => {
    const blob = await viewer.current?.screenshot();
    if (!blob) return;
    const file = new File([blob], `${fileSlug(title)}.png`, { type: 'image/png' });
    const r = await shareFile(file, title);
    if (r === 'needs_tap') setPending(file);
    else if (r === 'downloaded') toast('התמונה נשמרה בהורדות');
  };

  return (
    <div
      className={full ? 'fixed inset-0 z-50 flex flex-col bg-steel-950 px-2' : 'mt-4'}
      style={full ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 6px)' } : undefined}
      role={full ? 'dialog' : undefined}
      aria-modal={full || undefined}
      aria-label={full ? `${title}, תלת־ממד` : undefined}
    >
      {full && (
        <div className="flex min-h-12 items-center justify-between gap-2 ps-1">
          <p className="truncate font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => setFull(false)}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-steel-500 px-3 text-sm font-semibold"
          >
            <Icon name="shrink" size={18} />
            יציאה
          </button>
        </div>
      )}
      <div
        className={`relative overflow-hidden bg-[#d9dee2] ${
          full ? 'min-h-0 flex-1 rounded-lg' : 'aspect-[4/3] max-h-[62vh] w-full rounded-[10px] border border-steel-700'
        }`}
      >
        <div ref={host} className="absolute inset-0" />
        {state === 'loading' && <p className="absolute inset-0 grid place-items-center text-steel-700">טוען תלת־ממד...</p>}
        {state === 'failed' && (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-steel-950">
            התלת־ממד לא נטען בדפדפן הזה. השרטוט ורשימת החיתוך למטה עדיין זמינים.
          </p>
        )}
        {pick && (
          <div className="absolute inset-x-2 top-2 flex items-center gap-2 rounded-lg bg-steel-950/90 py-1 ps-3 pe-1 text-sm shadow">
            <p className="min-w-0 flex-1 leading-snug">
              {pick.mark && <b className="text-hivis">{pick.mark} </b>}
              {pick.text}
            </p>
            <button
              type="button"
              aria-label="סגור"
              onClick={() => viewer.current?.clearSelection()}
              className="grid h-11 w-11 shrink-0 place-items-center"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
        {pending && (
          <button
            type="button"
            onClick={() => {
              void shareFile(pending, title);
              setPending(null);
            }}
            className="btn-primary absolute inset-x-3 bottom-3 w-auto"
          >
            <Icon name="share" />
            התמונה מוכנה, שתף
          </button>
        )}
        {overlay}
      </div>

      {movers && (
        <div className="flex items-center gap-3 pt-3">
          <span className="text-sm text-steel-300">סגור</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(open * 100)}
            onChange={(e) => viewer.current?.setOpen(Number(e.target.value) / 100)}
            aria-label="פתיחת השער"
            className="min-w-0 flex-1 accent-hivis"
          />
          <span className="text-sm text-steel-300">פתוח</span>
          <button
            type="button"
            onClick={() => viewer.current?.animateOpen(open > 0.5 ? 0 : 1)}
            className="min-h-11 min-w-16 rounded-lg border border-steel-500 px-3 text-sm font-semibold"
          >
            {open > 0.5 ? 'סגור' : 'פתח'}
          </button>
        </div>
      )}

      <div role="toolbar" aria-label="תצוגה" className={`grid gap-1 pt-2 ${showGround ? 'grid-cols-6' : 'grid-cols-5'}`}>
        <Tool
          icon="ruler"
          label="מידות"
          pressed={dims}
          onClick={() => {
            viewer.current?.setDims(!dims);
            setDims(!dims);
          }}
        />
        <Tool icon="facade" label="חזית" onClick={() => viewer.current?.frame('front')} />
        <Tool icon="rotate" label="איפוס" onClick={() => viewer.current?.frame('3d')} />
        {showGround && (
          <Tool
            icon="ground"
            label="יסודות"
            pressed={under}
            onClick={() => {
              viewer.current?.setUnderground(!under);
              setUnder(!under);
            }}
          />
        )}
        <Tool icon="share" label="תמונה" onClick={() => void shot()} />
        <Tool icon={full ? 'shrink' : 'expand'} label={full ? 'יציאה' : 'מסך מלא'} onClick={() => setFull(!full)} />
      </div>
      {full && footer}
    </div>
  );
}

function Tool({ icon, label, onClick, pressed }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[0.75rem] font-semibold ${
        pressed ? 'bg-steel-700 text-soapstone' : 'text-steel-300'
      }`}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}
