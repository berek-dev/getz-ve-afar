/** Sharing files from the phone (WhatsApp, mail, save to Files), with a download where sharing is missing. */
import { imagePdf } from '../core/pdf.ts';
import type { PageSize } from '../core/pdf.ts';

export type ShareResult = 'shared' | 'downloaded' | 'cancelled' | 'needs_tap';

export function downloadFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Opens the share sheet with the file. 'needs_tap': the browser wants a fresh tap (the file took too long
 * to prepare) – show a button that calls this again with the same file.
 */
export async function shareFile(file: File, title?: string): Promise<ShareResult> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs_tap';
    }
  }
  downloadFile(file, file.name);
  return 'downloaded';
}

/** SVG markup drawn into a white canvas `widthPx` wide, at the SVG's proportions (the shop drawing is 420/297 mm) */
async function renderSvg(svg: string, widthPx: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('svg_failed'));
      el.src = url;
    });
    const ratio = (img.naturalHeight || 297) / (img.naturalWidth || 420);
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = Math.round(widthPx * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function svgToPng(svg: string, widthPx: number): Promise<Blob> {
  const canvas = await renderSvg(svg, widthPx);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('encode_failed');
  return blob;
}

/**
 * SVG markup → a one-page PDF of a landscape A4 or A3 sheet. The sheet is drawn by the browser (so Hebrew text is
 * right) at 4,000 pixels wide, about 240 dots per inch on A3, kept as lossless gray pixels.
 */
export async function svgToPdf(svg: string, page: PageSize, title: string): Promise<Blob> {
  const canvas = await renderSvg(svg, 4000);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas');
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  const packed = new Blob([gray.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate'));
  const data = new Uint8Array(await new Response(packed).arrayBuffer());
  const pdf = imagePdf({ width, height, gray: true, data }, { page, title });
  return new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' });
}

/** File-name-safe slug from a Hebrew title (Hebrew letters are fine in file names) */
export const fileSlug = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 60) || 'model';
