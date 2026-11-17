import { useEffect, useState } from 'react';
import { JobsPage } from './pages/JobsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { api } from './lib/api.ts';

type Tab = 'jobs' | 'settings';

function tabFromHash(): Tab {
  return window.location.hash === '#/settings' ? 'settings' : 'jobs';
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api
      .health()
      .then((h) => setOnline(h.ok))
      .catch(() => setOnline(false));
  }, []);

  const go = (t: Tab) => {
    window.location.hash = t === 'settings' ? '#/settings' : '#/jobs';
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-stone-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icons/icon-192.png" alt="" className="h-9 w-9 rounded-lg" />
            <div>
              <h1 className="text-xl font-extrabold leading-none">גץ ועפר</h1>
              <p className="text-xs text-stone-400">מסגרות · ריתוך · עבודות עפר</p>
            </div>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              online === null ? 'bg-stone-700' : online ? 'bg-emerald-700' : 'bg-red-700'
            }`}
          >
            {online === null ? '...' : online ? 'מחובר' : 'אין חיבור'}
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-24">{tab === 'jobs' ? <JobsPage /> : <SettingsPage />}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-xl">
          <NavButton active={tab === 'jobs'} onClick={() => go('jobs')} label="עבודות" />
          <NavButton active={tab === 'settings'} onClick={() => go('settings')} label="הגדרות" />
        </div>
      </nav>
    </div>
  );
}

function NavButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-3 text-base font-bold ${active ? 'text-ember-600' : 'text-stone-500'}`}
    >
      {label}
    </button>
  );
}
