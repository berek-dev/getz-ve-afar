/** Sharing files from the phone (WhatsApp, mail, save to Files), with a download where sharing is missing. */

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

/** SVG markup → PNG at `scale` × its CSS size (the shop drawing is 420/297 mm). */
export async function svgToPng(svg: string, widthPx: number): Promise<Blob> {
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
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('encode_failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File-name-safe slug from a Hebrew title (Hebrew letters are fine in file names) */
export const fileSlug = (title: string) => title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 60) || 'model';
