/**
 * A one-page PDF holding one image that fills a landscape A4 or A3 sheet. Enough for printing the shop drawing:
 * the browser draws the sheet (Hebrew text included) into a canvas, the app compresses the pixels (deflate) and
 * this wraps them. No dependencies; the bytes are built by hand.
 */

export type PageSize = 'A4' | 'A3';

/** Landscape page sizes in PDF points (1/72 inch) */
export const PAGE_POINTS: Record<PageSize, [number, number]> = {
  A4: [841.89, 595.28],
  A3: [1190.55, 841.89],
};

export interface PdfImage {
  width: number;
  height: number;
  /** One byte per pixel (gray) or three (RGB), row by row, deflate-compressed (zlib, as CompressionStream('deflate') makes) */
  data: Uint8Array;
  gray: boolean;
}

const enc = new TextEncoder();
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** A text string for the document info: UTF-16 with a byte order mark, as hex, so Hebrew survives */
function pdfText(s: string): string {
  let hex = '<FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `${hex}>`;
}

const pdfDate = (d: Date) =>
  `(D:${d.getUTCFullYear()}${[d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, '0')).join('')}Z)`;

export function imagePdf(img: PdfImage, opts: { page: PageSize; title?: string; date?: Date }): Uint8Array {
  const [W, H] = PAGE_POINTS[opts.page];
  // Keep the image's proportions, centered (the drawing is drawn at A-series proportions, so it fills the page)
  const s = Math.min(W / img.width, H / img.height);
  const w = img.width * s;
  const h = img.height * s;
  const content = `q ${num(w)} 0 0 ${num(h)} ${num((W - w) / 2)} ${num((H - h) / 2)} cm /Im0 Do Q\n`;

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (p: Uint8Array | string) => {
    const bytes = typeof p === 'string' ? enc.encode(p) : p;
    parts.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = size;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  // The second line's high bytes tell tools the file is binary
  push('%PDF-1.4\n%');
  push(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(W)} ${num(H)}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> /Contents 5 0 R >>`);
  offsets[4] = size;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.data.length} >>\nstream\n`,
  );
  push(img.data);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);
  obj(6, `<< ${opts.title ? `/Title ${pdfText(opts.title)} ` : ''}/Producer (getz-ve-afar) /CreationDate ${pdfDate(opts.date ?? new Date())} >>`);

  const xref = size;
  const rows = offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`);
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${rows.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
