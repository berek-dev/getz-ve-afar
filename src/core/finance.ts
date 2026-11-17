/** Payments in, expenses out, balances and the monthly export for the accountant. */
import { round2 } from './money.ts';

export type PaymentMethod = 'transfer' | 'bit' | 'cash' | 'check' | 'card';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['transfer', 'bit', 'cash', 'check', 'card'];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: 'העברה בנקאית',
  bit: 'ביט / פייבוקס',
  cash: 'מזומן',
  check: 'צ׳ק',
  card: 'אשראי',
};

export type ExpenseCategory = 'materials' | 'subcontractor' | 'fuel' | 'tools' | 'vehicle' | 'other';
export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = ['materials', 'subcontractor', 'fuel', 'tools', 'vehicle', 'other'];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: 'חומרים',
  subcontractor: 'קבלן משנה',
  fuel: 'דלק',
  tools: 'כלים וציוד',
  vehicle: 'רכב',
  other: 'אחר',
};

export interface Payment {
  id: number;
  job_id: number | null;
  amount: number;
  method: PaymentMethod | null;
  paid_at: string;
  notes: string | null;
  job_title?: string | null;
  client_name?: string | null;
}

export interface Expense {
  id: number;
  job_id: number | null;
  supplier_id: number | null;
  category: ExpenseCategory | null;
  amount: number;
  vat: number | null;
  spent_at: string;
  receipt_key: string | null;
  notes: string | null;
  job_title?: string | null;
  supplier_name?: string | null;
}

/** The VAT part of a VAT-inclusive amount. */
export function vatFromGross(gross: number, vatPct: number): number {
  return vatPct > 0 ? round2((gross * vatPct) / (100 + vatPct)) : 0;
}

export function jobBalance(due: number | null, payments: { amount: number }[]) {
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (due == null || due <= 0) return { due: null, paid, balance: null, share: null };
  const balance = round2(due - paid);
  return { due, paid, balance, share: Math.max(0, Math.min(1, paid / due)) };
}

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" → ["2026-11-01", "2026-12-01"] (end exclusive) */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(round2(v)) : v;
  // Neutralise spreadsheet formulas in free text
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV for the month: income and expenses, Excel-friendly (UTF-8 BOM, Hebrew headers). */
export function monthCsv(payments: Payment[], expenses: Expense[]): string {
  const header = ['תאריך', 'סוג', 'סכום כולל מע״מ', 'מע״מ', 'עבודה', 'לקוח / ספק', 'קטגוריה / אמצעי תשלום', 'הערות', 'קבלה'];
  const rows: (string | number | null)[][] = [
    ...payments.map((p) => [
      p.paid_at,
      'הכנסה',
      p.amount,
      null,
      p.job_title ?? null,
      p.client_name ?? null,
      p.method ? PAYMENT_METHOD_LABELS[p.method] : null,
      p.notes,
      null,
    ]),
    ...expenses.map((e) => [
      e.spent_at,
      'הוצאה',
      e.amount,
      e.vat,
      e.job_title ?? null,
      e.supplier_name ?? null,
      e.category ? EXPENSE_CATEGORY_LABELS[e.category] : null,
      e.notes,
      e.receipt_key ? 'יש' : null,
    ]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
