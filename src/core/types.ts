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
  supplier_name?: string | null;
  active: number;
  /** Menu group inside the category ("פרופיל מלבני", "צירים") */
  family: string | null;
  /** materials.key for metal stock */
  material: string | null;
  /** Short size label for the size grid ("60/40/2") */
  size: string | null;
  catalog_key: string | null;
  /** 1 = unit_cost follows weight × the material's price per kg */
  price_by_kg: number;
}

export interface Material {
  key: string;
  name: string;
  density: number;
  price_per_kg: number;
  sort_order: number;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
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
  element_name?: string | null;
  category?: ElementCategory | null;
  weight_kg_per_unit?: number | null;
  stock_length_mm?: number | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  supplier_phone?: string | null;
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
  business_phone: string | null;
  quote_terms: string | null;
  quote_valid_days: number;
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
  client_phone?: string | null;
  title: string;
  site_address: string | null;
  kind: JobKind;
  status: JobStatus;
  description: string | null;
  scheduled_at: string | null;
  scheduled_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteSummary {
  id: number;
  job_id: number;
  version: number;
  token: string;
  status: 'sent' | 'approved' | 'rejected' | 'expired' | 'draft';
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  valid_until: string | null;
  approved_at: string | null;
  approved_name: string | null;
  created_at: string;
}

export interface Photo {
  id: number;
  job_id: number;
  caption: string | null;
  kind: string;
  created_at: string;
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  item_count: number;
  created_at: string;
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
