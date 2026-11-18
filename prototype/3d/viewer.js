// 3D viewer for the layout format in src/core/scene.ts (prototype; becomes a module in the app later).
// Geometry is built in metres from the millimetre layout. Everything is drawn from data:
// the AI only ever writes layout JSON.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const C = window.GVA_CORE;
const EXAMPLES = window.GVA_EXAMPLES;
const INSTRUCTIONS = window.GVA_INSTRUCTIONS;
const MM = 0.001;
const $ = (id) => document.getElementById(id);
const v3 = (p) => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(n);

// ---------------------------------------------------------------------------------------------- state
const STORE = 'gva3d.mine';
const state = {
  key: null,
  raw: null,
  prepared: null,
  cut: null,
  mode: 'new', // 'new' = describe a job, 'edit' = change the current model
  requests: [],
  undo: [],
  open: 0,
  dims: true,
  under: false,
};
function loadMine() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    return s && s.raw ? s : null;
  } catch {
    return null;
  }
}
function saveMine() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ raw: state.raw, requests: state.requests, undo: state.undo.slice(-5) }));
  } catch {
    /* private mode: fine */
  }
}

// --------------------------------------------------------------------------------------- three setup
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
view.appendChild(labelRenderer.domElement);
$('placeholder').remove();

const scene = new THREE.Scene();
const SKY = new THREE.Color('#d9dee2');
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 40, 120);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;

scene.add(new THREE.HemisphereLight('#ffffff', '#8b8578', 0.85));
const sun = new THREE.DirectionalLight('#fff4e3', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const groundMat = new THREE.MeshStandardMaterial({ color: '#bdb7aa', roughness: 0.95, metalness: 0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 72), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.002;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(40, 40, '#9f998d', '#aaa497');
grid.position.y = -0.001;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

let model = new THREE.Group();
scene.add(model);
let movers = [];
let dimsGroup = new THREE.Group();
scene.add(dimsGroup);

// ------------------------------------------------------------------------------------------ materials
const matCache = new Map();
function steelMaterial(material, color) {
  const key = `${material}|${color || ''}`;
  if (matCache.has(key)) return matCache.get(key);
  const spec = {
    black: { color: color || '#2b2f33', metalness: 0.45, roughness: 0.48 },
    galv: { color: color || '#a6adb1', metalness: 0.85, roughness: 0.38 },
    stainless: { color: color || '#d6dadd', metalness: 1, roughness: 0.18 },
    aluminum: { color: color || '#c4c8cb', metalness: 0.9, roughness: 0.3 },
  }[material] || { color: '#2b2f33', metalness: 0.45, roughness: 0.48 };
  const m = new THREE.MeshStandardMaterial(spec);
  matCache.set(key, m);
  return m;
}
const SOLID_COLORS = { concrete: '#a8a59c', stone: '#c3b59b', plaster: '#e4ddd0', wood: '#8b5e3c', paving: '#9f9b93' };
const solidMat = (kind) => new THREE.MeshStandardMaterial({ color: SOLID_COLORS[kind] || SOLID_COLORS.concrete, roughness: 0.92 });
const footingMat = new THREE.MeshStandardMaterial({ color: '#9d9a92', roughness: 1, transparent: true, opacity: 0.55 });
const darkMetal = new THREE.MeshStandardMaterial({ color: '#2a2d30', metalness: 0.7, roughness: 0.35 });
const rubber = new THREE.MeshStandardMaterial({ color: '#c7951a', roughness: 0.7 });
const highlight = new THREE.MeshStandardMaterial({ color: '#f3b61f', emissive: '#a5740a', emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 });

// ----------------------------------------------------------------------------------- section outlines
function circlePts(r, n = 28) {
  return Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)]);
}
function rectPts(w, h, r = 0) {
  if (r <= 0.0001) return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const pts = [];
  const corners = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 3; k++) pts.push([cx + r * Math.cos(a0 + (k / 3) * (Math.PI / 2)), cy + r * Math.sin(a0 + (k / 3) * (Math.PI / 2))]);
  return pts;
}
/** Outline (and holes) of a section in metres: x along the face axis f, y along the depth axis n. */
function sectionPts(profile, size) {
  const s = size.map((v) => v * MM);
  switch (profile) {
    case 'rect_tube': {
      const [b, h, t] = s;
      return { outer: rectPts(b, h, Math.min(t * 1.5, b / 4)), holes: [rectPts(b - 2 * t, h - 2 * t, Math.max(t * 0.5, 0))] };
    }
    case 'round_tube':
      return { outer: circlePts(s[0] / 2), holes: [circlePts(s[0] / 2 - s[1])] };
    case 'round_bar':
      return { outer: circlePts(s[0] / 2, 20), holes: [] };
    case 'square_bar':
      return { outer: rectPts(s[0], s[0]), holes: [] };
    case 'flat':
      return { outer: rectPts(s[0], s[1]), holes: [] };
    case 'angle': {
      const [a, b, t] = s;
      return { outer: [[0, 0], [a, 0], [a, t], [t, t], [t, b], [0, b]].map(([x, y]) => [x - a / 2, y - b / 2]), holes: [] };
    }
    default: {
      const beam = C.BEAMS[profile][size[0]];
      const [h, b, tw, tf] = [beam.h, beam.b, beam.tw, beam.tf].map((v) => v * MM);
      if (profile === 'upn') {
        return { outer: [[-h / 2, -b / 2], [h / 2, -b / 2], [h / 2, b / 2], [h / 2 - tf, b / 2], [h / 2 - tf, -b / 2 + tw], [-h / 2 + tf, -b / 2 + tw], [-h / 2 + tf, b / 2], [-h / 2, b / 2]], holes: [] };
      }
      return {
        outer: [[-h / 2, -b / 2], [-h / 2 + tf, -b / 2], [-h / 2 + tf, -tw / 2], [h / 2 - tf, -tw / 2], [h / 2 - tf, -b / 2], [h / 2, -b / 2], [h / 2, b / 2], [h / 2 - tf, b / 2], [h / 2 - tf, tw / 2], [-h / 2 + tf, tw / 2], [-h / 2 + tf, b / 2], [-h / 2, b / 2]],
        holes: [],
      };
    }
  }
}
function toShape({ outer, holes }, rollDeg) {
  const a = ((rollDeg || 0) * Math.PI) / 180;
  const rot = ([x, y]) => new THREE.Vector2(x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
  const shape = new THREE.Shape(outer.map(rot));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(rot)));
  return shape;
}
function faceDepth(m) {
  if (m.profile === 'upn' || m.profile === 'ipe' || m.profile === 'hea') {
    const beam = C.BEAMS[m.profile][m.size[0]];
    return [beam.h, beam.b];
  }
  if (m.profile === 'round_tube' || m.profile === 'round_bar' || m.profile === 'square_bar') return [m.size[0], m.size[0]];
  return [m.size[0], m.size[1] ?? m.size[0]];
}

