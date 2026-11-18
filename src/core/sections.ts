/**
 * Standard rolled sections (EN tables, rounded): height h, flange width b, web tw, flange tf (mm), kg per metre.
 * Shared by the catalog (weights) and the 3D layout (shapes).
 */
export interface BeamSection {
  h: number;
  b: number;
  tw: number;
  tf: number;
  kg: number;
}

export type BeamType = 'upn' | 'ipe' | 'hea';

export const BEAMS: Record<BeamType, Record<number, BeamSection>> = {
  upn: {
    50: { h: 50, b: 38, tw: 5, tf: 7, kg: 5.59 },
    65: { h: 65, b: 42, tw: 5.5, tf: 7.5, kg: 7.09 },
    80: { h: 80, b: 45, tw: 6, tf: 8, kg: 8.64 },
    100: { h: 100, b: 50, tw: 6, tf: 8.5, kg: 10.6 },
    120: { h: 120, b: 55, tw: 7, tf: 9, kg: 13.4 },
    140: { h: 140, b: 60, tw: 7, tf: 10, kg: 16.0 },
    160: { h: 160, b: 65, tw: 7.5, tf: 10.5, kg: 18.8 },
    180: { h: 180, b: 70, tw: 8, tf: 11, kg: 22.0 },
    200: { h: 200, b: 75, tw: 8.5, tf: 11.5, kg: 25.3 },
  },
  ipe: {
    80: { h: 80, b: 46, tw: 3.8, tf: 5.2, kg: 6.0 },
    100: { h: 100, b: 55, tw: 4.1, tf: 5.7, kg: 8.1 },
    120: { h: 120, b: 64, tw: 4.4, tf: 6.3, kg: 10.4 },
    140: { h: 140, b: 73, tw: 4.7, tf: 6.9, kg: 12.9 },
    160: { h: 160, b: 82, tw: 5, tf: 7.4, kg: 15.8 },
    180: { h: 180, b: 91, tw: 5.3, tf: 8, kg: 18.8 },
    200: { h: 200, b: 100, tw: 5.6, tf: 8.5, kg: 22.4 },
    220: { h: 220, b: 110, tw: 5.9, tf: 9.2, kg: 26.2 },
    240: { h: 240, b: 120, tw: 6.2, tf: 9.8, kg: 30.7 },
    270: { h: 270, b: 135, tw: 6.6, tf: 10.2, kg: 36.1 },
    300: { h: 300, b: 150, tw: 7.1, tf: 10.7, kg: 42.2 },
  },
  hea: {
    100: { h: 96, b: 100, tw: 5, tf: 8, kg: 16.7 },
    120: { h: 114, b: 120, tw: 5, tf: 8, kg: 19.9 },
    140: { h: 133, b: 140, tw: 5.5, tf: 8.5, kg: 24.7 },
    160: { h: 152, b: 160, tw: 6, tf: 9, kg: 30.4 },
    180: { h: 171, b: 180, tw: 6, tf: 9.5, kg: 35.5 },
    200: { h: 190, b: 200, tw: 6.5, tf: 10, kg: 42.3 },
    220: { h: 210, b: 220, tw: 7, tf: 11, kg: 50.5 },
    240: { h: 230, b: 240, tw: 7.5, tf: 12, kg: 60.3 },
  },
};

export const beamSizes = (type: BeamType) => Object.keys(BEAMS[type]).map(Number);
