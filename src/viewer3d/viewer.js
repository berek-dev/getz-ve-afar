// 3D viewer for layouts (src/core/scene.ts). Plain JavaScript so the app (bundled with Vite) and the
// standalone prototype page (three.js from a CDN via an import map) share one implementation.
// Types: viewer.d.ts. Geometry is built in metres from the millimetre layout.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const MM = 0.001;
const SKY = '#d9dee2';
const SOLID_COLORS = { concrete: '#a8a59c', stone: '#c3b59b', plaster: '#e4ddd0', wood: '#8b5e3c', paving: '#9f9b93' };

export function createViewer(container, { core: C, onPick, onOpenChange } = {}) {
  const v3 = (p) => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM);
  const fmt = (n) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(n);
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- renderer, scene, camera ---------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.prepend(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', direction: 'ltr' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 40, 120);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
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
  let dims = new THREE.Group();
  scene.add(dims);
  let movers = [];
  let current = null; // { prepared, cut }
  let openT = 0;
  let showDims = true;
  let underground = false;

  // --- materials -----------------------------------------------------------------------------------
  const owned = new Set();
  const track = (m) => (owned.add(m), m);
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
    const m = track(new THREE.MeshStandardMaterial(spec));
    matCache.set(key, m);
    return m;
  }
  const solidMats = new Map();
  const solidMat = (kind) => {
    if (!solidMats.has(kind)) solidMats.set(kind, track(new THREE.MeshStandardMaterial({ color: SOLID_COLORS[kind] || SOLID_COLORS.concrete, roughness: 0.92 })));
    return solidMats.get(kind);
  };
  const footingMat = track(new THREE.MeshStandardMaterial({ color: '#9d9a92', roughness: 1, transparent: true, opacity: 0.55 }));
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: '#2a2d30', metalness: 0.7, roughness: 0.35 }));
  const rubber = track(new THREE.MeshStandardMaterial({ color: '#c7951a', roughness: 0.7 }));
  const motorMat = track(new THREE.MeshStandardMaterial({ color: '#2d3236', roughness: 0.6 }));
  const highlight = track(new THREE.MeshStandardMaterial({ color: '#f3b61f', emissive: '#a5740a', emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 }));
  // The strength check's colours (the app's ok, accent and danger)
  const TINTS = {
    ok: track(new THREE.MeshStandardMaterial({ color: '#1f7a47', roughness: 0.55 })),
    close: track(new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.55 })),
    fail: track(new THREE.MeshStandardMaterial({ color: '#b42318', emissive: '#5a0d08', emissiveIntensity: 0.5, roughness: 0.5 })),
  };
  let tints = null;
  function applyTints() {
    if (!model) return;
    model.traverse((o) => {
      if (!o.isMesh || !o.userData.info) return;
      if (!o.userData.base) o.userData.base = o === picked ? o.userData.mat : o.material;
      const v = tints && o.userData.info.id ? tints[o.userData.info.id] : null;
      const mat = v && TINTS[v] ? TINTS[v] : o.userData.base;
      if (o === picked) o.userData.mat = mat;
      else o.material = mat;
    });
    needsRender = true;
  }
  const dimLineMat = track(new THREE.LineBasicMaterial({ color: '#1b2025' }));
  const finishColor = () => {
    const c = current?.prepared.scene.finish?.color;
    return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null;
  };

  // --- section outlines (metres; x along the face axis f, y along the depth axis n) ---------------
  const circlePts = (r, n = 28) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2)]);
  function rectPts(w, h, r = 0) {
    if (r <= 0.0001) return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const pts = [];
    const corners = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
    for (const [cx, cy, a0] of corners) for (let k = 0; k <= 3; k++) pts.push([cx + r * Math.cos(a0 + (k / 3) * (Math.PI / 2)), cy + r * Math.sin(a0 + (k / 3) * (Math.PI / 2))]);
    return pts;
  }
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
  function basisFor(from, to) {
    const d = C.norm(C.sub(to, from));
    const { f, n } = C.sectionAxes(d);
    const fv = new THREE.Vector3(...f);
    const nv = new THREE.Vector3(...n);
    const dv = new THREE.Vector3(...d);
    const yv = new THREE.Vector3().crossVectors(fv, nv).dot(dv) > 0 ? nv : nv.clone().negate();
    return { fv, yv, dv };
  }

  // --- meshes ---------------------------------------------------------------------------------------
  function memberMeshes(m, info) {
    const mat = steelMaterial(m.material, m.color || (m.material === 'black' ? finishColor() : null));
    // Along a curve three.js maps the shape's x to the out-of-plane normal and y to the in-plane binormal,
    // so swap the axes there to keep the face (f) in the arc's plane.
    const pts = sectionPts(m.profile, m.size);
    const swap = (list) => list.map(([x, y]) => [y, x]);
    const shape = toShape(m.via ? { outer: swap(pts.outer), holes: pts.holes.map(swap) } : pts, m.roll);
    const out = [];
    let geo;
    if (m.via) {
      const arc = C.arcThrough(m.from, m.via, m.to);
      const arcPts = Array.from({ length: 41 }, (_, i) => v3(C.arcPoint(arc, i / 40)));
      geo = new THREE.ExtrudeGeometry(shape, { steps: 60, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(arcPts) });
    } else {
      geo = new THREE.ExtrudeGeometry(shape, { depth: C.len(C.sub(m.to, m.from)) * MM, bevelEnabled: false, steps: 1 });
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

  // A roofing sheet (סנטף, polycarbonate): its tint, see-through, no shadow of its own
  function sheetMaterial(color, opacity) {
    const key = `sheet|${color}|${opacity}`;
    if (matCache.has(key)) return matCache.get(key);
    const m = track(
      new THREE.MeshStandardMaterial({ color: color || '#dfeef5', transparent: true, opacity: opacity ?? 0.4, roughness: 0.25, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    matCache.set(key, m);
    return m;
  }

  function plateMesh(p) {
    const [a, b] = p.size.map((v) => v * MM);
    const t = p.thickness * MM;
    const dimsArr = p.normal === 'z' ? [a, b, t] : p.normal === 'x' ? [t, b, a] : [a, t, b];
    const mat = p.sheet ? sheetMaterial(p.color, p.opacity) : steelMaterial(p.material, p.color || (p.material === 'black' ? finishColor() : null));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimsArr), mat);
    mesh.position.copy(v3(p.center));
    // A sloped roof: tilted about its centre so it rises toward p.slope.up
    if (p.normal === 'y' && p.slope) {
      const t = (p.slope.deg * Math.PI) / 180;
      if (p.slope.up === '+x') mesh.rotation.z = t;
      else if (p.slope.up === '-x') mesh.rotation.z = -t;
      else if (p.slope.up === '+z') mesh.rotation.x = -t;
      else mesh.rotation.x = t;
    }
    return mesh;
  }

  function partObject(p) {
    const g = new THREE.Group();
    const s = (p.size || []).map((v) => v * MM);
    const add = (geom, mat, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geom, mat);
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
        const wheel = add(new THREE.CylinderGeometry(d / 2, d / 2, s[1] || 0.03, 28), darkMetal);
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
      case 'handle':
        add(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 12), darkMetal, -0.06).rotation.z = Math.PI / 2;
        add(new THREE.BoxGeometry(0.03, 0.06, 0.02), darkMetal);
        break;
      case 'drop_bolt':
        add(new THREE.CylinderGeometry(0.008, 0.008, s[1] || 0.45, 12), darkMetal);
        break;
      case 'stopper':
        add(new THREE.BoxGeometry(0.06, 0.12, 0.06), rubber);
        break;
      case 'motor':
        add(new THREE.BoxGeometry(s[0] || 0.3, s[1] || 0.28, s[2] || 0.2), motorMat);
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
        const mat = steelMaterial(current.prepared.scene.material || 'black', finishColor());
        add(new THREE.TorusGeometry(r, 0.005, 8, 32, Math.PI * 1.6), mat).rotation.z = Math.PI * 0.2;
        add(new THREE.TorusGeometry(r * 0.45, 0.005, 8, 24, Math.PI * 1.5), mat, r * 0.4, -r * 0.2).rotation.z = Math.PI * 1.1;
        break;
      }
      case 'footing':
        add(new THREE.BoxGeometry(s[0] || 0.4, s[1] || 0.6, s[2] || 0.4), footingMat).userData.footing = true;
        break;
    }
    g.position.copy(v3(p.at));
    const label = p.label || C.PART_LABELS[p.kind];
    g.traverse((o) => (o.userData.info = { mark: null, text: label }));
    return g;
  }

  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.element) o.element.remove();
    });
  }

  function build() {
    const { prepared, cut } = current;
    const sc = prepared.scene;
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
      const info = {
        id: m.id ?? null,
        mark: cut.markOf[m.id] || null,
        text: `${C.sectionName(m.profile, m.size, m.material)}, ${fmt(Math.round(C.memberLength(m)))} מ״מ${m.via ? ' (מכופף)' : ''}${m.label ? `, ${m.label}` : ''}`,
      };
      for (const mesh of memberMeshes(m, info)) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        holder(m.group).add(mesh);
      }
    }
    for (const p of sc.plates) {
      const mesh = plateMesh(p);
      mesh.castShadow = !p.sheet;
      mesh.receiveShadow = !p.sheet;
      const size = `${fmt(Math.max(...p.size))}/${fmt(Math.min(...p.size))}`;
      const text = p.sheet ? `${p.label || 'סנטף'}, ${size}` : `${p.label || 'פח'} ${p.thickness} מ״מ, ${size}`;
      mesh.userData.info = { id: p.id ?? null, mark: null, text };
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
      mesh.userData.info = { mark: null, text: s.label || 'סביבה קיימת' };
      model.add(mesh);
    }
    scene.add(model);
    setOpen(0);
    buildDims();
    if (tints) applyTints();
  }

  // --- dimensions -----------------------------------------------------------------------------------
  function dimLabel(text, pos) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      background: 'rgb(27 32 37 / .82)',
      color: '#fff',
      font: '600 12px system-ui, sans-serif',
      padding: '2px 7px',
      borderRadius: '6px',
      whiteSpace: 'nowrap',
      direction: 'rtl',
      top: '0',
      left: '0',
    });
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    return o;
  }
  function dimLine(a, b, normal, text) {
    const tick = normal.clone().multiplyScalar(0.06);
    const geom = new THREE.BufferGeometry().setFromPoints([a, b, a.clone().add(tick), a.clone().sub(tick), b.clone().add(tick), b.clone().sub(tick)]);
    const grp = new THREE.Group();
    grp.add(new THREE.LineSegments(geom, dimLineMat), dimLabel(text, a.clone().add(b).multiplyScalar(0.5)));
    return grp;
  }
  function buildDims() {
    scene.remove(dims);
    disposeTree(dims);
    dims = new THREE.Group();
    // Always measured from the geometry (C.dimensionLines): each leaf, overall width and height, extra dimensions
    const NORMAL = { x: new THREE.Vector3(0, 1, 0), y: new THREE.Vector3(1, 0, 0), z: new THREE.Vector3(1, 0, 0) };
    for (const d of C.dimensionLines(current.prepared.scene)) {
      dims.add(dimLine(v3(d.from), v3(d.to), NORMAL[d.axis], `${d.name ? `${d.name} ` : ''}${fmt(d.mm)} מ״מ`));
    }
    dims.visible = showDims;
    scene.add(dims);
  }

  // --- camera, rendering ----------------------------------------------------------------------------
  let needsRender = true;
  controls.addEventListener('change', () => (needsRender = true));
  // While the user hasn't moved the camera since the last framing, keep the work fitted when the view
  // changes size (full screen, rotating the phone). Touching the view hands the camera over.
  let fitKind = null;
  controls.addEventListener('start', () => (fitKind = null));
  function frame(kind = '3d') {
    if (!current) return;
    fitKind = kind;
    applySize();
    fit(kind);
  }
  function fit(kind) {
    const wb = C.workBounds(current.prepared.scene);
    const min = v3(wb.min);
    const max = v3(wb.max);
    const center = min.clone().add(max).multiplyScalar(0.5);
    center.y = Math.max(center.y, (max.y - Math.max(min.y, 0)) / 2);
    const size = max.clone().sub(min);
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
    sun.position.copy(center).add(new THREE.Vector3(span * 0.6, span * 1.4, span));
    sun.target.position.copy(center);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.1, far: span * 5 });
    sun.shadow.camera.updateProjectionMatrix();
    needsRender = true;
  }
  /** Matches the canvas to the container; false while the container has no size (hidden, mid-layout) */
  function applySize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return false;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
    return true;
  }
  function resize() {
    if (applySize() && fitKind && current) fit(fitKind);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let anim = null;
  function setOpen(t) {
    openT = t;
    for (const { pivot, motion } of movers) {
      if (motion.type === 'swing') pivot.rotation.y = THREE.MathUtils.degToRad(motion.angle) * t;
      else pivot.position.copy(v3(motion.offset)).multiplyScalar(t);
    }
    needsRender = true;
    if (onOpenChange) onOpenChange(t);
  }
  function animateOpen(target) {
    if (reduceMotion) return setOpen(target);
    anim = { from: openT, to: target, start: performance.now(), ms: 1400 };
  }
  let raf = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (anim) {
      const k = Math.min(1, (now - anim.start) / anim.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setOpen(anim.from + (anim.to - anim.from) * e);
      if (k >= 1) anim = null;
    }
    const moved = controls.update();
    if (needsRender || moved) {
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      needsRender = false;
    }
  }
  raf = requestAnimationFrame(loop);

  // --- picking --------------------------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  let downAt = null;
  let picked = null;
  const onDown = (e) => (downAt = [e.clientX, e.clientY]);
  const onUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(model, true).find((h) => h.object.userData.info && !(h.object.userData.footing && !underground));
    select(hit ? hit.object : null);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  function select(mesh) {
    if (picked) picked.material = picked.userData.mat;
    picked = null;
    if (mesh && mesh.isMesh && !mesh.userData.footing) {
      mesh.userData.mat = mesh.material;
      mesh.material = highlight;
      picked = mesh;
    }
    needsRender = true;
    if (onPick) onPick(mesh ? mesh.userData.info : null);
  }

  return {
    setTints(map) {
      tints = map || null;
      applyTints();
    },
    show(prepared, cut, { keepCamera = false } = {}) {
      select(null);
      current = { prepared, cut };
      build();
      if (!keepCamera) frame('3d');
    },
    setOpen(t) {
      anim = null;
      setOpen(t);
    },
    animateOpen,
    get open() {
      return openT;
    },
    get hasMovers() {
      return movers.length > 0;
    },
    setDims(on) {
      showDims = on;
      dims.visible = on;
      needsRender = true;
    },
    setUnderground(on) {
      underground = on;
      groundMat.transparent = on;
      groundMat.opacity = on ? 0.25 : 1;
      groundMat.depthWrite = !on;
      controls.maxPolarAngle = on ? Math.PI : Math.PI / 2 - 0.02;
      needsRender = true;
    },
    frame,
    clearSelection: () => select(null),
    screenshot() {
      renderer.render(scene, camera);
      return new Promise((resolve) => renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeTree(model);
      disposeTree(dims);
      ground.geometry.dispose();
      grid.geometry.dispose();
      for (const m of owned) m.dispose();
      groundMat.dispose();
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