// ------------------------------------------------------------------------------------ building meshes
function basisFor(from, to) {
  const d = C.norm(C.sub(to, from));
  const { f, n } = C.sectionAxes(d);
  const fv = new THREE.Vector3(...f);
  const nv = new THREE.Vector3(...n);
  const dv = new THREE.Vector3(...d);
  const yv = new THREE.Vector3().crossVectors(fv, nv).dot(dv) > 0 ? nv : nv.clone().negate();
  return { fv, yv, dv };
}

function memberMeshes(m, info) {
  const mat = steelMaterial(m.material, m.color || (m.material === 'black' ? state.prepared.scene.finish?.color : null));
  // Along a curve three.js maps the shape's x to the out-of-plane normal and y to the in-plane binormal,
  // so swap the axes there to keep the face (f) in the arc's plane.
  const pts = sectionPts(m.profile, m.size);
  const swap = (list) => list.map(([x, y]) => [y, x]);
  const shape = toShape(m.via ? { outer: swap(pts.outer), holes: pts.holes.map(swap) } : pts, m.roll);
  const out = [];
  let geo;
  if (m.via) {
    const arc = C.arcThrough(m.from, m.via, m.to);
    const pts = Array.from({ length: 41 }, (_, i) => v3(C.arcPoint(arc, i / 40)));
    geo = new THREE.ExtrudeGeometry(shape, { steps: 60, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts) });
  } else {
    const L = C.len(C.sub(m.to, m.from)) * MM;
    geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, steps: 1 });
    const { fv, yv, dv } = basisFor(m.from, m.to);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(fv, yv, dv).setPosition(v3(m.from)));
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.info = info;
  out.push(mesh);

  if (m.end_cap && !m.via) {
    const [face, depth] = faceDepth(m).map((v) => v * MM);
    const { fv, yv, dv } = basisFor(m.from, m.to);
    const end = v3(m.to);
    let cap;
    if (m.end_cap === 'finial') {
      const h = Math.max(face, depth) * 4.5;
      cap = new THREE.Mesh(new THREE.ConeGeometry(Math.max(face, depth) * 0.95, h, 4), mat);
      cap.position.copy(end).addScaledVector(dv, h / 2);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv);
      cap.rotateY(Math.PI / 4);
    } else if (m.end_cap === 'ball') {
      const r = Math.max(face, depth) * 0.85;
      cap = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
      cap.position.copy(end).addScaledVector(dv, r * 0.8);
    } else {
      const g = new THREE.BoxGeometry(face + 0.008, depth + 0.008, 0.006);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(fv, yv, dv).setPosition(end.clone().addScaledVector(dv, 0.003)));
      cap = new THREE.Mesh(g, mat);
    }
    cap.userData.info = info;
    out.push(cap);
  }
  return out;
}

