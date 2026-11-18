/**
 * Shop drawing from a 3D layout: front elevation (seen from the street) with dimensions, piece marks
 * and the cut list, on an A3 sheet. Pure string output (SVG), so it works in the app, on the server and
 * in tests. A fabrication aid, not an engineered drawing.
 */
import { add, arcPoint, arcThrough, boundsOf, cutList, memberLength, norm, scale, sectionAxes, sub, workBounds } from './scene.ts';
import type { CutList, ResolvedMember, ResolvedScene, Vec3 } from './scene.ts';
import { BEAMS } from './sections.ts';

type P2 = [number, number];

const SHEET_W = 420;
const SHEET_H = 297;
const AREA = { x: 12, y: 12, w: 268, h: 228 };
const TABLE = { x: 290, w: 120 };
const SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 100) / 100;

/** Half extents of a member's section along its face (f) and depth (n) axes. */
function halfSection(m: ResolvedMember): [number, number] {
  const [a = 0, b = a] = m.size;
  switch (m.profile) {
    case 'round_tube':
    case 'round_bar':
      return [a / 2, a / 2];
    case 'square_bar':
      return [a / 2, a / 2];
    case 'upn':
    case 'ipe':
    case 'hea': {
      const s = BEAMS[m.profile][a];
      return [s.h / 2, s.b / 2];
    }
    default:
      return [a / 2, b / 2];
  }
}

