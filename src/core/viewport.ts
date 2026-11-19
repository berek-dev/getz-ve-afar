/**
 * Zoom and pan for a drawing of size W/H (its own units): which part of it shows. A gesture keeps the point under
 * the fingers where it is: pinch about the fingers' middle, drag to pan, wheel about the cursor.
 */

export interface Viewport {
  /** Top-left of the visible part, in drawing units */
  x: number;
  y: number;
  /** 1 = the whole drawing */
  zoom: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const FULL: Viewport = { x: 0, y: 0, zoom: 1 };

/** Keeps the zoom in range and the view inside the drawing */
export function clampViewport(v: Viewport, W: number, H: number): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(v.zoom) ? v.zoom : 1));
  const w = W / zoom;
  const h = H / zoom;
  const x = Math.min(W - w, Math.max(0, v.x));
  const y = Math.min(H - h, Math.max(0, v.y));
  return { x, y, zoom };
}

/** The drawing point at a place on the screen, given as fractions (0..1) of the canvas' width and height */
export function toDrawing(v: Viewport, W: number, H: number, fx: number, fy: number): { x: number; y: number } {
  return { x: v.x + (fx * W) / v.zoom, y: v.y + (fy * H) / v.zoom };
}

/** The view at `zoom` that shows drawing point `p` at screen place (fx, fy) */
export function keepUnder(p: { x: number; y: number }, zoom: number, fx: number, fy: number, W: number, H: number): Viewport {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return clampViewport({ x: p.x - (fx * W) / z, y: p.y - (fy * H) / z, zoom: z }, W, H);
}

/**
 * A pinch (or a drag, with the same distance): `start` is the view when the fingers went down, at (fx0, fy0) and
 * `d0` apart; they are now at (fx1, fy1) and `d1` apart.
 */
export function pinch(start: Viewport, W: number, H: number, fx0: number, fy0: number, d0: number, fx1: number, fy1: number, d1: number): Viewport {
  const anchor = toDrawing(start, W, H, fx0, fy0);
  const factor = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  return keepUnder(anchor, start.zoom * factor, fx1, fy1, W, H);
}

/** A mouse wheel or trackpad pinch: zoom by `factor` about the cursor */
export function zoomAt(v: Viewport, W: number, H: number, factor: number, fx: number, fy: number): Viewport {
  return keepUnder(toDrawing(v, W, H, fx, fy), v.zoom * factor, fx, fy, W, H);
}

export const viewBoxOf = (v: Viewport, W: number, H: number) => `${v.x} ${v.y} ${W / v.zoom} ${H / v.zoom}`;