function plateMesh(p) {
  const [a, b] = p.size.map((v) => v * MM);
  const t = p.thickness * MM;
  const dims = p.normal === 'z' ? [a, b, t] : p.normal === 'x' ? [t, b, a] : [a, t, b];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims), steelMaterial(p.material, p.color || (p.material === 'black' ? state.prepared.scene.finish?.color : null)));
  mesh.position.copy(v3(p.center));
  return mesh;
}

function partObject(p) {
  const g = new THREE.Group();
  const s = (p.size || []).map((v) => v * MM);
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  switch (p.kind) {
    case 'hinge':
      add(new THREE.CylinderGeometry(0.016, 0.016, s[1] || 0.12, 16), darkMetal);
      add(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 16), darkMetal, 0, (s[1] || 0.12) / 2);
      break;
    case 'wheel': {
      const d = s[0] || 0.1;
      const w = s[1] || 0.03;
      const wheel = add(new THREE.CylinderGeometry(d / 2, d / 2, w, 28), darkMetal);
      if ((p.axis || 'z') === 'z') wheel.rotation.x = Math.PI / 2;
      else if (p.axis === 'x') wheel.rotation.z = Math.PI / 2;
      break;
    }
    case 'guide_roller':
      add(new THREE.BoxGeometry(0.06, 0.04, 0.24), darkMetal, 0, 0.05, -0.08);
      for (const z of [-0.045, 0.045]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 18), rubber, 0, 0, z);
      break;
    case 'lock':
      add(new THREE.BoxGeometry(s[0] || 0.1, s[1] || 0.16, s[2] || 0.04), darkMetal);
      break;
    case 'handle': {
      const lever = add(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 12), darkMetal, -0.06, 0, 0);
      lever.rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.03, 0.06, 0.02), darkMetal);
      break;
    }
    case 'drop_bolt':
      add(new THREE.CylinderGeometry(0.008, 0.008, s[1] || 0.45, 12), darkMetal);
      break;
    case 'stopper':
      add(new THREE.BoxGeometry(0.06, 0.12, 0.06), rubber);
      break;
    case 'motor':
      add(new THREE.BoxGeometry(s[0] || 0.3, s[1] || 0.28, s[2] || 0.2), new THREE.MeshStandardMaterial({ color: '#2d3236', roughness: 0.6 }));
      add(new THREE.BoxGeometry(0.12, 0.02, 0.005), rubber, 0, 0.06, (s[2] || 0.2) / 2 + 0.003);
      break;
    case 'cap':
      add(new THREE.BoxGeometry(s[0] || 0.12, 0.006, s[0] || 0.12), darkMetal);
      break;
    case 'finial':
      add(new THREE.ConeGeometry(s[0] || 0.015, (s[0] || 0.015) * 5, 4), darkMetal);
      break;
    case 'scroll': {
      const r = (s[0] || 0.12) / 2;
      const mat = steelMaterial(state.prepared.scene.material, state.prepared.scene.finish?.color);
      add(new THREE.TorusGeometry(r, 0.005, 8, 32, Math.PI * 1.6), mat).rotation.z = Math.PI * 0.2;
      add(new THREE.TorusGeometry(r * 0.45, 0.005, 8, 24, Math.PI * 1.5), mat, r * 0.4, -r * 0.2).rotation.z = Math.PI * 1.1;
      break;
    }
    case 'footing':
      add(new THREE.BoxGeometry(s[0] || 0.4, s[1] || 0.6, s[2] || 0.4), footingMat).userData.footing = true;
      break;
  }
  g.position.copy(v3(p.at));
  g.traverse((o) => {
    o.userData.info = `${p.label || C.PART_LABELS[p.kind]}`;
  });
  return g;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.element) o.element.remove();
  });
}

