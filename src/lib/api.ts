import type { Job, JobKind, JobStatus, Settings } from '../core/types.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired whenever the server says the session is missing or expired; App shows the login screen. */
export const AUTH_REQUIRED_EVENT = 'gva:auth-required';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  if (!isJson) throw new ApiError(res.status || 502, 'bad_response');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const error = new ApiError(res.status, body.error ?? res.statusText);
    if (res.status === 401 && error.message === 'unauthorized') {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw error;
  }
  return (await res.json()) as T;
}

export interface NewJob {
  title: string;
  kind: JobKind;
  client_name?: string;
  site_address?: string;
  description?: string;
}

export const api = {
  health: () => request<{ ok: boolean; db: boolean }>('/health'),
  me: () => request<{ loggedIn: boolean }>('/me'),
  login: (password: string) => request<{ ok: true }>('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  settings: () => request<Settings>('/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  jobs: () => request<Job[]>('/jobs'),
  createJob: (job: NewJob) => request<Job>('/jobs', { method: 'POST', body: JSON.stringify(job) }),
  setJobStatus: (id: number, status: JobStatus) =>
    request<Job>(`/jobs/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.message) {
      case 'unauthorized':
        return 'צריך להתחבר מחדש.';
      case 'wrong_password':
        return 'סיסמה שגויה.';
      case 'too_many_attempts':
        return 'יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.';
      case 'auth_not_configured':
        return 'הכניסה עוד לא הוגדרה בשרת (ראו README).';
      default:
        return `שגיאה מהשרת: ${err.message}`;
    }
  }
  return 'אין חיבור לשרת. בדוק קליטה ונסה שוב.';
}
