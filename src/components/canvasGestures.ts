/**
 * Fingers on the builder's grid: pinch to zoom, drag to pan once zoomed in, ctrl+wheel (or a trackpad pinch) on a
 * computer. When drawing is on, strokes draw instead and their points go to `onMove`/`onEnd`. With a pen (pen mode)
 * only the pen draws, and fingers still pan and zoom meanwhile, so a palm on the screen does nothing. With `fingers`,
 * one finger (or the mouse) draws too, and a second finger turning up makes it a pinch. A short touch is still a
 * tap; taps that turned into a gesture don't reach the grid points.
 */
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { FULL, clampViewport, pinch, toDrawing, zoomAt } from '../core/viewport.ts';
import type { Viewport } from '../core/viewport.ts';

export interface PenEvents {
  /** Drawing points (the SVG's own units) of a stroke as it goes, and when the pen lifts */
  onMove: (points: { x: number; y: number }[]) => void;
  onEnd: (points: { x: number; y: number }[]) => void;
  /** One finger (or the mouse) draws too; two fingers pan and zoom */
  fingers?: boolean;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; start: Viewport; fx: number; fy: number; cx: number; cy: number; moved: boolean }
  | { kind: 'pinch'; start: Viewport; fx: number; fy: number; d: number };

const TAP_SLOP = 8;

export function useCanvasGestures(svgRef: RefObject<SVGSVGElement | null>, W: number, H: number, pen: PenEvents | null, onPenSeen?: () => void) {
  const [vp, setVp] = useState<Viewport>(FULL);
  const view = clampViewport(vp, W, H);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { cx: number; cy: number }>());
  const gesture = useRef<Gesture>({ kind: 'none' });
  const swallowClick = useRef(false);
  const stroke = useRef<{ id: number; points: { x: number; y: number }[]; cx: number; cy: number; travel: number; finger: boolean } | null>(null);

  const frac = (cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { fx: 0, fy: 0 };
    return { fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height };
  };
  const toPoint = (cx: number, cy: number) => {
    const { fx, fy } = frac(cx, cy);
    return toDrawing(viewRef.current, W, H, fx, fy);
  };
  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()];
    const mid = frac((a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
    return { ...mid, d: Math.hypot(a.cx - b.cx, a.cy - b.cy) };
  };

  // Ctrl+wheel and trackpad pinches zoom the grid, not the page (needs a non-passive listener)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const { fx, fy } = frac(e.clientX, e.clientY);
      setVp(zoomAt(viewRef.current, W, H, Math.exp(-e.deltaY * 0.01), fx, fy));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, W, H]);

  // While a stroke, a pinch or a pan is under way, the touch moves the drawing, never the page. touch-action alone
  // is not enough: Safari on the iPhone can start scrolling anyway (and cancels the stroke), so the moves are held
  // back here (needs a non-passive listener). Pointer events come before their touch events, so the stroke is known.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onTouchMove = (e: TouchEvent) => {
      const g = gesture.current;
      const ours = stroke.current !== null || g.kind === 'pinch' || (g.kind === 'press' && g.start.zoom > 1);
      if (ours && e.cancelable) e.preventDefault();
    };
    svg.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => svg.removeEventListener('touchmove', onTouchMove);
  }, [svgRef]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'pen') {
      // A pen means a tablet: pen mode, where fingers never draw
      if (!pen || pen.fingers) onPenSeen?.();
      if (pen) {
        e.preventDefault();
        try {
          // Keeps the stroke's events coming if the pen leaves the grid; some browsers refuse, and the stroke still works
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // drawn without capture
        }
        stroke.current = { id: e.pointerId, points: [toPoint(e.clientX, e.clientY)], cx: e.clientX, cy: e.clientY, travel: 0, finger: false };
        swallowClick.current = true;
        return;
      }
    }
    if (stroke.current && !stroke.current.finger) return; // a palm while the pen draws
    if (pointers.current.size === 0) swallowClick.current = false;
    pointers.current.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
    if (pointers.current.size === 2) {
      if (stroke.current) {
        // A second finger: the first one was starting a pinch, not a line
        stroke.current = null;
        pen?.onMove([]);
      }
      const t = twoFingers();
      gesture.current = { kind: 'pinch', start: viewRef.current, fx: t.fx, fy: t.fy, d: t.d };
      swallowClick.current = true;
    } else if (pointers.current.size === 1) {
      if (pen?.fingers && (e.pointerType !== 'mouse' || e.button === 0)) {
        stroke.current = { id: e.pointerId, points: [toPoint(e.clientX, e.clientY)], cx: e.clientX, cy: e.clientY, travel: 0, finger: true };
        gesture.current = { kind: 'none' };
        swallowClick.current = true;
        return;
      }
      const { fx, fy } = frac(e.clientX, e.clientY);
      gesture.current = { kind: 'press', start: viewRef.current, fx, fy, cx: e.clientX, cy: e.clientY, moved: false };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = stroke.current;
    if (s && e.pointerId === s.id) {
      s.travel += Math.hypot(e.clientX - s.cx, e.clientY - s.cy);
      s.cx = e.clientX;
      s.cy = e.clientY;
      s.points.push(toPoint(e.clientX, e.clientY));
      if (s.finger) pointers.current.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
      pen?.onMove([...s.points]);
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const t = twoFingers();
      setVp(pinch(g.start, W, H, g.fx, g.fy, g.d, t.fx, t.fy, t.d));
    } else if (g.kind === 'press') {
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) return;
      if (!g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) < TAP_SLOP) return;
      if (g.start.zoom <= 1) return; // nothing to pan: the page scrolls instead
      g.moved = true;
      swallowClick.current = true;
      const { fx, fy } = frac(e.clientX, e.clientY);
      setVp(pinch(g.start, W, H, g.fx, g.fy, 1, fx, fy, 1));
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    const s = stroke.current;
    if (s && e.pointerId === s.id) {
      stroke.current = null;
      pen?.onMove([]);
      if (s.finger) {
        pointers.current.delete(e.pointerId);
        gesture.current = { kind: 'none' };
      }
      if (e.type !== 'pointerup') return;
      if (s.travel < TAP_SLOP) {
        // A tap still works on the grid point, part or measurement under it. A finger's own click follows; the pen
        // held its capture, so its click is passed on to what lies under it.
        swallowClick.current = false;
        if (s.finger) return;
        const target = document.elementFromPoint(e.clientX, e.clientY);
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
        return;
      }
      pen?.onEnd(s.points);
      return;
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1 && gesture.current.kind === 'pinch') {
      // One finger stays down: it pans on from here
      const [p] = [...pointers.current.values()];
      const { fx, fy } = frac(p.cx, p.cy);
      gesture.current = { kind: 'press', start: viewRef.current, fx, fy, cx: p.cx, cy: p.cy, moved: true };
    } else if (pointers.current.size === 0) gesture.current = { kind: 'none' };
  };

  const onClickCapture = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return {
    view,
    zoomed: view.zoom > 1.001,
    fit: () => setVp(FULL),
    zoomBy: (factor: number) => setVp(zoomAt(viewRef.current, W, H, factor, 0.5, 0.5)),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onClickCapture,
    },
  };
}
