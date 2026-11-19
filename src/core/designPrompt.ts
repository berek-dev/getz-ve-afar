/**
 * Reading a hand sketch (a photo of paper, a tablet drawing or a PDF) into the hand builder's design: a grid of
 * measured lines, parts between grid points, and blocks. The AI only reads the drawing; the builder's own code
 * makes the joints, the cut list and the shop drawing. Shared by Gemini on the server and Yaal's own AI app
 * (copy the instructions, paste the answer back).
 */
import { BLOCKS, BLOCK_KINDS, placementError } from './blocks.ts';
import type { BlockKind } from './blocks.ts';
import { MATERIAL_KEYS } from './catalog.ts';
import type { MaterialKey } from './catalog.ts';
import { PROFILE_LABELS, SIZE_PARTS, addBlock, addInfill, addMember, newDesign, parseSize, updateBlock, updateMember } from './design.ts';
import type { Design, DesignNode } from './design.ts';
import { PROFILES } from './scene.ts';
import type { Profile } from './scene.ts';

const profileLines = PROFILES.map((p) => `  ${p} (${PROFILE_LABELS[p]}): ${SIZE_PARTS[p]} number${SIZE_PARTS[p] > 1 ? 's' : ''}`).join('\n');
const blockLines = BLOCK_KINDS.map((k) => {
  const b = BLOCKS[k];
  const params = b.params.filter((p) => !p.hidden).map((p) => `${p.key}${p.options ? ` (${p.options.map((o) => o.value).join('|')})` : ''}=${p.def}`);
  return `  ${k} (${b.label}): ${b.place} params: ${params.join(', ')}`;
}).join('\n');

export const DESIGN_INSTRUCTIONS = `You read a metalwork sketch (a photo of a hand drawing, a tablet drawing or a PDF) and write it down as a measured
grid with parts between grid points, for a builder app that makes the 3D model, cut list and shop drawing from it.
Reply with ONE JSON object and nothing else: no prose, no code fences.

THE GRID (millimetres)
- "grid": { "x": [...], "y": [...], "z": [...] } lists the DISTANCES between consecutive grid lines, not positions.
  x runs left to right as drawn (the front view), y is height from the ground (y = 0 is the ground), z is depth.
  Example: posts at 0, 1500 and 3000 with a beam at 2100 high: "x": [1500, 1500], "y": [2100], "z": [].
- Put a grid line wherever a part starts, ends or meets another part. Leave "z" empty for flat work (a gate, a fence).
- Read the measurements written on the sketch. Convert cm or m to mm. When a size is not written, estimate it from the
  proportions of the drawing and say so in "notes".

PARTS: "members": [ { "a": [xi, yi, zi], "b": [xi, yi, zi], "profile": "rect_tube", "size": [60, 40, 2], "label": "עמוד" } ]
- a and b are grid POINTS given as line indices: [index along x, index along y, index along z], counting from 0.
  A post from the ground to the second level on the first line: "a": [0, 0, 0], "b": [0, 2, 0].
- Draw each straight piece between the grid points it spans; a long beam over three posts can be one member.
- Joints are made by the app (posts run through, beams stop at their faces): do not shorten anything.
- profile and how many size numbers it takes (sizes as written on the sketch, "60/40/2" means [60, 40, 2]):
${profileLines}
- If no size is written, use rect_tube [60, 60, 3] and say so in "notes".
- "base": { "w": 200, "d": 200, "t": 10 } on a post standing on the ground when the sketch shows a base plate.

INFILL: "infills": [ { "between": [i, j], "profile": "square_bar", "size": [16], "gap": 100 } ]
- Bars square to two parallel members, numbered by their place in "members" (from 0); gap is the largest clear gap.

BLOCKS (use them when the sketch shows one): "blocks": [ { "kind": "stairs", "a": [0, 0, 0], "b": [2, 1, 0], "params": { "width": 1000 } } ]
${blockLines}
- Levels are finished floor: the top of stairs and the deck of a platform are at the grid level.

"material": one of ${MATERIAL_KEYS.join(', ')} (black = painted steel, the default).
"notes": short Hebrew lines about anything you could not read or had to guess. Never invent a measurement silently.
`;

export interface DesignPromptInput {
  job: { title: string; kind?: string | null; description?: string | null };
  /** What Yaal typed with the sketch */
  note?: string | null;
}

export function buildDesignPrompt(input: DesignPromptInput): string {
  const job = [`Job: ${input.job.title}`, input.job.description?.trim() ? `Description: ${input.job.description.trim()}` : ''].filter(Boolean).join('\n');
  const note = input.note?.trim() ? `\nNote with the sketch: ${input.note.trim()}` : '';
  return `${DESIGN_INSTRUCTIONS}\n${job}${note}\n\nRead the attached sketch and reply with the JSON object.`;
}

