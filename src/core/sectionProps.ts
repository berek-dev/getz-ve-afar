/**
 * Section properties for the strength check, in mm: area, second moments, torsion constant and elastic section
 * moduli about the two section axes the layout uses (`sectionAxes`): f carries size[0] (the face), n carries
 * size[1] (the depth). `If` is about the f axis, so it resists bending that moves the member along n; `In` is about
 * the n axis and resists bending along f (for a horizontal beam, f is up: `In` carries the roof's weight). Corner
 * radii and fillets are left out of tubes and bars (slightly on the safe side); rolled beams take their area from
 * the table weight.
 */
import { BEAMS } from './sections.ts';
import type { Profile } from './scene.ts';

export interface SectionProps {
  A: number;
  /** About the f axis (bending along n) and about the n axis (bending along f), mm⁴ */
  If: number;
  In: number;
  J: number;
  /** Elastic moduli for the same two bendings, mm³ */
  Wf: number;
  Wn: number;
  /** Smallest second moment about any axis (angles buckle about their weakest axis) */
  Imin: number;
  /** Outside size along f and along n */
  extF: number;
  extN: number;
  /** Open sections (flats, angles, channels, I beams) twist easily */
  open: boolean;
}

const rect = (b: number, h: number) => ({ A: b * h, Ib: (h * b ** 3) / 12, Ih: (b * h ** 3) / 12 });

export function sectionProps(profile: Profile, size: number[]): SectionProps | null {
  const [s0 = 0, s1 = s0, s2 = 0] = size;
  switch (profile) {
    case 'rect_tube': {
      // s0 along f, s1 along n, wall s2
      const [B, H, t] = [s0, s1, Math.min(s2, s0 / 2, s1 / 2)];
      if (!(B > 0 && H > 0 && t > 0)) return null;
      const bi = B - 2 * t;
      const hi = H - 2 * t;
      const A = B * H - bi * hi;
      const If = (B * H ** 3 - bi * hi ** 3) / 12;
      const In = (H * B ** 3 - hi * bi ** 3) / 12;
      // Thin-walled closed section (Bredt)
      const am = (B - t) * (H - t);
      const J = (4 * am * am * t) / (2 * (B - t + (H - t)));
      return { A, If, In, J, Wf: If / (H / 2), Wn: In / (B / 2), Imin: Math.min(If, In), extF: B, extN: H, open: false };
    }
    case 'round_tube': {
      const [D, t] = [s0, Math.min(s1, s0 / 2)];
      if (!(D > 0 && t > 0)) return null;
      const d = D - 2 * t;
      const I = (Math.PI * (D ** 4 - d ** 4)) / 64;
      const W = I / (D / 2);
      return { A: (Math.PI * (D * D - d * d)) / 4, If: I, In: I, J: 2 * I, Wf: W, Wn: W, Imin: I, extF: D, extN: D, open: false };
    }
    case 'round_bar': {
      const D = s0;
      if (!(D > 0)) return null;
      const I = (Math.PI * D ** 4) / 64;
      const W = I / (D / 2);
      return { A: (Math.PI * D * D) / 4, If: I, In: I, J: 2 * I, Wf: W, Wn: W, Imin: I, extF: D, extN: D, open: false };
    }
    case 'square_bar': {
      const a = s0;
      if (!(a > 0)) return null;
      const I = a ** 4 / 12;
      return { A: a * a, If: I, In: I, J: 0.1406 * a ** 4, Wf: I / (a / 2), Wn: I / (a / 2), Imin: I, extF: a, extN: a, open: false };
    }
    case 'flat': {
      // Width s0 along f, thickness s1 along n
      const [w, t] = [s0, s1];
      if (!(w > 0 && t > 0)) return null;
      const r = rect(w, t);
      const If = r.Ih;
      const In = r.Ib;
      const long = Math.max(w, t);
      const short = Math.min(w, t);
      return { A: r.A, If, In, J: (long * short ** 3) / 3 * (1 - 0.63 * (short / long)), Wf: If / (t / 2), Wn: In / (w / 2), Imin: Math.min(If, In), extF: w, extN: t, open: true };
    }
    case 'angle': {
      // Legs s0 (along f) and s1 (along n), thickness s2; the corner at the origin, legs along +f and +n
      const [a, b, t] = [s0, s1, s2];
      if (!(a > 0 && b > 0 && t > 0)) return null;
      const parts = [
        { A: a * t, cf: a / 2, cn: t / 2, If0: (a * t ** 3) / 12, In0: (t * a ** 3) / 12 },
        { A: (b - t) * t, cf: t / 2, cn: t + (b - t) / 2, If0: (t * (b - t) ** 3) / 12, In0: ((b - t) * t ** 3) / 12 },
      ];
      const A = parts.reduce((s, p) => s + p.A, 0);
      const cf = parts.reduce((s, p) => s + p.A * p.cf, 0) / A;
      const cn = parts.reduce((s, p) => s + p.A * p.cn, 0) / A;
      // If: about the axis along f through the centroid (distances along n); In: distances along f
      const If = parts.reduce((s, p) => s + p.If0 + p.A * (p.cn - cn) ** 2, 0);
      const In = parts.reduce((s, p) => s + p.In0 + p.A * (p.cf - cf) ** 2, 0);
      const Ifn = parts.reduce((s, p) => s + p.A * (p.cf - cf) * (p.cn - cn), 0);
      const Imin = (If + In) / 2 - Math.sqrt(((If - In) / 2) ** 2 + Ifn ** 2);
      const J = ((a + b - t) * t ** 3) / 3;
      return { A, If, In, J, Wf: If / Math.max(cn, b - cn), Wn: In / Math.max(cf, a - cf), Imin, extF: a, extN: b, open: true };
    }
    case 'upn':
    case 'ipe':
    case 'hea': {
      const s = BEAMS[profile][s0];
      if (!s) return null;
      const { h, b, tw, tf } = s;
      const A = s.kg / 0.00785;
      // The web runs along f (height h), the flanges along n (width b)
      const web = h - 2 * tf;
      const In = (b * h ** 3 - (b - tw) * web ** 3) / 12;
      let If: number;
      let Wf: number;
      if (profile === 'upn') {
        // Channel: flanges on one side of the web; weak axis through the centroid
        const parts = [
          { A: web * tw, c: tw / 2, I0: (web * tw ** 3) / 12 },
          { A: 2 * b * tf, c: b / 2, I0: (2 * tf * b ** 3) / 12 },
        ];
        const Ap = parts.reduce((x, p) => x + p.A, 0);
        const c = parts.reduce((x, p) => x + p.A * p.c, 0) / Ap;
        If = parts.reduce((x, p) => x + p.I0 + p.A * (p.c - c) ** 2, 0);
        Wf = If / Math.max(c, b - c);
      } else {
        If = (2 * tf * b ** 3 + web * tw ** 3) / 12;
        Wf = If / (b / 2);
      }
      const J = (2 * b * tf ** 3 + web * tw ** 3) / 3;
      return { A, If, In, J, Wf, Wn: In / (h / 2), Imin: Math.min(If, In), extF: h, extN: b, open: true };
    }
  }
}

/** Steel weight of a section, kg per metre */
export const kgPerM = (p: SectionProps, density = 7.85) => (p.A * density) / 1000;
