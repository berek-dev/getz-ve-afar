import { useEffect, useState } from 'react';
import { TodayPage } from './pages/TodayPage.tsx';
import { JobsPage } from './pages/JobsPage.tsx';
import { JobPage } from './pages/JobPage.tsx';
import { NewJobPage } from './pages/NewJobPage.tsx';
import { CalendarPage } from './pages/CalendarPage.tsx';
import { RunsBar } from './components/RunsBar.tsx';
import { BusinessPage } from './pages/BusinessPage.tsx';
import { FinancePage } from './pages/FinancePage.tsx';
import { FeaturesContext } from './lib/features.ts';
import type { Features } from './lib/api.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { PriceListPage } from './pages/PriceListPage.tsx';
import { AUTH_REQUIRED_EVENT, ApiError, api } from './lib/api.ts';
import { LEGACY_TABS, STEP_IDS } from './core/phases.ts';
import type { StepId } from './core/phases.ts';
import { Icon } from './components/Icon.tsx';
import type { IconName } from './components/Icon.tsx';
import { Toaster } from './components/Toast.tsx';

/** Bottom bar: today's work, all jobs, a new request, the calendar, the business */
type Tab = 'today' | 'jobs' | 'new' | 'calendar' | 'business';
type Page = 'today' | 'jobs' | 'new' | 'calendar' | 'business' | 'money' | 'prices' | 'pricing';
type Route = { page: Page; jobId: number | null; step: StepId | null };

const PAGE_TAB: Record<Page, Tab> = {
  today: 'today',
  jobs: 'jobs',
  new: 'new',
  calendar: 'calendar',
  business: 'business',
  money: 'business',
  prices: 'business',
  pricing: 'business',
};

function routeFromHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const m = hash.match(/^jobs\/(\d+)(?:\/(\w+))?$/);
  if (m) {
    const raw = m[2] ?? '';
    const step = (STEP_IDS as readonly string[]).includes(raw) ? (raw as StepId) : (LEGACY_TABS[raw] ?? null);
    return { page: 'jobs', jobId: Number(m[1]), step };
  }
  const page = (Object.keys(PAGE_TAB) as Page[]).find((p) => hash === p);
  return { page: page ?? 'today', jobId: null, step: null };
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [online, setOnline] = useState<boolean | null>(null);
  // null = checking, true = logged in (or offline – pages show their own errors), false = show login
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [features, setFeatures] = useState<Features>({ photos: false, ai: false });

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
      .then((me) => {
        setAuthed(true);
        if (me.features) setFeatures(me.features);
      })
      .catch((e: unknown) => setAuthed(!(e instanceof ApiError && e.status === 401)));
  }, []);

  if (authed === null) {
    return <div className="min-h-dvh bg-page" aria-busy="true" />;
  }
  if (!authed)
    return (
      <LoginPage
        onLoggedIn={() => {
          setAuthed(true);
          void api.me().then((me) => me.features && setFeatures(me.features), () => undefined);
        }}
      />
    );

  const tab = PAGE_TAB[route.page];

  return (
    <FeaturesContext.Provider value={features}>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
        {online === false && (
          <p className="sticky top-0 z-30 bg-danger px-4 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center text-sm font-semibold text-white" role="status">
            אין חיבור לשרת. מה שתשמור עכשיו לא יישמר.
          </p>
        )}

        <main className="flex-1 px-4 pb-48 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <RunsBar jobId={route.jobId} step={route.step} />
          {route.jobId !== null ? (
            <JobPage key={route.jobId} jobId={route.jobId} step={route.step} />
          ) : route.page === 'today' ? (
            <TodayPage />
          ) : route.page === 'jobs' ? (
            <JobsPage />
          ) : route.page === 'new' ? (
            <NewJobPage />
          ) : route.page === 'calendar' ? (
            <CalendarPage />
          ) : route.page === 'business' ? (
            <BusinessPage />
          ) : route.page === 'money' ? (
            <FinancePage />
          ) : route.page === 'prices' ? (
            <PriceListPage />
          ) : (
            <SettingsPage />
          )}
        </main>

        <nav
          aria-label="תפריט ראשי"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto grid max-w-xl grid-cols-5">
            <NavLink href="#/today" active={tab === 'today'} icon="today" label="היום" />
            <NavLink href="#/jobs" active={tab === 'jobs'} icon="jobs" label="עבודות" />
            <a
              href="#/new"
              aria-current={tab === 'new' ? 'page' : undefined}
              className="flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold text-ink"
            >
              <span className="grid h-8 w-11 place-items-center rounded-md bg-accent text-white">
                <Icon name="plus" size={22} />
              </span>
              פנייה חדשה
            </a>
            <NavLink href="#/calendar" active={tab === 'calendar'} icon="calendar" label="יומן" />
            <NavLink href="#/business" active={tab === 'business'} icon="briefcase" label="עסק" />
          </div>
        </nav>

        <Toaster />
      </div>
    </FeaturesContext.Provider>
  );
}

function NavLink({ href, active, icon, label }: { href: string; active: boolean; icon: IconName; label: string }) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold ${
        active ? 'text-accent' : 'text-muted'
      }`}
    >
      {active && <span className="absolute inset-x-4 top-0 h-[2px] bg-accent" aria-hidden="true" />}
      <Icon name={icon} size={24} />
      {label}
    </a>
  );
}
