import type { Element, ElementCategory, Job, JobItem, JobKind, JobStatus, Settings, Supplier, Unit } from '../core/types.ts';

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
  client_phone?: string;
  site_address?: string;
  description?: string;
}

export interface ElementDraft {
  category: ElementCategory;
  name: string;
  unit: Unit;
  unit_cost: number;
  weight_kg_per_unit: number | null;
  stock_length_mm: number | null;
  supplier_id: number | null;
  /** Set to create a new supplier together with the element */
  supplier_name?: string;
  supplier_phone?: string;
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
  job: (id: number) => request<JobDetail>(`/jobs/${id}`),
  updateJob: (id: number, job: NewJob) => request<Job>(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(job) }),
  deleteJob: (id: number) => request<{ ok: true }>(`/jobs/${id}`, { method: 'DELETE' }),
  createElement: (el: ElementDraft) => request<Element>('/elements', { method: 'POST', body: JSON.stringify(el) }),
  updateElement: (id: number, el: ElementDraft) =>
    request<Element>(`/elements/${id}`, { method: 'PATCH', body: JSON.stringify(el) }),
  deleteElement: (id: number) => request<{ ok: true }>(`/elements/${id}`, { method: 'DELETE' }),
  suppliers: () => request<Supplier[]>('/suppliers'),
  elements: () => request<Element[]>('/elements'),
  createItem: (jobId: number, item: ItemDraft) =>
    request<JobItem>(`/jobs/${jobId}/items`, { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (jobId: number, itemId: number, item: ItemDraft) =>
    request<JobItem>(`/jobs/${jobId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(item) }),
  deleteItem: (jobId: number, itemId: number) =>
    request<{ ok: true }>(`/jobs/${jobId}/items/${itemId}`, { method: 'DELETE' }),
};

export interface JobDetail extends Job {
  items: JobItem[];
}

/** What the line editor sends; the server derives quantity from pieces × length for metre lines. */
export interface ItemDraft {
  element_id: number | null;
  group_name: string | null;
  description: string;
  quantity: number;
  unit: Unit;
  unit_cost: number;
  length_mm: number | null;
  pieces: number | null;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.message) {
      case 'unauthorized':
        return 'צריך להתחבר מחדש.';
      case 'wrong_password':
        return 'סיסמה שגויה.';
      case 'too_many_attempts':
        return 'יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.';
      case 'invalid phone':
        return 'מספר הטלפון לא נראה תקין.';
      case 'auth_not_configured':
        return 'הכניסה עוד לא הוגדרה בשרת (ראו README).';
      default:
        return `שגיאה מהשרת: ${err.message}`;
    }
  }
  return 'אין חיבור לשרת. בדוק קליטה ונסה שוב.';
}
