/**
 * Instructions that turn a description (+ bill of quantities, photo or sketch) into layout JSON
 * (see scene.ts), and the prompt around them. Shared by the app (Gemini) and the prototype (Claude).
 */

export const LAYOUT_INSTRUCTIONS = `You turn a metalwork job (gate, fence, railing, pergola, stairs, pipe work) into a 3D layout that a viewer draws.
The input is a description, usually in Hebrew and often dictated, and sometimes a bill of quantities.
Reply with ONE JSON object and nothing else: no prose, no code fences.

AXES AND UNITS
- Millimetres. Y is up and the ground is y = 0 (anything set in concrete goes below 0).
- X runs along the opening, left to right as seen from the street. Start the work at x = 0.
- Z is depth: +Z faces the street, -Z is inside the property. The gate or fence plane is z = 0.

MEMBERS: every piece of profile, tube or bar. "members": [ ... ]
{ "id": "post-l", "profile": "rect_tube", "size": [100, 100, 4], "material": "black", "from": [50, -600, 0], "to": [50, 1900, 0], "label": "עמוד" }
- from and to are the real ends of the piece on its centre line, so the distance between them is the cut length.
- Butt joints, no mitres: posts and stiles run the full height; rails sit between the stiles, face to face;
  pickets sit between the rails. A rail between stiles centred at x=140 and x=2530 (50 wide) runs from x=165 to x=2505.
- profile and size:
  rect_tube [face, depth, wall]  square or rectangular tube. face = the width you see from the street
                                 (for a horizontal member: its height); depth = across the gate (along Z).
  round_tube [outside diameter, wall]   round_bar [diameter]   square_bar [side]
  flat [width, thickness] (the width faces the street)   angle [leg, leg, thickness]
  upn [height]  ipe [height]  hea [height]   (standard tables: upn 50–200, ipe 80–300, hea 100–240)
- Use sizes that exist in Israel: square 20/20 to 150/150, rectangular 30/20, 40/20, 50/25, 50/30, 60/30, 60/40, 80/40,
  100/50, 120/60; walls 1.5, 2, 3, 4 mm; flats 20/3 to 100/10; bars Ø8 to Ø25; tubes ½ to 4 inch
  (outside 21.3, 26.9, 33.7, 42.4, 48.3, 60.3, 76.1, 88.9, 114.3).
- material: black (painted steel, the default), galv, stainless, aluminum.
- Arcs: add "via", a point on the curve between from and to (for an arch: the top middle point).
- Many identical pieces: "repeat": { "count": N, "between": [a, b], "axis": "x" } puts N copies evenly spaced strictly between
  coordinates a and b on that axis (the member's own coordinate on that axis is ignored). Or "repeat": { "count": N, "step": [dx, dy, dz] }.
  For "every 12 cm" between a and b: N = round((b - a) / 120) - 1.
- "trim_to": "<member id>" stops a member where it meets that member's face. Pickets under an arched top: give them a
  generous "to" height and "trim_to" the arch.
- "end_cap": "finial" | "ball" | "cap" decorates the "to" end (spear tops, ball tops, post caps).
- "roll": degrees about the member's own axis (rarely needed; e.g. 45 for a V track made of angle).
- "group": "<group id>" on everything that moves together (a gate leaf).

PLATES: sheets, cladding, base plates, closing plates. "plates": [ { "center": [x, y, z], "size": [a, b], "normal": "z", "thickness": 2 } ]
  normal "z": size = [width along x, height along y]. normal "x": [along z, along y]. normal "y": [along x, along z].

PARTS: hardware. "parts": [ { "kind": "hinge", "at": [x, y, z] } ]
  kinds: hinge, wheel, guide_roller, lock, handle, drop_bolt, stopper, footing, motor, cap, finial, scroll.
  footing has "size": [x, y, z] of the concrete block. wheel "size": [diameter, width]. Parts may have "group" and "repeat".

SURROUNDINGS (not steel, not in the cut list): "solids": [ { "kind": "stone", "center": [x, y, z], "size": [x, y, z] } ]
  kinds: concrete, stone, plaster, wood, paving. Use them for existing walls, pillars and paving the work attaches to.

MEASUREMENTS (optional): "dimensions": [ { "from": [x, y, z], "to": [x, y, z], "label": "קטע מוחלף" } ]
  Extra measurements the client cares about that the overall size does not show: an opening between walls, a
  replaced pipe segment, a step height. The length is measured from "from" to "to"; "label" is a short NAME only,
  never a number. Move them with the geometry when you change it. Overall width, height and each leaf are measured
  automatically: do not add those.

MOVING PARTS: "groups": [ { "id": "leaf-l", "label": "כנף שמאל", "motion": { "type": "swing", "pivot": [x, 0, z], "angle": 90 } } ]
  swing: about a vertical axis through pivot (the hinge line). Opening inward, away from the street:
         a leaf hinged on its LEFT side uses +90, a leaf hinged on its RIGHT side uses -90.
  slide: { "type": "slide", "offset": [dx, 0, 0] } = how far the leaf travels to open.

TOP LEVEL
{ "version": 1, "title": "...", "material": "black",
  "finish": { "color": "#2f3337", "name": "צביעה בתנור אפור גרפיט" },
  "members": [...], "plates": [...], "parts": [...], "solids": [...], "groups": [...], "dimensions": [...], "notes": ["..."] }
- title, labels and notes in Hebrew. Write sizes as 60/40/2, never with ×. Never names, phone numbers or addresses of people.
- notes: the assumptions you made (sizes you chose, measurements that were missing). Keep them short.
- Realistic details: 10–20 mm between a leaf and its post on the hinge side, 10–15 mm between two leaves,
  50–80 mm under a swing gate; posts 500–700 mm into a concrete footing; at least two hinges per leaf
  (three above 2 m tall or 150 kg); a sliding gate needs wheels on a ground track and a guide roller at the top.
- If a bill of quantities is given, use exactly those profiles and sizes.

CHANGES
If you get a current layout and a request, apply the request and return the COMPLETE updated layout under the same
rules, keeping everything else as it was. Recompute whatever depends on the change (positions, lengths, repeats, trims).`;

