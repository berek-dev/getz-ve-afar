/** Shared domain types (mirror the D1 schema in migrations/). */

export type JobKind = 'fabrication' | 'pipe' | 'service' | 'earthworks';

export type JobStatus = 'lead' | 'visit' | 'quoted' | 'approved' | 'in_progress' | 'done' | 'paid' | 'lost';

export type Unit = 'm' | 'kg' | 'unit' | 'hour' | 'm2' | 'joint' | 'day';

export interface Settings {
  id: 1;
  business_name: string;
  hourly_rate: number;
  overhead_pct: number;
  margin_pct: number;
  vat_pct: number;
  bar_length_mm: number;
  kerf_mm: number;
  updated_at: string;
}

export interface Client {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface Job {
  id: number;
  client_id: number | null;
  client_name?: string | null;
  title: string;
  site_address: string | null;
  kind: JobKind;
  status: JobStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  fabrication: 'מסגרות',
  pipe: 'ריתוך צנרת',
  service: 'שירות ותיקונים',
  earthworks: 'עבודות עפר',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  lead: 'פנייה חדשה',
  visit: 'נקבע ביקור',
  quoted: 'נשלחה הצעה',
  approved: 'אושר',
  in_progress: 'בביצוע',
  done: 'הסתיים',
  paid: 'שולם',
  lost: 'לא יצא',
};
