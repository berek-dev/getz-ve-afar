/** Shared domain types (mirror the D1 schema in migrations/). */

export type JobKind = 'fabrication' | 'pipe' | 'service' | 'earthworks';

export type JobStatus = 'lead' | 'visit' | 'quoted' | 'approved' | 'in_progress' | 'done' | 'paid' | 'lost';

export type Unit = 'm' | 'kg' | 'unit' | 'hour' | 'm2' | 'joint' | 'day';

export const UNITS: readonly Unit[] = ['m', 'kg', 'unit', 'hour', 'm2', 'joint', 'day'];

/** Short unit names for quantities ("4.6 מ׳", "19 שעות"). */
export const UNIT_LABELS: Record<Unit, string> = {
  m: 'מ׳',
  kg: 'ק״ג',
  unit: 'יח׳',
  hour: 'שעות',
  m2: 'מ״ר',
  joint: 'תפרים',
  day: 'ימים',
};

/** "per unit" wording for prices ("₪22 למטר"). */
export const UNIT_PER: Record<Unit, string> = {
  m: 'למטר',
  kg: 'לק״ג',
  unit: 'ליחידה',
  hour: 'לשעה',
  m2: 'למ״ר',
  joint: 'לתפר',
  day: 'ליום',
};

export type ElementCategory =
  | 'profile'
  | 'plate'
  | 'pipe'
  | 'fitting'
  | 'hardware'
  | 'weld'
  | 'labor'
  | 'finish'
  | 'equipment'
  | 'other';

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  profile: 'פרופילים',
  plate: 'פחים',
  pipe: 'צינורות',
  fitting: 'אביזרי צנרת',
  hardware: 'פרזול',
  weld: 'ריתוך',
  labor: 'עבודה',
  finish: 'גמר וצביעה',
  equipment: 'ציוד',
  other: 'אחר',
};

/** An entry in the element library (price list). */
export interface Element {
  id: number;
  category: ElementCategory;
  name: string;
  unit: Unit;
  unit_cost: number;
  weight_kg_per_unit: number | null;
  stock_length_mm: number | null;
  supplier_id: number | null;
  active: number;
}

/** A line in a job's bill of quantities. Library fields are joined in by the API. */
export interface JobItem {
  id: number;
  job_id: number;
  element_id: number | null;
  group_name: string | null;
  description: string;
  quantity: number;
  unit: Unit;
  unit_cost: number;
  length_mm: number | null;
  pieces: number | null;
  source: 'manual' | 'template' | 'ai';
  sort_order: number;
  category?: ElementCategory | null;
  weight_kg_per_unit?: number | null;
  stock_length_mm?: number | null;
}

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
