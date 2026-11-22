/**
 * A linear-elastic 3D frame: straight beam elements with 6 degrees of freedom per node (Euler–Bernoulli, no shear
 * deformation), rigid joints, supports that fix some of a node's degrees of freedom, point loads at nodes and
 * uniform loads along elements. Units: mm, N, MPa. Nodes are renumbered (reverse Cuthill–McKee) and the stiffness
 * is solved as a band; a pivot that vanishes means the frame is a mechanism there, and that node is reported.
 * Several load cases share one factorization.
 */
import type { Vec3 } from './scene.ts';

export interface FrameElement {
  a: number;
  b: number;
  /** Section: area, second moments about the local y and z axes, torsion constant */
  A: number;
  Iy: number;
  Iz: number;
  J: number;
  E: number;
  G: number;
  /** Local y axis (square to the element); z = x × y */
  y: Vec3;
}

export interface Frame {
  nodes: Vec3[];
  elements: FrameElement[];
  /** Fixed degrees of freedom per supported node: [ux, uy, uz, rx, ry, rz] */
  supports: Map<number, boolean[]>;
}

export interface LoadCase {
  /** Global forces and moments at nodes: [Fx, Fy, Fz, Mx, My, Mz] */
  nodal?: Map<number, number[]>;
  /** Uniform load along an element, global N/mm */
  line?: Map<number, Vec3>;
}

export interface ElementResult {
  /** End forces on the element in its local axes, [N, Vy, Vz, T, My, Mz] at each end */
  a: number[];
  b: number[];
  /** The uniform load in local axes */
  q: Vec3;
}

export interface CaseResult {
  /** Node displacements and rotations, global */
  u: number[][];
  elements: ElementResult[];
}

export type Solved = { ok: true; cases: CaseResult[] } | { ok: false; node: number };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Local axes of an element (rows: x, y, z in global coordinates) and its length */
export function elementAxes(frame: Frame, e: FrameElement): { R: [Vec3, Vec3, Vec3]; L: number } {
  const pa = frame.nodes[e.a];
  const pb = frame.nodes[e.b];
  const d: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const x = norm(d);
  // y square to x (the given direction, with any part along x taken out)
  const yy = norm([e.y[0] - dot(e.y, x) * x[0], e.y[1] - dot(e.y, x) * x[1], e.y[2] - dot(e.y, x) * x[2]]);
  return { R: [x, yy, cross(x, yy)], L };
}

/** The element's 12×12 stiffness in local axes */
function localStiffness(e: FrameElement, L: number): number[][] {
  const k = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const EA = (e.E * e.A) / L;
  const GJ = (e.G * e.J) / L;
  const z12 = (12 * e.E * e.Iz) / L ** 3;
  const z6 = (6 * e.E * e.Iz) / L ** 2;
  const z4 = (4 * e.E * e.Iz) / L;
  const z2 = (2 * e.E * e.Iz) / L;
  const y12 = (12 * e.E * e.Iy) / L ** 3;
  const y6 = (6 * e.E * e.Iy) / L ** 2;
  const y4 = (4 * e.E * e.Iy) / L;
  const y2 = (2 * e.E * e.Iy) / L;
  const set = (i: number, j: number, v: number) => {
    k[i][j] = v;
    k[j][i] = v;
  };
  set(0, 0, EA); set(6, 6, EA); set(0, 6, -EA);
  set(3, 3, GJ); set(9, 9, GJ); set(3, 9, -GJ);
  // Bending in the x–y plane (v, θz) with Iz
  set(1, 1, z12); set(7, 7, z12); set(1, 7, -z12);
  set(1, 5, z6); set(1, 11, z6); set(5, 7, -z6); set(7, 11, -z6);
  set(5, 5, z4); set(11, 11, z4); set(5, 11, z2);
  // Bending in the x–z plane (w, θy) with Iy
  set(2, 2, y12); set(8, 8, y12); set(2, 8, -y12);
  set(2, 4, -y6); set(2, 10, -y6); set(4, 8, y6); set(8, 10, y6);
  set(4, 4, y4); set(10, 10, y4); set(4, 10, y2);
  return k;
}

/** Equivalent nodal loads (local) of a uniform local load q over length L */
function fixedEnd(q: Vec3, L: number): number[] {
  const [qx, qy, qz] = q;
  return [qx * L / 2, qy * L / 2, qz * L / 2, 0, (-qz * L * L) / 12, (qy * L * L) / 12, qx * L / 2, qy * L / 2, qz * L / 2, 0, (qz * L * L) / 12, (-qy * L * L) / 12];
}

