/** Phone helpers shared by the app and the server. */

/** Keeps digits and a leading +; empty → null. */
export function normalizePhone(v: unknown): string | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'invalid';
  const trimmed = v.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{7,15}$/.test(cleaned)) return 'invalid';
  return cleaned;
}

/** wa.me wants the number with country code and no +. Israeli 05x → 9725x. */
export function whatsappNumber(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.length >= 9 ? digits : null;
}

/** Link that opens WhatsApp with a ready message (to a number if we have one). */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const number = whatsappNumber(phone ?? null);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}
