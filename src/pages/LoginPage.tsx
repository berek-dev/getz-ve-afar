import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { Icon } from '../components/Icon.tsx';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      onLoggedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-steel-950">
      <div className="weld-bead" aria-hidden="true" />
      <main className="flex flex-1 items-center justify-center px-6 pb-[env(safe-area-inset-bottom)]">
        <form onSubmit={submit} className="w-full max-w-sm">
          <img src="/icons/icon-192.png" alt="" className="h-20 w-20 rounded-[18px]" />
          <h1 className="mt-5 font-display text-[4.5rem] leading-[0.85]">גץ ועפר</h1>
          <p className="mt-2 text-lg text-steel-300">מסגרות, ריתוך ועבודות עפר</p>

          <label className="mt-10 block">
            <span className="mb-1.5 block font-semibold">סיסמה</span>
            <span className="relative block">
              <input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field pe-14 text-lg"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
                aria-pressed={show}
                className={`absolute inset-y-0 end-0 grid w-13 place-items-center ${show ? 'text-hivis' : 'text-steel-500'}`}
              >
                <Icon name="eye" size={22} />
              </button>
            </span>
          </label>

          {error && (
            <p id="login-error" className="mt-2 text-primer-light" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy || !password} className="btn-primary mt-5">
            {busy ? 'נכנס...' : 'כניסה'}
          </button>

          <p className="mt-6 text-sm text-steel-500">שכחת את הסיסמה? ברק יכול להגדיר סיסמה חדשה.</p>
        </form>
      </main>
    </div>
  );
}
