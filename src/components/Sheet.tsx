import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Bottom sheet: slides up over the screen, closes on backdrop tap, X or Escape. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="סגור"
        tabIndex={-1}
        className="absolute inset-0 bg-ink/45"
        onClick={() => closeRef.current()}
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[14px] border-t border-line bg-page px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 outline-none"
      >
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-line-strong" aria-hidden="true" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[1.25rem] font-bold leading-tight">{title}</h2>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label="סגור"
            className="grid h-11 w-11 place-items-center rounded-full border border-line bg-card text-ink"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