function buildModel() {
  const { scene: sc } = state.prepared;
  scene.remove(model);
  disposeTree(model);
  model = new THREE.Group();
  movers = [];
  const containers = new Map();
  for (const g of sc.groups) {
    const pivot = new THREE.Group();
    const inner = new THREE.Group();
    if (g.motion?.type === 'swing') {
      pivot.position.copy(v3(g.motion.pivot));
      inner.position.copy(pivot.position).negate();
    }
    pivot.add(inner);
    model.add(pivot);
    containers.set(g.id, inner);
    if (g.motion) movers.push({ pivot, motion: g.motion });
  }
  const holder = (gid) => containers.get(gid) || model;

  for (const m of sc.members) {
    const mark = state.cut.markOf[m.id];
    const info = `${mark ? `<b>${mark}</b> ` : ''}${C.sectionName(m.profile, m.size, m.material)}, ${fmt(Math.round(C.memberLength(m)))} מ״מ${m.via ? ' (מכופף)' : ''}${m.label ? `, ${m.label}` : ''}`;
    for (const mesh of memberMeshes(m, info)) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder(m.group).add(mesh);
    }
  }
  for (const p of sc.plates) {
    const mesh = plateMesh(p);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.info = `${p.label || 'פח'} ${p.thickness} מ״מ, ${fmt(Math.max(...p.size))}/${fmt(Math.min(...p.size))}`;
    holder(p.group).add(mesh);
  }
  for (const p of sc.parts) {
    const obj = partObject(p);
    obj.traverse((o) => {
      if (o.isMesh && !o.userData.footing) o.castShadow = true;
    });
    holder(p.group).add(obj);
  }
  for (const s of sc.solids) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...s.size.map((v) => v * MM)), solidMat(s.kind));
    mesh.position.copy(v3(s.center));
    mesh.castShadow = s.kind !== 'paving';
    mesh.receiveShadow = true;
    mesh.userData.info = s.label || 'סביבה קיימת';
    model.add(mesh);
  }
  scene.add(model);
  applyOpen(state.open);
  buildDims();
  $('open-row').hidden = movers.length === 0;
}

// ---------------------------------------------------------------------------------------- dimensions
function dimLabel(text, pos) {
  const el = document.createElement('div');
  el.className = 'dim';
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  return o;
}
function dimLine(a, b, normal, text) {
  const mat = new THREE.LineBasicMaterial({ color: '#1b2025' });
  const tick = normal.clone().multiplyScalar(0.06);
  const pts = [a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick)];
  const geo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
  const lines = new THREE.LineSegments(geo, mat);
  const grp = new THREE.Group();
  grp.add(lines, dimLabel(text, a.clone().add(b).multiplyScalar(0.5)));
  return grp;
}
function buildDims() {
  scene.remove(dimsGroup);
  disposeTree(dimsGroup);
  dimsGroup = new THREE.Group();
  const { scene: sc } = state.prepared;
  const b = C.workBounds(sc);
  const zFront = b.max[2] + 350;
  dimsGroup.add(dimLine(v3([b.min[0], 15, zFront]), v3([b.max[0], 15, zFront]), new THREE.Vector3(0, 1, 0), `${fmt(b.max[0] - b.min[0])} מ״מ`));
  dimsGroup.add(dimLine(v3([b.max[0] + 350, 0, 0]), v3([b.max[0] + 350, b.max[1], 0]), new THREE.Vector3(1, 0, 0), `${fmt(b.max[1])} מ״מ`));
  for (const d of sc.dimensions) {
    const a = v3(d.from);
    const e = v3(d.to);
    dimsGroup.add(dimLine(a, e, new THREE.Vector3(0, 0, 1), d.label || `${fmt(C.len(C.sub(d.to, d.from)))} מ״מ`));
  }
  dimsGroup.visible = state.dims;
  scene.add(dimsGroup);
}

// ------------------------------------------------------------------------------- camera and rendering
let needsRender = true;
controls.addEventListener('change', () => (needsRender = true));
function metres(bounds) {
  return { min: v3(bounds.min), max: v3(bounds.max) };
}
function frame(kind = '3d') {
  const b = metres(C.workBounds(state.prepared.scene));
  const center = b.min.clone().add(b.max).multiplyScalar(0.5);
  center.y = Math.max(center.y, (b.max.y - Math.max(b.min.y, 0)) / 2);
  const size = b.max.clone().sub(b.min);
  const fov = (camera.fov * Math.PI) / 180;
  // Room for the dimension labels and the swing of open leaves
  const need = Math.max(size.y * 1.45, (size.x * 1.3) / camera.aspect);
  const dist = need / 2 / Math.tan(fov / 2) + size.z;
  const dir = kind === 'front' ? new THREE.Vector3(0, 0.05, 1) : new THREE.Vector3(0.55, 0.32, 1);
  camera.position.copy(center).addScaledVector(dir.normalize(), dist * (kind === 'front' ? 1.05 : 1.12));
  controls.target.copy(center);
  controls.maxDistance = dist * 6;
  controls.minDistance = 0.3;
  controls.update();
  const span = Math.max(size.x, size.y, size.z) * 0.75 + 2;
  sun.position.copy(center).add(new THREE.Vector3(span * 0.6, span * 1.4, span * 1.0));
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 5 });
  sun.shadow.camera.updateProjectionMatrix();
  needsRender = true;
}
function resize() {
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  labelRenderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  needsRender = true;
}
new ResizeObserver(resize).observe(view);

