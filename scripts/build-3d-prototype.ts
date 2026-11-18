/**
 * Builds the standalone 3D prototype page into public/3d/index.html (served at /3d/ with the app,
 * and published as a Claude artifact where the AI chat works).
 * The pure core modules (src/core) are type-stripped and inlined, so the page draws from the exact same
 * layout, cut-list, drawing and viewer code as the app. Run: node scripts/build-3d-prototype.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Core modules in dependency order; each becomes an IIFE returning its exports.
const MODULES = ['steel', 'sections', 'catalog', 'scene', 'drawing', 'layoutPrompt'];
let core = '';
for (const name of MODULES) {
  let js = stripTypeScriptTypes(read(`src/core/${name}.ts`));
  js = js.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/(\w+)\.ts';?/gm, (_m, names: string, mod: string) => {
    const list = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = __${mod};`;
  });
  const exported: string[] = [];
  js = js.replace(/^export\s+(const|function|let)\s+(\w+)/gm, (_m, kw: string, id: string) => {
    exported.push(id);
    return `${kw} ${id}`;
  });
  if (/^\s*(import|export)\s/m.test(js)) throw new Error(`${name}.ts: unhandled import/export`);
  core += `const __${name} = (() => {\n${js}\nreturn { ${exported.join(', ')} };\n})();\n`;
}
core += `window.GVA_CORE = Object.freeze({ ${MODULES.map((m) => `...__${m}`).join(', ')} });\n`;

const EXAMPLES: [string, string][] = [
  ['double-gate', 'שער כנף כפולה'],
  ['sliding-gate', 'שער הזזה'],
  ['arch-gate', 'שער עם קשת'],
  ['garden-gate', 'פשפש מעוטר'],
];
const examples = Object.fromEntries(
  EXAMPLES.map(([key, label]) => [key, { label, layout: JSON.parse(read(`prototype/3d/examples/${key}.json`)) }]),
);

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<string, string> = {
  DIMS: icon('<path d="M3 7h18M3 4v6M21 4v6M7 17h10M7 14v6M17 14v6"/>'),
  FRONT: icon('<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 4v16M12 4v16M16 4v16"/>'),
  RESET: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  UNDER: icon('<path d="M2 12h20"/><path d="M7 12v7h4v-7M15 12v7"/><path d="M5 4l3 3M12 3v4M19 4l-3 3"/>'),
  CAMERA: icon('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  FULL: icon('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  MIC: icon('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
};

let html = read('prototype/3d/template.html');
const put = (marker: string, value: string) => {
  if (!html.includes(marker)) throw new Error(`missing ${marker}`);
  html = html.split(marker).join(value);
};
// </script> inside data would end the tag early
const safe = (s: string) => s.replace(/<\/script/gi, '<\\/script');
put('/*@@CORE@@*/', safe(core));
put('/*@@EXAMPLES@@*/', safe(JSON.stringify(examples)));
// The shared viewer (its `export` dropped) followed by the page UI, in one module script
const viewer = read('src/viewer3d/viewer.js').replace(/^export function createViewer/m, 'function createViewer');
if (/^export\s/m.test(viewer)) throw new Error('viewer.js: unhandled export');
put('/*@@VIEWER@@*/', safe(`${viewer}\n${read('prototype/3d/app.js')}`));
for (const [k, svg] of Object.entries(ICONS)) put(`@@ICON_${k}@@`, svg);

mkdirSync(new URL('../public/3d/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/3d/index.html', import.meta.url), html);
console.log(`public/3d/index.html: ${Math.round(html.length / 1024)} KB`);
