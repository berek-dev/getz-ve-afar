import { useEffect, useState } from 'react';
import { JobsPage } from './pages/JobsPage.tsx';
import { JobDetailPage } from './pages/JobDetailPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { PriceListPage } from './pages/PriceListPage.tsx';
import { AUTH_REQUIRED_EVENT, ApiError, api } from './lib/api.ts';
import { Icon } from './components/Icon.tsx';
import type { IconName } from './components/Icon.tsx';
import { Toaster } from './components/Toast.tsx';

type Tab = 'jobs' | 'prices' | 'pricing';
type Route = { tab: Tab; jobId: number | null };

function routeFromHash(): Route {
  const hash = window.location.hash;
  if (hash === '#/pricing') return { tab: 'pricing', jobId: null };
  if (hash === '#/prices') return { tab: 'prices', jobId: null };
  const m = hash.match(/^#\/jobs\/(\d+)$/);
  return { tab: 'jobs', jobId: m ? Number(m[1]) : null };
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const tab = route.tab;
  const [online, setOnline] = useState<boolean | null>(null);
  // null = checking, true = logged in (or offline – pages show their own errors), false = show login
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo(0, 0);
    };
    const onAuthRequired = () => setAuthed(false);
    window.addEventListener('hashchange', onHash);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, []);

  useEffect(() => {
    api
      .health()
      .then((h) => setOnline(h.ok))
      .catch(() => setOnline(false));
    api
      .me()
      .then(() => setAuthed(true))
      .catch((e: unknown) => setAuthed(!(e instanceof ApiError && e.status === 401)));
  }, []);

  if (authed === null) {
    return <div className="min-h-dvh bg-steel-950" aria-busy="true" />;
  }
  if (!authed) return <LoginPage onLoggedIn={() => setAuthed(true)} />;

  const go = (t: Tab) => {
    window.location.hash = `#/${t}`;
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-20 bg-steel-950 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-[9px]" />
            <span className="font-display text-[2.1rem] leading-none tracking-wide">גץ ועפר</span>
          </div>
          {online === false && (
            <span className="rounded-full border border-primer px-3 py-1 text-sm font-semibold text-primer-light">
              אין חיבור לשרת
            </span>
          )}
        </div>
        <div className="weld-bead" aria-hidden="true" />
      </header>

      <main className="flex-1 px-4 pb-44 pt-5">
        {route.jobId !== null ? (
          <JobDetailPage jobId={route.jobId} />
        ) : tab === 'jobs' ? (
          <JobsPage />
        ) : tab === 'prices' ? (
          <PriceListPage />
        ) : (
          <SettingsPage />
        )}
      </main>

      <nav
        aria-label="ניווט ראשי"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-steel-700 bg-steel-950 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto flex max-w-xl">
          <NavButton active={tab === 'jobs'} onClick={() => go('jobs')} icon="jobs" label="עבודות" />
          <NavButton active={tab === 'prices'} onClick={() => go('prices')} icon="tag" label="מחירון" />
          <NavButton active={tab === 'pricing'} onClick={() => go('pricing')} icon="gauge" label="הגדרות" />
        </div>
      </nav>

      <Toaster />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconName;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-sm font-semibold ${
        active ? 'text-hivis' : 'text-steel-300'
      }`}
    >
      {active && <span className="absolute inset-x-10 top-0 h-[3px] rounded-b bg-hivis" aria-hidden="true" />}
      <Icon name={icon} size={26} />
      {label}
    </button>
  );
}