let anim = null;
function applyOpen(t) {
  state.open = t;
  for (const { pivot, motion } of movers) {
    if (motion.type === 'swing') pivot.rotation.y = THREE.MathUtils.degToRad(motion.angle) * t;
    else pivot.position.copy(v3(motion.offset)).multiplyScalar(t);
  }
  $('open').value = String(Math.round(t * 100));
  $('open-btn').textContent = t > 0.5 ? 'סגור' : 'פתח';
  needsRender = true;
}
function animateOpen(target) {
  if (reduceMotion) return applyOpen(target);
  anim = { from: state.open, to: target, start: performance.now(), ms: 1400 };
}
function loop(now) {
  requestAnimationFrame(loop);
  if (anim) {
    const k = Math.min(1, (now - anim.start) / anim.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    applyOpen(anim.from + (anim.to - anim.from) * e);
    if (k >= 1) anim = null;
  }
  const moved = controls.update();
  if (needsRender || moved) {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    needsRender = false;
  }
}
requestAnimationFrame(loop);

// ------------------------------------------------------------------------------------------ picking
const ray = new THREE.Raycaster();
let downAt = null;
let picked = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(model, true).find((h) => h.object.userData.info && !(h.object.userData.footing && !state.under));
  select(hit ? hit.object : null);
});
function select(mesh) {
  if (picked) picked.material = picked.userData.mat;
  picked = null;
  if (mesh && mesh.isMesh && !mesh.userData.footing) {
    mesh.userData.mat = mesh.material;
    mesh.material = highlight;
    picked = mesh;
  }
  $('info').hidden = !mesh;
  if (mesh) $('info-text').innerHTML = mesh.userData.info;
  needsRender = true;
}
$('info-close').onclick = () => select(null);

// ------------------------------------------------------------------------------------------- toolbar
$('open').addEventListener('input', (e) => {
  anim = null;
  applyOpen(Number(e.target.value) / 100);
});
$('open-btn').onclick = () => animateOpen(state.open > 0.5 ? 0 : 1);
$('t-dims').onclick = (e) => {
  state.dims = !state.dims;
  dimsGroup.visible = state.dims;
  e.currentTarget.setAttribute('aria-pressed', String(state.dims));
  needsRender = true;
};
$('t-front').onclick = () => frame('front');
$('t-reset').onclick = () => frame('3d');
$('t-under').onclick = (e) => {
  state.under = !state.under;
  groundMat.transparent = state.under;
  groundMat.opacity = state.under ? 0.25 : 1;
  groundMat.depthWrite = !state.under;
  controls.maxPolarAngle = state.under ? Math.PI : Math.PI / 2 - 0.02;
  e.currentTarget.setAttribute('aria-pressed', String(state.under));
  needsRender = true;
};
$('t-full').onclick = () => {
  const stage = $('stage');
  const on = !stage.classList.contains('is-full');
  stage.classList.toggle('is-full', on);
  document.body.classList.toggle('no-scroll', on);
  $('t-full-label').textContent = on ? 'יציאה' : 'מסך מלא';
  try {
    if (on && stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch {
    /* the in-page layer is enough */
  }
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('stage').classList.contains('is-full')) $('t-full').click();
});

