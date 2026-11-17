import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../lib/api.ts';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
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
    <div className="flex min-h-screen items-center justify-center bg-stone-900 px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 text-center">
        <img src="/icons/icon-192.png" alt="" className="mx-auto h-20 w-20 rounded-2xl" />
        <div>
          <h1 className="text-3xl font-extrabold text-white">גץ ועפר</h1>
          <p className="text-stone-400">מסגרות · ריתוך · עבודות עפר</p>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="סיסמה"
          className="w-full rounded-xl border border-stone-600 bg-stone-800 px-4 py-3 text-white placeholder:text-stone-500 focus:border-ember-500 focus:outline-none"
          autoFocus
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-xl bg-ember-500 py-3 text-lg font-bold text-white disabled:opacity-50"
        >
          {busy ? 'נכנס...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