export interface ReadDesign {
  design: Design;
  notes: string[];
  /** What was wrong and left out: sent back to the AI for one more try, shown to Yaal if it stays */
  problems: string[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const node = (v: unknown): DesignNode | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0) ? [v[0], v[1], v[2]] : null;

/** The JSON object in a reply (it may come wrapped in prose or code fences) */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no_json');
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * The design in an AI reply, checked piece by piece: what is wrong is left out and listed in `problems`, so a
 * mostly right reading still opens in the builder. Throws when there is no usable JSON or grid.
 */
export function designFromReply(text: string): ReadDesign {
  const raw = extractJson(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') throw new Error('no_json');
  const problems: string[] = [];
  const g = (raw.grid ?? {}) as Record<string, unknown>;
  const spacings = (v: unknown, name: string, allowEmpty: boolean): number[] => {
    const list = Array.isArray(v) ? v : [];
    const ok = list.filter((s): s is number => isNum(s) && s > 0 && s <= 60_000).map((s) => Math.round(s));
    if (ok.length !== list.length) problems.push(`grid.${name}: distances must be positive millimetres`);
    if (!allowEmpty && ok.length === 0) throw new Error('no_grid');
    return ok.slice(0, 40);
  };
  const material = MATERIAL_KEYS.includes(raw.material as MaterialKey) ? (raw.material as MaterialKey) : 'black';
  let design: Design = { ...newDesign(material), grid: { x: spacings(g.x, 'x', false), y: spacings(g.y, 'y', false), z: spacings(g.z, 'z', true) } };
  const inGrid = (n: DesignNode) => n[0] <= design.grid.x.length && n[1] <= design.grid.y.length && n[2] <= design.grid.z.length;

  const ids: (string | null)[] = [];
  (Array.isArray(raw.members) ? raw.members : []).slice(0, 400).forEach((m: Record<string, unknown>, i: number) => {
    const a = node(m?.a);
    const b = node(m?.b);
    const profile = PROFILES.includes(m?.profile as Profile) ? (m.profile as Profile) : null;
    const size = profile && Array.isArray(m.size) ? parseSize(profile, m.size.join('/')) : null;
    if (!a || !b || !inGrid(a) || !inGrid(b)) {
      problems.push(`members[${i}]: a and b must be grid points inside the grid`);
      ids.push(null);
      return;
    }
    if (!profile || !size) problems.push(`members[${i}]: unknown profile or size, used rect_tube 60/60/3`);
    const r = addMember(design, a, b, profile && size ? { profile, size } : { profile: 'rect_tube', size: [60, 60, 3] });
    design = r.design;
    ids.push(r.id);
    const label = typeof m.label === 'string' ? m.label.trim().slice(0, 40) : '';
    const base = m.base as Record<string, unknown> | undefined;
    if (r.id && (label || base)) {
      design = updateMember(design, r.id, {
        ...(label ? { label } : {}),
        ...(base && isNum(base.w) && isNum(base.d) && isNum(base.t) && base.w > 0 && base.d > 0 && base.t > 0 ? { base: { w: base.w, d: base.d, t: base.t } } : {}),
      });
    }
  });

  (Array.isArray(raw.infills) ? raw.infills : []).slice(0, 100).forEach((f: Record<string, unknown>, i: number) => {
    const between = Array.isArray(f?.between) ? f.between : [];
    const p = Number.isInteger(between[0]) ? ids[between[0] as number] : null;
    const q = Number.isInteger(between[1]) ? ids[between[1] as number] : null;
    const profile = PROFILES.includes(f?.profile as Profile) ? (f.profile as Profile) : 'square_bar';
    const size = (Array.isArray(f?.size) ? parseSize(profile, f.size.join('/')) : null) ?? [16];
    if (!p || !q || p === q) {
      problems.push(`infills[${i}]: between must name two different members by their index`);
      return;
    }
    design = addInfill(design, [p, q], { profile, size }, isNum(f.gap) && f.gap > 0 ? f.gap : 100).design;
  });

  (Array.isArray(raw.blocks) ? raw.blocks : []).slice(0, 40).forEach((k: Record<string, unknown>, i: number) => {
    const kind = BLOCK_KINDS.includes(k?.kind as BlockKind) ? (k.kind as BlockKind) : null;
    const a = node(k?.a);
    const b = node(k?.b);
    if (!kind || !a || !b || !inGrid(a) || !inGrid(b)) {
      problems.push(`blocks[${i}]: needs a known kind and two grid points inside the grid`);
      return;
    }
    const wrong = placementError(kind, a, b);
    if (wrong) {
      problems.push(`blocks[${i}] (${kind}): ${wrong}`);
      return;
    }
    const r = addBlock(design, kind, a, b);
    if (!r.id) return;
    design = r.design;
    const known = new Set(BLOCKS[kind].params.map((p) => p.key));
    const params: Record<string, number> = {};
    for (const [key, v] of Object.entries((k.params ?? {}) as Record<string, unknown>)) if (known.has(key) && isNum(v)) params[key] = v;
    if (Object.keys(params).length) design = updateBlock(design, r.id, { params });
  });

  if (design.members.length === 0 && design.blocks.length === 0) problems.push('no parts: add the members drawn on the sketch');
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim().slice(0, 200)).slice(0, 12);
  return { design, notes, problems };
}