// ------------------------------------------------------------------------------------- page content
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderInfo() {
  const { scene: sc, warnings } = state.prepared;
  const cut = state.cut;
  $('title').textContent = sc.title;
  const pieces = cut.pieces.reduce((s, p) => s + p.count, 0);
  $('summary').textContent = `${pieces} חלקי פרופיל, ${cut.pieces.length} סוגי חיתוך, בערך ${fmt(cut.totalKg)} ק״ג ברזל${sc.finish?.name ? `. גמר: ${sc.finish.name}` : ''}`;
  $('notes').innerHTML = (sc.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  $('warnings').hidden = warnings.length === 0;
  $('warnings').textContent = warnings.length ? `בדיקת הפריסה: ${warnings.slice(0, 4).join('; ')}` : '';
  $('source').innerHTML = sc.source ? `מבוסס על פרויקט מהרשת: <a href="${esc(sc.source.url)}" target="_blank" rel="noreferrer">${esc(sc.source.title || sc.source.url)}</a>` : '';

  const rows = cut.pieces
    .map((p) => `<tr><td class="mark">${p.mark}</td><td>${esc(p.name)}${p.bent ? ' <span class="muted">(מכופף)</span>' : ''}</td><td class="num">${p.count}</td><td class="num">${fmt(p.length)}</td></tr>`)
    .join('');
  const buy = cut.sections.map((s) => `<tr><td>${esc(s.name)}</td><td class="num">${(s.totalMm / 1000).toFixed(2)} מ׳</td><td class="num">${fmt(s.kg)} ק״ג</td></tr>`).join('');
  const plates = cut.plates.map((p) => `<tr><td>${esc(p.name)} ${fmt(p.w)}/${fmt(p.h)}</td><td class="num">${p.count}</td><td class="num">${p.areaM2} מ״ר</td></tr>`).join('');
  const parts = cut.parts.map((p) => `${esc(p.label)} ${p.count}`).join(', ');
  $('panel-cut').innerHTML = `
    <table><thead><tr><th>סימון</th><th>תיאור</th><th class="num">כמות</th><th class="num">אורך (מ״מ)</th></tr></thead><tbody>${rows}</tbody></table>
    <h2 style="margin-top:22px">מה לקנות</h2>
    <table><thead><tr><th>פרופיל</th><th class="num">סה״כ</th><th class="num">משקל</th></tr></thead><tbody>${buy}</tbody></table>
    ${plates ? `<h2 style="margin-top:22px">פחים</h2><table><tbody>${plates}</tbody></table>` : ''}
    ${parts ? `<p><b>פרזול:</b> ${parts}</p>` : ''}
    <p class="small muted">אורכי חיתוך לפי מרכז הפרופיל, חיבורי קצה ישרים. משקל משוער: ${fmt(cut.totalKg)} ק״ג.</p>`;
  state.svg = C.shopDrawingSvg(sc, { cut, date: new Intl.DateTimeFormat('he-IL').format(new Date()) });
  $('drawing').innerHTML = state.svg;
  $('json').value = JSON.stringify(state.raw, null, 2);
}

function show(raw, { key, keepCamera = false } = {}) {
  const prepared = C.prepareScene(raw);
  if (prepared.errors.length) return prepared;
  state.raw = raw;
  state.prepared = prepared;
  state.cut = C.cutList(prepared.scene);
  state.key = key;
  state.open = 0;
  select(null);
  buildModel();
  if (!keepCamera) frame('3d');
  renderInfo();
  renderChips();
  updateChat();
  return prepared;
}

// --------------------------------------------------------------------------------- examples and hash
const KEYS = Object.keys(EXAMPLES);
function renderChips() {
  const mine = loadMine();
  const chips = [...KEYS.map((k) => [k, EXAMPLES[k].label]), ...(mine ? [['mine', 'שלי']] : [])];
  $('examples').innerHTML = chips
    .map(([k, label]) => `<button type="button" class="chip" data-key="${k}" aria-pressed="${state.key === k}">${esc(label)}</button>`)
    .join('');
}
$('examples').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (b) location.hash = b.dataset.key;
});
function openFromHash() {
  const key = location.hash.slice(1);
  if (key === 'mine') {
    const mine = loadMine();
    if (mine) {
      state.requests = mine.requests || [];
      state.undo = mine.undo || [];
      state.mode = 'edit';
      show(mine.raw, { key: 'mine' });
      return;
    }
  }
  const k = EXAMPLES[key] ? key : KEYS[0];
  state.requests = [];
  state.undo = [];
  state.mode = 'edit';
  show(EXAMPLES[k].layout, { key: k });
}
addEventListener('hashchange', openFromHash);

// ----------------------------------------------------------------------------------------- AI chat
let sample = null;
let dictation = null;
let downloads = null;
let image = null;
let ctl = null;

function updateChat() {
  const editing = state.mode === 'edit' && state.raw;
  $('chat-title').textContent = editing ? 'מה לשנות?' : 'ספר על העבודה';
  $('ask').placeholder = editing
    ? 'למשל: להגביה ב־20 ס״מ, שבכה כל 10 ס״מ, להוסיף משקוף באמצע, להחליף לשער הזזה'
    : 'למשל: שער כנף כפולה לחניה, פתח 4 מטר, גובה 1.80. עמודים 100/100, מסגרת 60/40, שבכה 20/20 כל 12 ס״מ, צבע אפור. אפשר להדביק כתב כמויות.';
  $('send').textContent = editing ? 'עדכן את המודל' : 'צור הדמיה';
  $('undo').hidden = !(state.key === 'mine' && state.undo.length);
  $('history').innerHTML = state.key === 'mine' ? state.requests.slice(-8).map((r) => `<span>${esc(r)}</span>`).join('') : '';
}

