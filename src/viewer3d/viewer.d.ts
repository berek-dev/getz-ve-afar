import type * as Scene from '../core/scene.ts';
import type { BEAMS } from '../core/sections.ts';
import type { CutList, Prepared } from '../core/scene.ts';

/** The pure core the viewer draws with (the app passes the modules, the prototype its inlined copy) */
export type ViewerCore = typeof Scene & { BEAMS: typeof BEAMS };

export interface PickInfo {
  /** Cut-list mark (A, B, ...) for profile pieces */
  mark: string | null;
  text: string;
}

export interface Viewer {
  show(prepared: Prepared, cut: CutList, options?: { keepCamera?: boolean }): void;
  /** 0 = closed, 1 = open */
  setOpen(t: number): void;
  animateOpen(target: number): void;
  readonly open: number;
  /** The layout has a leaf that swings or slides */
  readonly hasMovers: boolean;
  setDims(on: boolean): void;
  setUnderground(on: boolean): void;
  frame(kind?: '3d' | 'front'): void;
  clearSelection(): void;
  screenshot(): Promise<Blob | null>;
  resize(): void;
  dispose(): void;
}

export function createViewer(
  container: HTMLElement,
  options: { core: ViewerCore; onPick?: (info: PickInfo | null) => void; onOpenChange?: (t: number) => void },
): Viewer;
