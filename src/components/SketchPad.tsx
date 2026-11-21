/**
 * A blank page to draw a job on by hand, seen from the front: a finger on the phone, or a pen on a tablet (then
 * fingers only pan and zoom). Each stroke becomes a straight line that snaps to what is already drawn
 * (core/sketch.ts); a scribble over a line erases it; two fingers pan and zoom. Nothing is measured here: the
 * builder turns the lines into a grid of guessed measurements afterwards.
 */
import { useRef, useState } from 'react';
import { addSketchLine, eraseSketchLine } from '../core/sketch.ts';
import type { SketchLine } from '../core/sketch.ts';
import { classifyStroke } from '../core/pen.ts';
import type { P2 } from '../core/pen.ts';
import { viewBoxOf } from '../core/viewport.ts';
import { useCanvasGestures } from './canvasGestures.ts';
import { Icon } from './Icon.tsx';
import { toast } from './Toast.tsx';

/** The page's own units (its SVG viewBox) */
export const PAD_W = 360;
export const PAD_H = 400;
const PAPER = 20;

export function SketchPad({
  lines,
  onLines,
  fingers,
  onPenSeen,
}: {
  lines: SketchLine[];
  onLines: (next: SketchLine[]) => void;
  /** Fingers draw (a phone); otherwise only a pen does and fingers pan */
  fingers: boolean;
  onPenSeen: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ink, setInk] = useState<P2[]>([]);
  const onStroke = (points: P2[]) => {
    // Tolerances are a few screen pixels, whatever the zoom; a finger gets a little more room than a pen
    const zoom = zoomNow();
    const stroke = classifyStroke(points, (fingers ? 8 : 6) / zoom);
    if (stroke.kind === 'line') {
      const next = addSketchLine(lines, stroke.from, stroke.to, (fingers ? 14 : 10) / zoom);
      if (next) onLines(next);
    } else if (stroke.kind === 'scribble') {
      const next = eraseSketchLine(lines, points, 10 / zoom);
      if (next) {
        onLines(next);
        toast('נמחק. אפשר לבטל.');
      }
    } else if (stroke.kind === 'other') toast('לא זוהה קו ישר. מותחים קו ישר, או מקשקשים על קו כדי למחוק.');
  };
  const gestures = useCanvasGestures(svgRef, PAD_W, PAD_H, { onMove: setInk, onEnd: onStroke, fingers }, onPenSeen);
  const zoomNow = () => gestures.view.zoom;
  const z = 1 / gestures.view.zoom;
  const ends = new Map(lines.flatMap((l) => [l.a, l.b]).map((p) => [`${p.x},${p.y}`, p]));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={viewBoxOf(gestures.view, PAD_W, PAD_H)}
        className="plate block w-full select-none rounded-md bg-card"
        style={{ touchAction: 'none' }}
        role="img"
        aria-label="דף לציור ביד"
        {...gestures.handlers}
      >
        {/* squared paper, only to draw by */}
        {Array.from({ length: PAD_W / PAPER - 1 }, (_, i) => (
          <line key={`px${i}`} x1={(i + 1) * PAPER} x2={(i + 1) * PAPER} y1={0} y2={PAD_H} className="stroke-line" strokeOpacity="0.45" strokeWidth={0.6 * z} />
        ))}
        {Array.from({ length: PAD_H / PAPER - 1 }, (_, i) => (
          <line key={`py${i}`} x1={0} x2={PAD_W} y1={(i + 1) * PAPER} y2={(i + 1) * PAPER} className="stroke-line" strokeOpacity="0.45" strokeWidth={0.6 * z} />
        ))}
        {lines.map((l, i) => (
          <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} className="stroke-ink" strokeWidth={4 * z} strokeLinecap="round" />
        ))}
        {[...ends.values()].map((p) => (
          <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={3.5 * z} strokeWidth={1.5 * z} className="fill-card stroke-ink" />
        ))}
        {ink.length > 1 && (
          <polyline
            points={ink.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            className="stroke-accent"
            strokeWidth={2.5 * z}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
      </svg>
      {lines.length === 0 && ink.length === 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-muted">{fingers ? 'מציירים כאן באצבע' : 'מציירים כאן בעט'}</p>
      )}
      {gestures.zoomed && (
        <button
          type="button"
          onClick={gestures.fit}
          className="absolute end-2 top-2 flex min-h-10 items-center gap-1.5 rounded-md border border-line-strong bg-card px-3 text-[0.85rem] font-semibold shadow-sm"
        >
          <Icon name="shrink" size={16} />
          כל הדף
        </button>
      )}
    </div>
  );
}