function busy(on, text = 'חושב...') {
  $('busy').hidden = !on;
  $('busy-text').textContent = text;
  $('send').disabled = on;
}
function chatError(text) {
  $('chat-error').hidden = !text;
  $('chat-error').textContent = text || '';
}
const ERRORS = {
  not_granted: 'לא אושר שימוש ב־Claude בדף הזה.',
  rate_limited: 'יותר מדי בקשות כרגע. נסה שוב בעוד דקה.',
  invalid_json: 'התשובה לא הייתה פריסה תקינה. נסה שוב או נסח אחרת.',
  refused: 'הבקשה נדחתה. נסח אחרת.',
  session_expired: 'צריך להתחבר מחדש ל־Claude.',
  prompt_too_large: 'הבקשה ארוכה מדי.',
};

function buildPrompt(request) {
  const parts = [INSTRUCTIONS];
  if (state.mode === 'edit' && state.raw) {
    parts.push(`CURRENT LAYOUT:\n${JSON.stringify(state.raw)}`);
    if (state.requests.length) parts.push(`Changes already applied, oldest first:\n${state.requests.map((r) => `- ${r}`).join('\n')}`);
    parts.push(`REQUEST (Hebrew):\n${request}`);
  } else {
    parts.push(`JOB DESCRIPTION (Hebrew):\n${request}`);
  }
  if (image) parts.push('An image is attached: a photo or a hand sketch of the work. Follow its design and proportions; measurements written in the text win.');
  parts.push('Reply with the complete layout as ONE JSON object, nothing else.');
  return parts.join('\n\n');
}

async function send() {
  const request = $('ask').value.trim();
  if (request.length < 3) return chatError('כתוב מה לבנות או מה לשנות.');
  if (!sample) return;
  chatError('');
  ctl = new AbortController();
  const started = performance.now();
  const tick = setInterval(() => {
    const s = Math.round((performance.now() - started) / 1000);
    if ($('busy-text').dataset.streaming !== '1') $('busy-text').textContent = `חושב על הפריסה... ${s} שנ׳`;
  }, 1000);
  $('busy-text').dataset.streaming = '0';
  busy(true);
  try {
    const opts = {
      modelTier: 'complex',
      cache: false,
      signal: ctl.signal,
      onText: ({ text }) => {
        $('busy-text').dataset.streaming = '1';
        $('busy-text').textContent = `כותב את המודל... ${fmt(text.length)} תווים`;
      },
    };
    if (image) opts.images = [image];
    const layout = await sample.json(buildPrompt(request), opts);
    const previous = state.raw;
    const wasEdit = state.mode === 'edit' && previous;
    const prepared = C.prepareScene(layout);
    if (prepared.errors.length) throw { code: 'layout', message: prepared.errors.join(', ') };
    if (state.key !== 'mine') {
      state.requests = [];
      state.undo = [];
    }
    if (wasEdit) state.undo.push(previous);
    state.requests = wasEdit ? [...state.requests, request] : [request];
    state.mode = 'edit';
    show(layout, { key: 'mine', keepCamera: Boolean(wasEdit) });
    saveMine();
    history.replaceState(null, '', '#mine');
    renderChips();
    updateChat();
    $('ask').value = '';
    clearImage();
    toast(wasEdit ? 'המודל עודכן' : 'ההדמיה מוכנה');
  } catch (e) {
    if (e?.code === 'cancelled') return;
    if (e?.code === 'layout') chatError(`הפריסה שהתקבלה לא תקינה (${e.message}). נסה לנסח אחרת.`);
    else chatError(ERRORS[e?.code] || 'משהו השתבש. אפשר לנסות שוב.');
    if (e?.code === 'not_granted' || e?.code === 'sampling_disabled') hideChat('השימוש ב־Claude לא אושר בתצוגה הזו. אפשר לעבוד עם Gemini לפי ההסבר למטה.');
  } finally {
    clearInterval(tick);
    busy(false);
    ctl = null;
  }
}
$('send').onclick = send;
$('stop').onclick = () => ctl?.abort();
$('new').onclick = () => {
  state.mode = 'new';
  updateChat();
  $('ask').focus();
};
$('undo').onclick = () => {
  const prev = state.undo.pop();
  if (!prev) return;
  state.requests.pop();
  show(prev, { key: 'mine', keepCamera: true });
  saveMine();
  updateChat();
  toast('השינוי האחרון בוטל');
};