function hull(points: P2[]): P2[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const crossZ = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Outline of a member in the front view (model mm, X right, Y up). */
export function memberOutline(m: ResolvedMember): P2[] {
  const [hf, hn] = halfSection(m);
  if (m.via) {
    const arc = arcThrough(m.from, m.via, m.to);
    if (arc) {
      const outer: P2[] = [];
      const inner: P2[] = [];
      for (let i = 0; i <= 32; i++) {
        const p = arcPoint(arc, i / 32);
        const radial = norm(sub(p, arc.center));
        const o = add(p, scale(radial, hf));
        const n = sub(p, scale(radial, hf));
        outer.push([o[0], o[1]]);
        inner.push([n[0], n[1]]);
      }
      return [...outer, ...inner.reverse()];
    }
  }
  const { f, n } = sectionAxes(sub(m.to, m.from));
  const corners: P2[] = [];
  for (const end of [m.from, m.to]) {
    for (const sf of [-1, 1]) {
      for (const sn of [-1, 1]) {
        const p = add(end, add(scale(f, sf * hf), scale(n, sn * hn)));
        corners.push([p[0], p[1]]);
      }
    }
  }
  return hull(corners);
}

function midpoint(m: ResolvedMember): Vec3 {
  if (m.via) {
    const arc = arcThrough(m.from, m.via, m.to);
    if (arc) return arcPoint(arc, 0.5);
  }
  return scale(add(m.from, m.to), 0.5);
}

export interface DrawingOptions {
  date?: string;
  business?: string;
  cut?: CutList;
}

export function shopDrawingSvg(scene: ResolvedScene, opts: DrawingOptions = {}): string {
  const cut = opts.cut ?? cutList(scene);
  // Frame the fabricated work. A long ground track would otherwise shrink the drawing; it stays in the
  // cut list and is clipped at the sheet's edge.
  const b = workBounds(scene);
  const footings = scene.parts.filter(
    (p) => p.kind === 'footing' && p.at[0] > b.min[0] - 500 && p.at[0] < b.max[0] + 500 && (p.size?.[0] ?? 0) < 3000,
  );
  let minY = Math.min(b.min[1], 0);
  for (const f of footings) minY = Math.min(minY, f.at[1] - (f.size?.[1] ?? 600) / 2);
  const modelW = Math.max(b.max[0] - b.min[0], 1);
  const modelH = Math.max(b.max[1] - minY, 1);

  // Largest standard scale that fits, leaving room for dimensions
  const fit = Math.min((AREA.w - 40) / modelW, (AREA.h - 36) / modelH);
  const denom = SCALES.find((d) => 1 / d <= fit) ?? Math.ceil(1 / fit);
  const s = 1 / denom;
  const ox = AREA.x + 20 + (AREA.w - 40 - modelW * s) / 2 - b.min[0] * s;
  const oy = AREA.y + 14 + (AREA.h - 36 - modelH * s) / 2 + b.max[1] * s;
  const X = (x: number) => r1(ox + x * s);
  const Y = (y: number) => r1(oy - y * s);
  const poly = (pts: P2[]) => pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${SHEET_W} ${SHEET_H}" font-family="IBM Plex Sans Hebrew, Arial, sans-serif">`,
    `<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>`,
    `<rect x="6" y="6" width="${SHEET_W - 12}" height="${SHEET_H - 12}" fill="none" stroke="#111" stroke-width="0.5"/>`,
    `<defs><clipPath id="area"><rect x="${AREA.x}" y="${AREA.y}" width="${AREA.w}" height="${AREA.h}"/></clipPath>`,
    `<pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#999" stroke-width="0.25"/></pattern></defs>`,
    `<g clip-path="url(#area)">`,
  );

  // Surroundings and footings, dashed
  for (const so of scene.solids) {
    const [cx, cy] = so.center;
    const [w, h] = so.size;
    out.push(
      `<rect x="${X(cx - w / 2)}" y="${Y(cy + h / 2)}" width="${r1(w * s)}" height="${r1(h * s)}" fill="none" stroke="#aaa" stroke-width="0.25" stroke-dasharray="1.5 1"/>`,
    );
  }
  for (const f of footings) {
    const [w = 400, h = 600] = f.size ?? [];
    out.push(
      `<rect x="${X(f.at[0] - w / 2)}" y="${Y(f.at[1] + h / 2)}" width="${r1(w * s)}" height="${r1(h * s)}" fill="url(#hatch)" stroke="#888" stroke-width="0.25" stroke-dasharray="1.5 1"/>`,
    );
  }
  // Ground
  out.push(
    `<line x1="${AREA.x}" y1="${Y(0)}" x2="${AREA.x + AREA.w}" y2="${Y(0)}" stroke="#555" stroke-width="0.35"/>`,
  );

  // Plates behind, then members far to near
  for (const p of scene.plates) {
    const [a, c] = p.size;
    const [w, h] = p.normal === 'z' ? [a, c] : p.normal === 'x' ? [p.thickness, c] : [a, p.thickness];
    out.push(
      `<rect x="${X(p.center[0] - w / 2)}" y="${Y(p.center[1] + h / 2)}" width="${r1(w * s)}" height="${r1(h * s)}" fill="#f2f2f2" stroke="#444" stroke-width="0.2"/>`,
    );
  }
  const members = [...scene.members].sort((a, c) => (a.from[2] + a.to[2]) / 2 - (c.from[2] + c.to[2]) / 2);
  for (const m of members) {
    out.push(`<polygon points="${poly(memberOutline(m))}" fill="#e6e6e6" stroke="#111" stroke-width="0.22" stroke-linejoin="round"/>`);
  }

  // Hardware as simple symbols
  for (const p of scene.parts) {
    const [x, y] = p.at;
    if (p.kind === 'footing') continue;
    if (p.kind === 'wheel' || p.kind === 'scroll' || p.kind === 'guide_roller') {
      const r = ((p.size?.[0] ?? (p.kind === 'scroll' ? 120 : 100)) / 2) * s;
      out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${r1(Math.max(r, 0.8))}" fill="none" stroke="#111" stroke-width="0.25"/>`);
    } else {
      const [w, h] = p.kind === 'hinge' ? [30, 120] : p.kind === 'lock' ? [100, 160] : p.kind === 'motor' ? [300, 300] : [40, 40];
      out.push(
        `<rect x="${X(x - w / 2)}" y="${Y(y + h / 2)}" width="${r1(Math.max(w * s, 0.8))}" height="${r1(Math.max(h * s, 0.8))}" fill="#333"/>`,
      );
    }
  }
  out.push('</g>');

  // Dimensions
  const text = (x: number, y: number, t: string, size = 2.8, extra = '') =>
    `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" text-anchor="middle" fill="#111"${extra}>${esc(t)}</text>`;
  const tick = (x: number, y: number) => `<line x1="${r1(x - 0.9)}" y1="${r1(y + 0.9)}" x2="${r1(x + 0.9)}" y2="${r1(y - 0.9)}" stroke="#111" stroke-width="0.3"/>`;
  const dimH = (x1: number, x2: number, y: number, objY: number, label: string) => {
    out.push(
      `<line x1="${X(x1)}" y1="${r1(Math.min(objY, y) - 0)}" x2="${X(x1)}" y2="${r1(y + 1.5)}" stroke="#666" stroke-width="0.15"/>`,
      `<line x1="${X(x2)}" y1="${r1(Math.min(objY, y))}" x2="${X(x2)}" y2="${r1(y + 1.5)}" stroke="#666" stroke-width="0.15"/>`,
      `<line x1="${X(x1)}" y1="${r1(y)}" x2="${X(x2)}" y2="${r1(y)}" stroke="#111" stroke-width="0.2"/>`,
      tick(X(x1), y),
      tick(X(x2), y),
      text((X(x1) + X(x2)) / 2, y - 1, label),
    );
  };
  const dimV = (y1: number, y2: number, x: number, objX: number, label: string) => {
    out.push(
      `<line x1="${r1(objX)}" y1="${Y(y1)}" x2="${r1(x + 1.5)}" y2="${Y(y1)}" stroke="#666" stroke-width="0.15"/>`,
      `<line x1="${r1(objX)}" y1="${Y(y2)}" x2="${r1(x + 1.5)}" y2="${Y(y2)}" stroke="#666" stroke-width="0.15"/>`,
      `<line x1="${r1(x)}" y1="${Y(y1)}" x2="${r1(x)}" y2="${Y(y2)}" stroke="#111" stroke-width="0.2"/>`,
      tick(x, Y(y1)),
      tick(x, Y(y2)),
      text(x - 1, (Y(y1) + Y(y2)) / 2, label, 2.8, ` transform="rotate(-90 ${r1(x - 1)} ${r1((Y(y1) + Y(y2)) / 2)})"`),
    );
  };

  const groundY = Y(Math.min(minY, 0));
  const leafRows = scene.groups
    .map((g) => {
      const ms = scene.members.filter((m) => m.group === g.id);
      if (ms.length === 0) return null;
      const lb = boundsOf(ms);
      return { label: g.label ?? g.id, minX: lb.min[0], maxX: lb.max[0], minY: lb.min[1], maxY: lb.max[1] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  let dimY = groundY + 6;
  if (leafRows.length > 0) {
    for (const l of leafRows) dimH(l.minX, l.maxX, dimY, Y(l.minY), String(Math.round(l.maxX - l.minX)));
    dimY += 7;
  }
  dimH(b.min[0], b.max[0], dimY, Y(b.min[1]), String(Math.round(b.max[0] - b.min[0])));

  const rightX = X(b.max[0]);
  dimV(0, b.max[1], rightX + 8, rightX + 1, String(Math.round(b.max[1])));
  if (leafRows[0]) {
    const l = leafRows[0];
    dimV(l.minY, l.maxY, rightX + 15, rightX + 1, String(Math.round(l.maxY - l.minY)));
    if (l.minY > 5) dimV(0, l.minY, rightX + 15, rightX + 1, String(Math.round(l.minY)));
  }
  if (b.min[1] < -5) dimV(b.min[1], 0, X(b.min[0]) - 8, X(b.min[0]) - 1, String(Math.round(-b.min[1])));
  for (const d of scene.dimensions ?? []) {
    const horizontal = Math.abs(d.to[0] - d.from[0]) >= Math.abs(d.to[1] - d.from[1]);
    if (horizontal) dimH(Math.min(d.from[0], d.to[0]), Math.max(d.from[0], d.to[0]), Y(Math.max(d.from[1], d.to[1])) - 6, Y(d.from[1]), d.label ?? String(Math.round(Math.abs(d.to[0] - d.from[0]))));
    else dimV(Math.min(d.from[1], d.to[1]), Math.max(d.from[1], d.to[1]), X(Math.min(d.from[0], d.to[0])) - 6, X(d.from[0]), d.label ?? String(Math.round(Math.abs(d.to[1] - d.from[1]))));
  }

  // Piece marks: one bubble per mark, beside its first piece, nudged until it doesn't cover another bubble
  const placed: P2[] = [];
  for (const piece of cut.pieces) {
    const m = scene.members.find((x) => x.id === piece.ids[0]);
    if (!m) continue;
    const mid = midpoint(m);
    const dir = norm(sub(m.to, m.from));
    const vertical = Math.abs(dir[1]) > 0.7 && !m.via;
    const [hf] = halfSection(m);
    const off = hf * s + 3.2;
    let bx = vertical ? X(mid[0]) + off : X(mid[0]);
    let by = vertical ? Y(mid[1]) : Y(mid[1]) - off;
    for (let k = 0; k < 12 && placed.some(([px, py]) => Math.hypot(px - bx, py - by) < 5.2); k++) {
      if (vertical) by -= 5.4;
      else bx += 5.4;
    }
    placed.push([bx, by]);
    out.push(
      `<line x1="${X(mid[0])}" y1="${Y(mid[1])}" x2="${r1(bx)}" y2="${r1(by)}" stroke="#111" stroke-width="0.15"/>`,
      `<circle cx="${r1(bx)}" cy="${r1(by)}" r="2.4" fill="#fff" stroke="#111" stroke-width="0.25"/>`,
      text(bx, by + 1, piece.mark, 2.6, ' font-weight="bold"'),
    );
  }

  // Cut list table (right side, Hebrew, right-aligned)
  const right = TABLE.x + TABLE.w;
  const col = { mark: right - 2, desc: right - 12, qty: TABLE.x + 30, len: TABLE.x + 16 };
  let ty = 18;
  // Hebrew lines: right-to-left paragraphs anchored at their right edge
  const rt = (x: number, y: number, t: string, size = 2.6, extra = '') =>
    `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" direction="rtl" text-anchor="start" fill="#111"${extra}>${esc(t)}</text>`;
  out.push(rt(right - 2, ty, 'רשימת חיתוך', 4, ' font-weight="bold"'));
  ty += 6;
  out.push(
    rt(col.mark, ty, 'סימון', 2.4, ' font-weight="bold"'),
    rt(col.desc, ty, 'תיאור', 2.4, ' font-weight="bold"'),
    rt(col.qty, ty, 'כמות', 2.4, ' font-weight="bold"'),
    rt(col.len, ty, 'אורך', 2.4, ' font-weight="bold"'),
    `<line x1="${TABLE.x}" y1="${ty + 1.4}" x2="${right}" y2="${ty + 1.4}" stroke="#111" stroke-width="0.25"/>`,
  );
  ty += 5;
  const maxRows = 30;
  for (const p of cut.pieces.slice(0, maxRows)) {
    out.push(
      rt(col.mark, ty, p.mark, 2.6, ' font-weight="bold"'),
      rt(col.desc, ty, `${p.name}${p.bent ? ' (מכופף)' : ''}`),
      rt(col.qty, ty, String(p.count)),
      rt(col.len, ty, String(p.length)),
      `<line x1="${TABLE.x}" y1="${ty + 1.4}" x2="${right}" y2="${ty + 1.4}" stroke="#ccc" stroke-width="0.15"/>`,
    );
    ty += 4.6;
  }
  if (cut.pieces.length > maxRows) {
    out.push(rt(right - 2, ty, `ועוד ${cut.pieces.length - maxRows} שורות ברשימה המלאה`, 2.4));
    ty += 4.6;
  }
  for (const p of cut.plates) {
    out.push(rt(col.desc, ty, `${p.name} ${p.w}/${p.h}`), rt(col.qty, ty, String(p.count)));
    ty += 4.6;
  }
  if (cut.parts.length > 0) {
    ty += 1.5;
    out.push(rt(right - 2, ty, cut.parts.map((p) => `${p.label} ${p.count}`).join(', '), 2.4));
    ty += 4.6;
  }
  out.push(rt(right - 2, ty + 1.5, `משקל ברזל משוער: ${Math.round(cut.totalKg)} ק״ג`, 2.6, ' font-weight="bold"'));

  // Assumptions under the drawing
  const notes = (scene.notes ?? []).slice(0, 4);
  notes.forEach((n, i) => out.push(rt(AREA.x + AREA.w, AREA.y + AREA.h + 8 + i * 4, `• ${n}`, 2.4)));

  // Title block
  const tb = { x: TABLE.x, y: 247, w: TABLE.w, h: 44 };
  out.push(
    `<rect x="${tb.x}" y="${tb.y}" width="${tb.w}" height="${tb.h}" fill="none" stroke="#111" stroke-width="0.4"/>`,
    rt(right - 3, tb.y + 7, scene.title, 4, ' font-weight="bold"'),
    rt(right - 3, tb.y + 13.5, 'שרטוט ייצור: חזית, מבט מהרחוב', 2.8),
    rt(right - 3, tb.y + 19, `מידות במ״מ. קנה מידה 1:${denom} בהדפסה על A3`, 2.6),
    rt(right - 3, tb.y + 24.5, scene.finish?.name ? `גמר: ${scene.finish.name}` : 'גמר: לפי הצעת המחיר', 2.6),
    rt(right - 3, tb.y + 30, 'אורכים לחיתוך לפי מרכז הפרופיל, חיבורי קצה ישרים. לבדוק לפני חיתוך.', 2.3),
    rt(right - 3, tb.y + 38.5, `${opts.business ?? 'גץ ועפר'}${opts.date ? `, ${opts.date}` : ''}`, 2.8, ' font-weight="bold"'),
  );
  out.push('</svg>');
  return out.join('\n');
}

/** Total length (m) of all members, for quick checks against the bill of quantities. */
export function totalMetres(scene: ResolvedScene): number {
  return Math.round(scene.members.reduce((sum, m) => sum + memberLength(m), 0)) / 1000;
}

