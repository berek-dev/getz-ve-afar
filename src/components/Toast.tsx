import { useEffect, useState } from 'react';

const TOAST_EVENT = 'gva:toast';

/** Show a short confirmation ("העבודה נשמרה") above the bottom bar. */
export function toast(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(TOAST_EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2600);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
    >
      {message && (
        <div className="sheet flex items-center gap-2 rounded-md border-s-4 border-accent bg-accent-soft px-4 py-3 font-semibold shadow-lg shadow-black/40">
          {message}
        </div>
      )}
    </div>
  );
}