function hideChat(text) {
  $('chat-body').hidden = true;
  $('chat-hint').textContent = text;
}

// Photo or sketch
function clearImage() {
  image = null;
  $('photo').value = '';
  $('image-name').hidden = true;
}
$('photo').addEventListener('change', (e) => {
  image = e.target.files?.[0] || null;
  $('image-name').hidden = !image;
  $('image-name').textContent = image ? `מצורף: ${image.name}` : '';
});

// Dictation
let listening = false;
$('mic').onclick = () => {
  if (!dictation) return;
  if (listening) {
    dictation.stop().catch(() => {});
    return;
  }
  dictation.start().catch((e) => {
    if (e?.code === 'not_granted') $('mic').hidden = true;
  });
};

// Capabilities light up when the viewer answers (null outside Claude)
const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
use('sample').then(async (s) => {
  sample = s;
  if (!s) {
    hideChat('הצ׳אט פועל כשהדף פתוח בתוך Claude. בינתיים אפשר לעבוד עם Gemini לפי ההסבר למטה.');
    return;
  }
  $('chat-body').hidden = false;
  $('chat-hint').textContent = 'כותבים או מכתיבים. Claude בונה את המודל, והשרטוט ורשימת החיתוך מתעדכנים איתו. כל עדכון לוקח בערך דקה.';
  const limits = await s.limits().catch(() => null);
  $('photo-label').hidden = !limits?.images;
});
use('dictation').then((d) => {
  dictation = d;
  if (!d) return;
  $('mic').hidden = false;
  let base = '';
  d.onState(({ state: st }) => {
    listening = st === 'listening';
    $('mic').setAttribute('aria-pressed', String(listening));
    $('mic-label').textContent = listening ? 'מקשיב...' : 'הכתבה';
    if (listening) base = $('ask').value ? `${$('ask').value.trim()} ` : '';
  });
  d.onPartial(({ text }) => ($('ask').value = base + text));
  d.onFinal(({ text }) => {
    base += `${text} `;
    $('ask').value = base;
  });
});
use('downloads').then((d) => {
  downloads = d;
  $('dl-svg').hidden = !d;
  $('dl-csv').hidden = !d;
  $('t-shot').hidden = !d;
});

async function save(filename, data) {
  if (!downloads) return;
  try {
    await downloads.save({ filename, data });
  } catch (e) {
    if (e?.code !== 'declined') toast('ההורדה לא זמינה כאן');
  }
}
const slug = () => (state.key === 'mine' ? 'my-design' : state.key);
$('dl-svg').onclick = () => save(`shop-drawing-${slug()}.svg`, state.svg);
$('dl-csv').onclick = () => {
  const rows = [['סימון', 'תיאור', 'כמות', 'אורך מ״מ'], ...state.cut.pieces.map((p) => [p.mark, p.name, p.count, p.length])];
  save(`cut-list-${slug()}.csv`, `﻿${rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`);
};
$('t-shot').onclick = () => {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => blob && save(`${slug()}.png`, blob), 'image/png');
};

// Tabs
for (const id of ['cut', 'draw', 'json']) {
  $(`tab-${id}`).onclick = () => {
    for (const other of ['cut', 'draw', 'json']) {
      $(`tab-${other}`).setAttribute('aria-selected', String(other === id));
      $(`panel-${other}`).hidden = other !== id;
    }
  };
}

// JSON paste
$('json-apply').onclick = () => {
  $('json-error').hidden = true;
  let raw;
  try {
    const t = $('json').value;
    raw = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch {
    $('json-error').hidden = false;
    $('json-error').textContent = 'זה לא JSON תקין. העתק את כל התשובה, מהסוגריים הראשונים עד האחרונים.';
    return;
  }
  const previous = state.raw;
  const p = show(raw, { key: 'mine' });
  if (p.errors.length) {
    $('json-error').hidden = false;
    $('json-error').textContent = p.errors.join(', ');
    return;
  }
  if (previous && state.key === 'mine') state.undo.push(previous);
  state.mode = 'edit';
  saveMine();
  history.replaceState(null, '', '#mine');
  renderChips();
  toast('הפריסה הוצגה');
};
$('json-copy').onclick = () => navigator.clipboard.writeText($('json').value).then(() => toast('הועתק'), () => toast('לא הצלחתי להעתיק'));
$('instructions').textContent = INSTRUCTIONS;
$('copy-instructions').onclick = () =>
  navigator.clipboard.writeText(INSTRUCTIONS).then(() => toast('ההנחיות הועתקו'), () => toast('לא הצלחתי להעתיק. אפשר לסמן ולהעתיק מהטקסט'));

resize();
openFromHash();