const toLocal = (R: [Vec3, Vec3, Vec3], v: number[], at: number): Vec3 => [
  R[0][0] * v[at] + R[0][1] * v[at + 1] + R[0][2] * v[at + 2],
  R[1][0] * v[at] + R[1][1] * v[at + 1] + R[1][2] * v[at + 2],
  R[2][0] * v[at] + R[2][1] * v[at + 1] + R[2][2] * v[at + 2],
];
const toGlobal = (R: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [
  R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
  R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
  R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
];

/** Reverse Cuthill–McKee order of the nodes: neighbours get near numbers, so the band stays narrow */
function nodeOrder(n: number, elements: FrameElement[]): number[] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of elements) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  const seen = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const byDegree = [...Array(n).keys()].sort((i, j) => adj[i].length - adj[j].length);
  for (const start of byDegree) {
    if (seen[start]) continue;
    seen[start] = true;
    const queue = [start];
    while (queue.length) {
      const v = queue.shift() as number;
      order.push(v);
      for (const w of [...adj[v]].sort((i, j) => adj[i].length - adj[j].length)) {
        if (!seen[w]) {
          seen[w] = true;
          queue.push(w);
        }
      }
    }
  }
  return order.reverse();
}

/**
 * Solves every load case. Returns the node where the frame turned out to be a mechanism (free to move without
 * resisting) instead, when it is one.
 */
export function solveFrame(frame: Frame, cases: LoadCase[]): Solved {
  const n = frame.nodes.length;
  const order = nodeOrder(n, frame.elements);
  const pos = new Array<number>(n);
  order.forEach((node, i) => (pos[node] = i));
  // Equation numbers: free degrees of freedom only
  const eq: number[][] = Array.from({ length: n }, () => new Array<number>(6).fill(-1));
  let m = 0;
  for (const node of order) {
    const fixed = frame.supports.get(node);
    for (let k = 0; k < 6; k++) if (!fixed?.[k]) eq[node][k] = m++;
  }
  const dofNode = new Array<number>(m);
  for (let node = 0; node < n; node++) for (let k = 0; k < 6; k++) if (eq[node][k] >= 0) dofNode[eq[node][k]] = node;

  const geo = frame.elements.map((e) => elementAxes(frame, e));
  let band = 0;
  for (const e of frame.elements) {
    const ids = [...eq[e.a], ...eq[e.b]].filter((i) => i >= 0);
    if (ids.length) band = Math.max(band, Math.max(...ids) - Math.min(...ids));
  }
  const W = band + 1;
  // Band storage: row i holds columns i-band..i at [i][band - (i - j)]
  const K = new Float64Array(m * W);
  const at = (i: number, j: number) => i * W + band - (i - j);
  const kl = frame.elements.map((e, i) => localStiffness(e, geo[i].L));
  frame.elements.forEach((e, idx) => {
    const { R } = geo[idx];
    const T = (v: number[][]) => {
      // K_global = Tᵀ k T with T = blockdiag(R, R, R, R)
      const out = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
      const tmp = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
      for (let i = 0; i < 12; i++) {
        for (let bj = 0; bj < 4; bj++) {
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let r = 0; r < 3; r++) s += v[i][bj * 3 + r] * R[r][c];
            tmp[i][bj * 3 + c] = s;
          }
        }
      }
      for (let bi = 0; bi < 4; bi++) {
        for (let c = 0; c < 3; c++) {
          for (let j = 0; j < 12; j++) {
            let s = 0;
            for (let r = 0; r < 3; r++) s += R[r][c] * tmp[bi * 3 + r][j];
            out[bi * 3 + c][j] = s;
          }
        }
      }
      return out;
    };
    const kg = T(kl[idx]);
    const ids = [...eq[e.a], ...eq[e.b]];
    for (let i = 0; i < 12; i++) {
      const I = ids[i];
      if (I < 0) continue;
      for (let j = 0; j < 12; j++) {
        const J = ids[j];
        if (J < 0 || J > I) continue;
        K[at(I, J)] += kg[i][j];
      }
    }
  });

  // Banded Cholesky, K = L Lᵀ in place
  const diag = new Float64Array(m);
  for (let i = 0; i < m; i++) diag[i] = K[at(i, i)];
  for (let i = 0; i < m; i++) {
    const j0 = Math.max(0, i - band);
    for (let j = j0; j <= i; j++) {
      let s = K[at(i, j)];
      const k0 = Math.max(j0, j - band);
      for (let k = k0; k < j; k++) s -= K[at(i, k)] * K[at(j, k)];
      if (j === i) {
        if (!(s > 1e-9 * Math.max(diag[i], 1e-12))) return { ok: false, node: dofNode[i] };
        K[at(i, i)] = Math.sqrt(s);
      } else {
        K[at(i, j)] = s / K[at(j, j)];
      }
    }
  }
  const solve = (f: Float64Array) => {
    for (let i = 0; i < m; i++) {
      let s = f[i];
      for (let k = Math.max(0, i - band); k < i; k++) s -= K[at(i, k)] * f[k];
      f[i] = s / K[at(i, i)];
    }
    for (let i = m - 1; i >= 0; i--) {
      let s = f[i];
      for (let k = i + 1; k <= Math.min(m - 1, i + band); k++) s -= K[at(k, i)] * f[k];
      f[i] = s / K[at(i, i)];
    }
    return f;
  };

  const results: CaseResult[] = cases.map((lc) => {
    const F = new Float64Array(m);
    const add = (node: number, k: number, v: number) => {
      const i = eq[node][k];
      if (i >= 0) F[i] += v;
    };
    for (const [node, f] of lc.nodal ?? []) for (let k = 0; k < 6; k++) add(node, k, f[k] ?? 0);
    const qLocal: Vec3[] = frame.elements.map((_, idx) => {
      const q = lc.line?.get(idx);
      return q ? toLocal(geo[idx].R, q, 0) : [0, 0, 0];
    });
    frame.elements.forEach((e, idx) => {
      const q = qLocal[idx];
      if (q[0] === 0 && q[1] === 0 && q[2] === 0) return;
      const fe = fixedEnd(q, geo[idx].L);
      const { R } = geo[idx];
      for (let blk = 0; blk < 4; blk++) {
        const g = toGlobal(R, [fe[blk * 3], fe[blk * 3 + 1], fe[blk * 3 + 2]]);
        const node = blk < 2 ? e.a : e.b;
        for (let c = 0; c < 3; c++) add(node, (blk % 2) * 3 + c, g[c]);
      }
    });
    const x = solve(F);
    const u = Array.from({ length: n }, (_, node) => eq[node].map((i) => (i >= 0 ? x[i] : 0)));
    const elements = frame.elements.map((e, idx) => {
      const { R, L } = geo[idx];
      const ue = [...u[e.a], ...u[e.b]];
      const ul: number[] = [];
      for (let blk = 0; blk < 4; blk++) ul.push(...toLocal(R, ue, blk * 3));
      const fe = fixedEnd(qLocal[idx], L);
      const f = kl[idx].map((row, i) => row.reduce((s, v, j) => s + v * ul[j], 0) - fe[i]);
      return { a: f.slice(0, 6), b: f.slice(6, 12), q: qLocal[idx] };
    });
    return { u, elements };
  });
  return { ok: true, cases: results };
}

