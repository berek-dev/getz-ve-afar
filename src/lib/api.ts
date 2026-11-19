import type { Element, ElementCategory, Job, JobItem, JobKind, JobStatus, QuoteSummary, Settings, Supplier, Unit } from '../core/types.ts';
import type { QuoteSnapshot } from '../core/quote.ts';
import type { Expense, ExpenseCategory, Payment, PaymentMethod } from '../core/finance.ts';
import type { Material, Photo, Template } from '../core/types.ts';

export class ApiError extends Error {
  status: number;
  /** Extra detail some errors carry (e.g. what is wrong with a 3D layout) */
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Fired whenever the server says the session is missing or expired; App shows the login screen. */
export const AUTH_REQUIRED_EVENT = 'gva:auth-required';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init.body instanceof Blob ? init.headers : { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  if (!isJson) throw new ApiError(res.status || 502, 'bad_response');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    const details = Array.isArray(body.details) ? body.details.filter((d): d is string => typeof d === 'string') : [];
    const error = new ApiError(res.status, body.error ?? res.statusText, details);
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
  template_id?: number | null;
}

export interface ElementDraft {
  category: ElementCategory;
  name: string;
  unit: Unit;
  unit_cost: number;
  weight_kg_per_unit: number | null;
  stock_length_mm: number | null;
  supplier_id: number | null;
  family: string | null;
  material: string | null;
  size: string | null;
  price_by_kg: boolean;
  /** Set to create a new supplier together with the element */
  supplier_name?: string;
  supplier_phone?: string;
}

export const api = {
  health: () => request<{ ok: boolean; db: boolean }>('/health'),
  me: () => request<{ loggedIn: boolean; features?: Features }>('/me'),
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
  materials: () => request<Material[]>('/materials'),
  setMaterialPrice: (key: string, price_per_kg: number) =>
    request<{ material: Material; repriced: number }>(`/materials/${key}`, { method: 'PUT', body: JSON.stringify({ price_per_kg }) }),
  catalogStatus: () => request<{ total: number; missing: number }>('/catalog/status'),
  importCatalog: () => request<{ linked: number; added: number }>('/catalog/import', { method: 'POST' }),
  quotes: (jobId: number) => request<QuoteSummary[]>(`/jobs/${jobId}/quotes`),
  createQuote: (jobId: number, includeModel = true) =>
    request<QuoteSummary>(`/jobs/${jobId}/quotes`, { method: 'POST', body: JSON.stringify({ include_model: includeModel }) }),
  publicQuote: (token: string) => request<PublicQuote>(`/public/quotes/${encodeURIComponent(token)}`),
  approveQuote: (token: string, name: string) =>
    request<{ ok: true; approved_at: string; approved_name: string }>(
      `/public/quotes/${encodeURIComponent(token)}/approve`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),
  elements: () => request<Element[]>('/elements'),
  createItem: (jobId: number, item: ItemDraft) =>
    request<JobItem>(`/jobs/${jobId}/items`, { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (jobId: number, itemId: number, item: ItemDraft) =>
    request<JobItem>(`/jobs/${jobId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(item) }),
  deleteItem: (jobId: number, itemId: number) =>
    request<{ ok: true }>(`/jobs/${jobId}/items/${itemId}`, { method: 'DELETE' }),
  addItems: (jobId: number, items: ItemDraft[], source: 'ai' | 'manual') =>
    request<JobItem[]>(`/jobs/${jobId}/items/bulk`, { method: 'POST', body: JSON.stringify({ items, source }) }),

  schedule: (jobId: number, kind: 'visit' | 'work', at: string | null, hours: number | null) =>
    request<Job>(`/jobs/${jobId}/schedule`, { method: 'PATCH', body: JSON.stringify({ kind, scheduled_at: at, scheduled_hours: hours }) }),
  jobFields: (jobId: number, fields: { site_notes?: string | null; ordered?: boolean }) =>
    request<Job>(`/jobs/${jobId}/fields`, { method: 'PATCH', body: JSON.stringify(fields) }),

  jobMoney: (jobId: number) => request<JobMoney>(`/jobs/${jobId}/money`),
  addPayment: (jobId: number, p: PaymentDraft) =>
    request<Payment>(`/jobs/${jobId}/payments`, { method: 'POST', body: JSON.stringify(p) }),
  deletePayment: (id: number) => request<{ ok: true }>(`/payments/${id}`, { method: 'DELETE' }),
  addExpense: (e: ExpenseDraft) => request<Expense>('/expenses', { method: 'POST', body: JSON.stringify(e) }),
  deleteExpense: (id: number) => request<{ ok: true }>(`/expenses/${id}`, { method: 'DELETE' }),
  uploadReceipt: (id: number, image: Blob) => request<Expense>(`/expenses/${id}/receipt`, { method: 'PUT', body: image, headers: { 'content-type': image.type } }),
  finance: (month: string) => request<FinanceMonth>(`/finance?month=${month}`),

  photos: (jobId: number) => request<Photo[]>(`/jobs/${jobId}/photos`),
  uploadPhoto: (jobId: number, image: Blob) =>
    request<Photo>(`/jobs/${jobId}/photos`, { method: 'POST', body: image, headers: { 'content-type': image.type } }),
  captionPhoto: (id: number, caption: string) =>
    request<Photo>(`/photos/${id}`, { method: 'PATCH', body: JSON.stringify({ caption }) }),
  deletePhoto: (id: number) => request<{ ok: true }>(`/photos/${id}`, { method: 'DELETE' }),

  templates: () => request<Template[]>('/templates'),
  saveTemplate: (jobId: number, name: string, description: string) =>
    request<Template>('/templates', { method: 'POST', body: JSON.stringify({ job_id: jobId, name, description }) }),
  deleteTemplate: (id: number) => request<{ ok: true }>(`/templates/${id}`, { method: 'DELETE' }),
  applyTemplate: (jobId: number, templateId: number) =>
    request<JobItem[]>(`/jobs/${jobId}/apply-template`, { method: 'POST', body: JSON.stringify({ template_id: templateId }) }),

  model: (jobId: number) => request<JobModel>(`/jobs/${jobId}/model`),
  saveModel: (jobId: number, layout: unknown, opts: { source?: 'paste' | 'demo'; request?: string; mode?: 'new' | 'edit' } = {}) =>
    request<JobModel>(`/jobs/${jobId}/model`, { method: 'POST', body: JSON.stringify({ layout, ...opts }) }),
  undoModel: (jobId: number) => request<JobModel>(`/jobs/${jobId}/model/undo`, { method: 'POST' }),
  aiModel: (jobId: number, body: { request: string; mode: 'new' | 'edit'; image?: { mime: string; data: string } | null }, signal?: AbortSignal) =>
    request<JobModel>(`/jobs/${jobId}/model/ai`, { method: 'POST', body: JSON.stringify(body), signal }),
  approveModel: (jobId: number, opts: { dryRun?: boolean; replace?: boolean } = {}) =>
    request<{ lines: number; conflicts?: number; unpriced?: number; replaced?: number }>(`/jobs/${jobId}/model/approve`, {
      method: 'POST',
      body: JSON.stringify({ dry_run: opts.dryRun ?? false, replace: opts.replace ?? false }),
    }),

  aiLines: (jobId: number, text: string) =>
    request<{ lines: ItemDraft[]; notes: string[] }>('/ai/lines', { method: 'POST', body: JSON.stringify({ job_id: jobId, text }) }),
};

export const photoUrl = (id: number) => `/api/photos/${id}`;
export const receiptUrl = (expenseId: number) => `/api/expenses/${expenseId}/receipt`;
export const icsUrl = (jobId: number, kind: 'visit' | 'work' = 'work') =>
  `/api/jobs/${jobId}/calendar.ics${kind === 'visit' ? '?kind=visit' : ''}`;
export const exportUrl = (month: string) => `/api/export?month=${month}`;

export interface ModelVersion {
  id: number;
  request: string | null;
  mode: 'new' | 'edit';
  source: 'ai' | 'paste' | 'demo';
  created_at: string;
}

/** The job's 3D layout (src/core/scene.ts) and its versions, newest first */
export interface JobModel {
  layout: unknown;
  history: ModelVersion[];
  warnings?: string[];
}

export interface Features {
  photos: boolean;
  ai: boolean;
}

export interface JobMoney {
  /** Total of the approved quote, null until the client approves one */
  due: number | null;
  due_version: number | null;
  payments: Payment[];
  expenses: Expense[];
}

export interface PaymentDraft {
  amount: number;
  method: PaymentMethod;
  paid_at: string;
  notes?: string;
}

export interface ExpenseDraft {
  amount: number;
  has_vat: boolean;
  category: ExpenseCategory;
  spent_at: string;
  job_id: number | null;
  supplier_id?: number | null;
  supplier_name?: string;
  notes?: string;
}

export interface OpenBalance {
  id: number;
  title: string;
  status: JobStatus;
  client_name: string | null;
  client_phone: string | null;
  due: number;
  paid: number;
  balance: number;
}

export interface FinanceMonth {
  month: string;
  payments: Payment[];
  expenses: Expense[];
  totals: { income: number; expenses: number; expensesVat: number };
  open: OpenBalance[];
}

export interface PublicQuote {
  number: string;
  status: QuoteSummary['status'];
  valid_until: string | null;
  approved_at: string | null;
  approved_name: string | null;
  created_at: string;
  quote: QuoteSnapshot;
}

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
      case 'no_items':
        return 'אין עדיין שורות בכתב הכמויות, אז אין מה לשלוח.';
      case 'invalid phone':
        return 'מספר הטלפון לא נראה תקין.';
      case 'photos_not_configured':
        return 'שמירת תמונות עוד לא הופעלה בשרת. היא תופעל אוטומטית בעדכון הבא.';
      case 'image_too_large':
        return 'התמונה גדולה מדי.';
      case 'not_an_image':
        return 'הקובץ הזה הוא לא תמונה.';
      case 'invalid amount':
        return 'הסכום לא תקין.';
      case 'invalid date':
        return 'התאריך לא תקין.';
      case 'ai_not_configured':
        return 'הבינה המלאכותית עוד לא הופעלה בשרת (חסר מפתח Gemini).';
      case 'ai_busy':
        return 'השירות עמוס כרגע. נסה שוב בעוד דקה.';
      case 'ai_empty':
      case 'ai_bad_output':
        return 'לא התקבלה תשובה שימושית. נסה שוב או נסח אחרת.';
      case 'ai_bad_layout':
        return 'המודל שהתקבל לא תקין. נסה לנסח אחרת או לפרט מידות.';
      case 'invalid_layout':
        return `הפריסה לא תקינה${err.details.length ? `: ${err.details.slice(0, 3).join(', ')}` : ''}.`;
      case 'no_model':
        return 'עוד אין הדמיה לעבודה הזו.';
      case 'text_too_short':
        return 'כתוב קצת יותר על העבודה.';
      case 'by_kg_needs_weight':
        return 'למחיר לפי משקל צריך חומר ומשקל למטר.';
      case 'name is required':
        return 'צריך לתת שם.';
      case 'auth_not_configured':
        return 'הכניסה עוד לא הוגדרה בשרת (ראו README).';
      default:
        return `שגיאה מהשרת: ${err.message}`;
    }
  }
  return 'אין חיבור לשרת. בדוק קליטה ונסה שוב.';
}
