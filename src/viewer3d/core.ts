/** The pure core modules handed to the shared viewer (the prototype page passes its inlined copy). */
import * as scene from '../core/scene.ts';
import { BEAMS } from '../core/sections.ts';
import type { ViewerCore } from './viewer.js';

export const VIEWER_CORE: ViewerCore = { ...scene, BEAMS };