/**
 * Bending moments and axial force along an element from its end forces: at x from end a, local axes.
 * My, Mz as the internal moments at the cut; N positive in tension.
 */
export function forcesAt(r: ElementResult, x: number): { N: number; My: number; Mz: number } {
  const [Fx1, Fy1, Fz1, , My1, Mz1] = r.a;
  const [qx, qy, qz] = r.q;
  return {
    N: -(Fx1 + qx * x),
    Mz: -Mz1 + Fy1 * x + (qy * x * x) / 2,
    My: -(My1 + Fz1 * x + (qz * x * x) / 2),
  };
}

/** Where along an element the moments peak (ends, middle, and where the shear turns), to check there */
export function checkPoints(r: ElementResult, L: number): number[] {
  const out = [0, L / 2, L];
  const [, Fy1, Fz1] = r.a;
  const [, qy, qz] = r.q;
  if (qy !== 0) {
    const x = -Fy1 / qy;
    if (x > 0 && x < L) out.push(x);
  }
  if (qz !== 0) {
    const x = -Fz1 / qz;
    if (x > 0 && x < L) out.push(x);
  }
  return out;
}

/** The displacement (global) of an element's middle: ends interpolated, plus the sag of its own load */
export function midDisplacement(frame: Frame, e: FrameElement, u: number[][], q: Vec3): Vec3 {
  const { R, L } = elementAxes(frame, e);
  const ua = u[e.a];
  const ub = u[e.b];
  const da = toLocal(R, ua, 0);
  const db = toLocal(R, ub, 0);
  const ra = toLocal(R, ua, 3);
  const rb = toLocal(R, ub, 3);
  // v' = θz, w' = -θy
  const v = (da[1] + db[1]) / 2 + (L / 8) * (ra[2] - rb[2]) + (q[1] * L ** 4) / (384 * e.E * e.Iz);
  const w = (da[2] + db[2]) / 2 - (L / 8) * (ra[1] - rb[1]) + (q[2] * L ** 4) / (384 * e.E * e.Iy);
  return toGlobal(R, [(da[0] + db[0]) / 2, v, w]);
}