export interface PromptBoqLine {
  description: string;
  element_name?: string | null;
  quantity: number;
  unit: string;
  pieces?: number | null;
  length_mm?: number | null;
}

export interface LayoutPromptInput {
  job?: { title: string; kind?: string; description?: string | null };
  boq?: PromptBoqLine[];
  /** The model as it is now (to change it), or nothing (to start one) */
  current?: unknown;
  /** Changes already applied, oldest first */
  requests?: string[];
  /** What the user asked now (Hebrew) */
  request: string;
  hasImage?: boolean;
}

function boqLine(l: PromptBoqLine): string {
  const what = l.element_name && l.element_name !== l.description ? `${l.description} [${l.element_name}]` : l.description;
  if (l.pieces && l.length_mm) return `- ${what}: ${l.pieces} pieces of ${l.length_mm} mm`;
  return `- ${what}: ${l.quantity} ${l.unit}`;
}

/** The whole prompt: instructions, job, bill of quantities, current layout, the request. Never client details. */
export function buildLayoutPrompt(input: LayoutPromptInput): string {
  const parts = [LAYOUT_INSTRUCTIONS];
  if (input.job) {
    parts.push(
      [`JOB: ${input.job.title}`, input.job.kind ? `Type: ${input.job.kind}` : '', input.job.description ? `Notes: ${input.job.description}` : '']
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (input.boq && input.boq.length > 0) {
    parts.push(`BILL OF QUANTITIES (use these profiles and sizes):\n${input.boq.slice(0, 80).map(boqLine).join('\n')}`);
  }
  if (input.current) {
    parts.push(`CURRENT LAYOUT:\n${JSON.stringify(input.current)}`);
    const reqs = (input.requests ?? []).slice(-10);
    if (reqs.length > 0) parts.push(`Changes already applied, oldest first:\n${reqs.map((r) => `- ${r}`).join('\n')}`);
    parts.push(`REQUEST (Hebrew):\n${input.request}`);
  } else {
    parts.push(`DESCRIPTION (Hebrew):\n${input.request}`);
  }
  if (input.hasImage) {
    parts.push('An image is attached: a photo or a hand sketch of the work. Follow its design and proportions; measurements in the text win.');
  }
  parts.push('Reply with the complete layout as ONE JSON object, nothing else.');
  return parts.join('\n\n');
}

/** Requests that built the current design, oldest first: newest version back to the one that started it. */
export function designRequests(history: { request: string | null; mode: 'new' | 'edit' }[]): string[] {
  const out: string[] = [];
  for (const v of history) {
    if (v.request) out.unshift(v.request);
    if (v.mode === 'new') break;
  }
  return out;
}

/** Pulls the JSON object out of a model reply (code fences or a sentence around it are tolerated). */
export function parseLayoutReply(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no_json');
  return JSON.parse(text.slice(start, end + 1));
}
