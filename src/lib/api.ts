import type { Job, JobKind, JobStatus, Settings } from '../core/types.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  // When the Access session expires, Cloudflare answers with its login page instead of JSON.
  if (res.redirected || (!isJson && res.status !== 204)) {
    throw new ApiError(401, 'login_required');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
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
  me: () => request<{ email: string }>('/me'),
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
    if (err.status === 401) return 'צריך להתחבר מחדש – רענן את הדף.';
    if (err.message === 'auth_not_configured') return 'ההתחברות עוד לא הוגדרה בשרת (ראו README).';
    return `שגיאה מהשרת: ${err.message}`;
  }
  return 'אין חיבור לשרת. בדוק קליטה ונסה שוב.';
}
