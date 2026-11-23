// Визуализация: 3D-мастерская для главной страницы (HeroScene) и сцена симулятора (SimView).
// Педагогической логики здесь нет — только меши, материалы, анимации.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const MM = 0.01; // 1 мм = 0.01 единицы сцены
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = k => k * k * (3 - 2 * k);
const lerp = (a, b, t) => a + (b - a) * t;

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) { return false; }
}

function makeRenderer(canvas, alpha = false) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}
function applyEnv(renderer, scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env; pm.dispose();
  return env;
}
function disposeTree(obj) {
  obj.traverse(o => {
    if (o.isCSS2DObject) o.element.remove();
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(m => {
      if (m.map && !m.map.userData.shared) m.map.dispose();
      m.dispose();
    });
  });
}

/* ---------- процедурные текстуры ---------- */
function canvasTex(w, h, draw, shared = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.shared = shared;
  return t;
}
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function grainTex({ base, line, knots = 0, density = 90, alpha = .22, seed = 7 }, shared) {
  return canvasTex(512, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < density; i++) {
      const y = r() * h, amp = 1.5 + r() * 5, f = .004 + r() * .016;
      g.strokeStyle = line; g.globalAlpha = alpha * (.3 + r()); g.lineWidth = .5 + r() * 2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin(x * f + i) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.stroke();
    }
    for (let k = 0; k < knots; k++) {
      const x = 60 + r() * (w - 120), y = 40 + r() * (h - 80);
      g.globalAlpha = .35; g.strokeStyle = line;
      for (let s = 16; s > 1; s -= 2.5) { g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, s * 2.2, s * .7, 0, 0, 7); g.stroke(); }
    }
    g.globalAlpha = 1;
  }, shared);
}
function layersTex(shared) { // торец фанеры: слои
  return canvasTex(256, 64, (g, w, h) => {
    const n = 5;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#b98f5c' : '#e2c79c'; g.fillRect(0, i * h / n, w, h / n); }
    g.fillStyle = 'rgba(80,50,20,.35)'; for (let i = 1; i < n; i++) g.fillRect(0, i * h / n - 1, w, 2);
  }, shared);
}
function speckleTex(base, shared) { // МДФ
  return canvasTex(256, 256, (g, w, h) => {
    const r = rnd(3); g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) { g.fillStyle = r() > .5 ? 'rgba(60,40,20,.18)' : 'rgba(255,235,200,.12)'; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  }, shared);
}
function rulerTex() {
  return canvasTex(2048, 128, (g, w, h) => {
    g.fillStyle = '#f3efe4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#202722'; g.font = 'bold 30px Inter, sans-serif'; g.textAlign = 'center';
    for (let i = 0; i <= 200; i++) {
      const x = 12 + i / 200 * (w - 24);
      const len = i % 10 === 0 ? 56 : i % 5 === 0 ? 38 : 22;
      g.fillRect(x - 1.2, 0, 2.4, len);
      if (i % 10 === 0) g.fillText(String(i / 10), x, 96);
    }
  });
}

/* ---------- материалы древесины ---------- */
function woodMaterials(id, cache) {
  if (cache[id]) return cache[id];
  const std = (map, rough = .72) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0 });
  let set;
  if (id === 'plywood') {
    const top = grainTex({ base: '#dcc196', line: '#a17a4a', density: 70, alpha: .18, seed: 11 }, true);
    const edge = layersTex(true);
    set = [std(edge), std(edge), std(top), std(top), std(edge), std(edge)];
  } else if (id === 'pine') {
    const t = grainTex({ base: '#e6bd7f', line: '#9a6328', knots: 2, density: 110, alpha: .28, seed: 5 }, true);
    set = Array(6).fill(0).map(() => std(t, .68));
  } else if (id === 'mdf') {
    const t = speckleTex('#a07e5b', true);
    set = Array(6).fill(0).map(() => std(t, .85));
  } else { // столешница
    const t = grainTex({ base: '#b88a5a', line: '#6e4724', density: 130, alpha: .3, seed: 21 }, true);
    set = Array(6).fill(0).map(() => std(t, .6));
  }
  cache[id] = set; return set;
}
const cloneSet = set => set.map(m => m.clone());

/* ---------- процедурные инструменты ---------- */
const MAT = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0xc9d0d4, metalness: .9, roughness: .28 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2e3530, metalness: .4, roughness: .5 }),
  green: () => new THREE.MeshStandardMaterial({ color: 0x23382f, roughness: .45 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xb58a55, metalness: .7, roughness: .35 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4 })
};
function shadowAll(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

function makeSaw() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0); const n = 34, L = 1.5;
  for (let i = 0; i < n; i++) { s.lineTo((i + .5) / n * L, -.025); s.lineTo((i + 1) / n * L, 0); }
  s.lineTo(L, .26); s.lineTo(0, .17); s.lineTo(0, 0);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: .006, bevelEnabled: false }), MAT.steel());
  blade.position.z = -.003; g.add(blade);
  const handle = new THREE.Mesh(new RoundedBoxGeometry(.34, .3, .07, 3, .03), MAT.green());
  handle.position.set(L + .14, .14, 0); g.add(handle);
  return shadowAll(g);
}
function makeRuler(lenMM = 200) {
  // шкала текстуры занимает 2024 из 2048 px — подгоняем длину, чтобы 1 мм = 1 мм сцены
  const L = lenMM * MM * 2048 / 2024, off = 12 / 2048 * L;
  const mats = [MAT.white(), MAT.white(), new THREE.MeshStandardMaterial({ map: rulerTex(), roughness: .5 }), MAT.white(), MAT.white(), MAT.white()];
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, .012, .32), mats);
  m.geometry.translate(L / 2 - off, 0, 0); // нулевая отметка линейки в x=0
  return shadowAll(m);
}
function makeClamp() {
  const g = new THREE.Group(); const st = MAT.dark(), sl = MAT.steel();
  const a = new THREE.Mesh(new THREE.BoxGeometry(.08, .7, .1), st); a.position.set(0, .05, 0);
  const t = new THREE.Mesh(new THREE.BoxGeometry(.4, .08, .1), st); t.position.set(.16, .36, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(.4, .08, .1), st); b.position.set(.16, -.26, 0);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .45, 12), sl); screw.position.set(.3, .1, 0);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .03, 20), sl); pad.position.set(.3, -.12, 0);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .22, 10), MAT.brass()); knob.rotation.z = Math.PI / 2; knob.position.set(.3, .4, 0);
  g.add(a, t, b, screw, pad, knob);
  return shadowAll(g);
}
function makeFile() {
  const g = new THREE.Group();
  const f = new THREE.Mesh(new THREE.BoxGeometry(.9, .03, .09), MAT.dark()); g.add(f);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, .35, 14), MAT.brass()); h.rotation.z = Math.PI / 2; h.position.x = .62; g.add(h);
  return shadowAll(g);
}
function makeSandBlock() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new RoundedBoxGeometry(.42, .14, .26, 3, .03), MAT.green()); b.position.y = .09; g.add(b);
  const p = new THREE.Mesh(new THREE.BoxGeometry(.44, .02, .28), new THREE.MeshStandardMaterial({ color: 0xc9a36c, roughness: 1 })); p.position.y = .01; g.add(p);
  return shadowAll(g);
}
function makePencil() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, .7, 6), MAT.green()); body.rotation.z = Math.PI / 2; g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.028, .1, 6), new THREE.MeshStandardMaterial({ color: 0xe0c08f })); tip.rotation.z = Math.PI / 2; tip.position.x = .4; g.add(tip);
  return shadowAll(g);
}
function makePhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, .08, .74, 4, .035), MAT.dark());
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.38, .64), new THREE.MeshStandardMaterial({ color: 0x23382f, emissive: 0x2e5a47, emissiveIntensity: .6, roughness: .2 }));
  scr.rotation.x = -Math.PI / 2; scr.position.y = .041;
  g.add(body, scr);
  return shadowAll(g);
}
function label(text, cls = '') {
  const el = document.createElement('div'); el.className = 'lbl ' + cls; el.textContent = text;
  return new CSS2DObject(el);
}

/* =====================================================================
   HeroScene — мастерская на главной, камера управляется прокруткой
   ===================================================================== */
export class HeroScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = makeRenderer(canvas);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1ebdf);
    this.scene.fog = new THREE.Fog(0xf1ebdf, 14, 36);
    this.env = applyEnv(this.r, this.scene);
    this.scene.environmentIntensity = .55;
    this.cam = new THREE.PerspectiveCamera(40, 1, .05, 60);
    this.cache = {};
    this.progress = 0; this.visible = true; this.mouse = { x: 0, y: 0 };
    this.build();
    this.keys = [
      { p: [4.4, 3.5, 7.4], t: [-1.5, 1.25, 0] },   // общий план (стол справа от заголовка)
      { p: [2.7, 2.4, 3.3], t: [0, 1.05, 0] },   // рабочий стол
      { p: [.75, 1.75, 1.45], t: [-.05, 1.05, 0] }, // заготовка
      { p: [-.9, 1.75, 1.1], t: [-.2, 1.0, -.45] } // линейка и инструменты
    ];
    this.cp = new THREE.Vector3(...this.keys[0].p); this.ct = new THREE.Vector3(...this.keys[0].t);
    this.onResize = () => this.resize(); addEventListener('resize', this.onResize); this.resize();
    this.onMove = e => { this.mouse.x = e.clientX / innerWidth - .5; this.mouse.y = e.clientY / innerHeight - .5; };
    addEventListener('pointermove', this.onMove, { passive: true });
    this.clock = new THREE.Clock();
    const tick = () => { this.raf = requestAnimationFrame(tick); if (this.visible) this.render(); };
    tick();
  }
  build() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xfff4e2, 0xb59c7c, .6));
    const sun = new THREE.DirectionalLight(0xffdcae, 2.4);
    sun.position.set(-5, 7, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .02; S.add(sun);
    const lamp = new THREE.PointLight(0xffc98a, 6, 6, 2); lamp.position.set(.3, 2.6, .2); S.add(lamp);

    // деревянный пол из досок
    const floorTex = canvasTex(512, 512, (g, w, h) => {
      const r = rnd(4);
      for (let i = 0; i < 8; i++) {
        const y = i * h / 8; g.fillStyle = `hsl(36,${28 + r() * 10}%,${70 + r() * 8}%)`; g.fillRect(0, y, w, h / 8);
        g.strokeStyle = 'rgba(90,60,30,.18)';
        for (let k = 0; k < 6; k++) { g.lineWidth = .5 + r(); g.beginPath(); const yy = y + 4 + r() * (h / 8 - 8); g.moveTo(0, yy); g.bezierCurveTo(w * .3, yy + r() * 6 - 3, w * .6, yy + r() * 6 - 3, w, yy); g.stroke(); }
        g.fillStyle = 'rgba(70,45,20,.35)'; g.fillRect(0, y, w, 2); g.fillRect(r() * w, y, 2, h / 8);
      }
    });
    floorTex.repeat.set(10, 10);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorTex, roughness: .85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ color: 0xece5d6, roughness: 1 }));
    wall.position.set(0, 6, -3.2); wall.receiveShadow = true; S.add(wall);
    // окно (светящаяся рама)
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), new THREE.MeshBasicMaterial({ color: 0xfff8ec }));
    win.position.set(-3.2, 2.9, -3.19); S.add(win);
    const frameM = MAT.green();
    [[0, .9, 2.7, .06], [0, -.9, 2.7, .06], [0, 0, 2.7, .04], [-1.3, 0, .06, 1.86], [1.3, 0, .06, 1.86], [0, 0, .04, 1.86]].forEach(([x, y, w, h]) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, .05), frameM); f.position.set(-3.2 + x, 2.9 + y, -3.17); S.add(f);
    });
    // перфопанель с полкой
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, .05), new THREE.MeshStandardMaterial({ color: 0xd8c7a6, roughness: .9 }));
    board.position.set(1.4, 2.4, -3.15); board.receiveShadow = true; S.add(board);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, .06, .35), woodMaterials('bench', this.cache)[0]);
    shelf.position.set(1.4, 1.65, -3); S.add(shadowAll(shelf));
    for (let i = 0; i < 5; i++) { // стопка заготовок
      const p = new THREE.Mesh(new THREE.BoxGeometry(.9, .07, .3), woodMaterials(['plywood', 'pine', 'mdf'][i % 3], this.cache));
      p.position.set(.4 + (i % 2) * .05, 1.72 + i * .075, -3); S.add(shadowAll(p));
    }
    const hangSaw = makeSaw(); hangSaw.scale.setScalar(.7); hangSaw.position.set(1.6, 2.35, -3.1); hangSaw.rotation.z = -.15; S.add(hangSaw);

    // верстак (поверхность y=1.0)
    const bench = new THREE.Group();
    const top = new THREE.Mesh(new RoundedBoxGeometry(5.2, .16, 2.2, 3, .03), woodMaterials('bench', this.cache));
    top.position.y = .92; bench.add(top);
    const legM = MAT.green();
    [[-2.4, -.95], [2.4, -.95], [-2.4, .95], [2.4, .95]].forEach(([x, z]) => {
      const l = new THREE.Mesh(new THREE.BoxGeometry(.12, .84, .12), legM); l.position.set(x, .42, z); bench.add(l);
    });
    const low = new THREE.Mesh(new THREE.BoxGeometry(4.9, .05, 1.9), woodMaterials('bench', this.cache)); low.position.y = .22; bench.add(low);
    S.add(shadowAll(bench));

    // заготовка + линия разметки (рисуется прокруткой)
    this.blank = new THREE.Mesh(new RoundedBoxGeometry(1.5, .08, .8, 2, .006), woodMaterials('plywood', this.cache));
    this.blank.position.set(0, 1.04, 0); S.add(shadowAll(this.blank));
    this.markLine = new THREE.Mesh(new THREE.BoxGeometry(.008, .002, .8), new THREE.MeshBasicMaterial({ color: 0x23382f }));
    this.markLine.position.set(-.15, 1.081, 0); this.markLine.scale.z = .001; S.add(this.markLine);

    const ruler = makeRuler(); ruler.position.set(-.75, 1.006, -.62); S.add(ruler);
    const pencil = makePencil(); pencil.position.set(-.5, 1.03, .62); pencil.rotation.y = .4; S.add(pencil); this.pencil = pencil;
    this.saw = makeSaw(); this.saw.rotation.x = -Math.PI / 2; this.saw.position.set(-2.3, 1.005, .2); this.saw.rotation.z = .2; S.add(this.saw);
    const clamp = makeClamp(); clamp.scale.setScalar(.6); clamp.position.set(1.9, 1.15, .6); clamp.rotation.y = -.6; S.add(clamp);
    const file = makeFile(); file.position.set(1.2, 1.02, .75); file.rotation.y = .3; S.add(file);
    const block = makeSandBlock(); block.position.set(1.55, 1.0, -.45); block.rotation.y = -.4; S.add(block);

    // подвесная лампа
    const shade = new THREE.Mesh(new THREE.ConeGeometry(.35, .3, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x23382f, side: THREE.DoubleSide, roughness: .5 }));
    shade.position.set(.3, 2.85, .2); S.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.08, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff0d0 })); bulb.position.set(.3, 2.72, .2); S.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, 3), MAT.dark()); cord.position.set(.3, 4.5, .2); S.add(cord);

    // древесная пыль в луче света
    const N = 260, pos = new Float32Array(N * 3), r = rnd(9);
    for (let i = 0; i < N; i++) { pos[i * 3] = -4 + r() * 5; pos[i * 3 + 1] = .9 + r() * 3; pos[i * 3 + 2] = -2.5 + r() * 4; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xfff1d6, size: .025, transparent: true, opacity: .7, depthWrite: false }));
    S.add(this.dust);
  }
  setProgress(p) { this.progress = Math.max(0, Math.min(1, p)); }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.r.setSize(w, h, false); this.cam.aspect = w / h;
    this.cam.fov = w / h < .8 ? 58 : 40; this.cam.updateProjectionMatrix();
    this.narrow = w / h < .8;
  }
  render() {
    const t = this.clock.getElapsedTime();
    const K = this.keys, f = this.progress * (K.length - 1);
    const i = Math.min(Math.floor(f), K.length - 2), u = smooth(f - i);
    const tp = new THREE.Vector3().fromArray(K[i].p).lerp(new THREE.Vector3().fromArray(K[i + 1].p), u);
    const tt = new THREE.Vector3().fromArray(K[i].t).lerp(new THREE.Vector3().fromArray(K[i + 1].t), u);
    if (this.narrow) { // на телефоне стол по центру, ниже текста
      tp.y += .25; tp.z += .6; tt.y += .35 * (i === 0 ? 1 - u : 0) - .12;
      if (i === 0) tt.x += 1.5 * (1 - u);
    }
    const k = REDUCED ? 1 : .07;
    this.cp.lerp(tp, k); this.ct.lerp(tt, k);
    const par = REDUCED ? 0 : .25;
    this.cam.position.set(this.cp.x + this.mouse.x * par, this.cp.y - this.mouse.y * par * .6, this.cp.z);
    this.cam.lookAt(this.ct);
    // анимации, зависящие от прокрутки
    const drawK = smooth(Math.min(1, Math.max(0, (this.progress - .45) / .2)));
    this.markLine.scale.z = Math.max(.001, drawK);
    this.markLine.position.z = -.4 + .4 * drawK;
    this.pencil.position.set(-.15 + .02, 1.03 + (1 - drawK) * .0, -.4 + .8 * drawK + .02);
    this.pencil.rotation.y = lerp(.4, Math.PI / 2 - .2, drawK);
    const lift = smooth(Math.min(1, Math.max(0, (this.progress - .8) / .2)));
    this.saw.position.y = 1.005 + lift * .06;
    if (!REDUCED) { this.dust.rotation.y = t * .015; this.dust.position.y = Math.sin(t * .3) * .05; }
    this.r.render(this.scene, this.cam);
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize); removeEventListener('pointermove', this.onMove);
    disposeTree(this.scene); Object.values(this.cache).flat().forEach(m => m.map && m.map.dispose());
    this.env.dispose(); this.r.dispose();
  }
}

/* =====================================================================
   SimView — сцена симулятора. Методы вызываются из simulator.js
   ===================================================================== */
export class SimView {
  constructor(container) {
    this.el = container;
    const canvas = document.createElement('canvas'); container.prepend(canvas);
    this.r = makeRenderer(canvas, true);
    this.css = new CSS2DRenderer(); this.css.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    container.appendChild(this.css.domElement);
    this.scene = new THREE.Scene();
    this.env = applyEnv(this.r, this.scene); this.scene.environmentIntensity = .6;
    this.cam = new THREE.PerspectiveCamera(38, 1, .02, 50); this.cam.position.set(0, 2.6, 3.4);
    this.ctrl = new OrbitControls(this.cam, canvas);
    Object.assign(this.ctrl, { enableDamping: !REDUCED, dampingFactor: .08, minDistance: 1.2, maxDistance: 7, maxPolarAngle: Math.PI * .48, enablePan: false });
    this.ctrl.target.set(0, .1, 0);
    this.cache = {}; this.anims = []; this.pickables = []; this.onPick = null;
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.buildBase();
    this.clock = new THREE.Clock();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); this.resize();
    this.bindPointer(canvas);
    const tick = () => { this.raf = requestAnimationFrame(tick); this.update(); };
    tick();
  }
  buildBase() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xfff6e8, 0xa58f70, .7));
    const d = new THREE.DirectionalLight(0xffe2bb, 2.2); d.position.set(-2.5, 5, 3); d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048); Object.assign(d.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .5, far: 15 });
    d.shadow.bias = -.0004; d.shadow.normalBias = .02; S.add(d);
    const fill = new THREE.DirectionalLight(0xdde8ff, .5); fill.position.set(3, 2, -2); S.add(fill);
    const table = new THREE.Mesh(new RoundedBoxGeometry(8, .3, 5, 3, .05), woodMaterials('bench', this.cache));
    table.position.y = -.15; table.receiveShadow = true; S.add(table);
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
    this.r.setSize(w, h, false); this.css.setSize(w, h); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }
  bindPointer(canvas) {
    const ray = new THREE.Raycaster(), v = new THREE.Vector2(); let down = null;
    const hit = e => {
      const b = canvas.getBoundingClientRect();
      v.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(v, this.cam);
      return ray.intersectObjects(this.pickables, true)[0];
    };
    canvas.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY };
      if (this.onDrag) { const h = hit(e); if (h) { this.ctrl.enabled = false; this.dragging = true; this.onDrag(h.point); } }
    });
    canvas.addEventListener('pointermove', e => { if (this.dragging && this.onDrag) { const h = hit(e); if (h) this.onDrag(h.point); } });
    const up = e => {
      if (this.dragging) { this.dragging = false; this.ctrl.enabled = true; }
      else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && this.onPick) {
        const h = hit(e); if (h) { let o = h.object; while (o && !o.userData.pick) o = o.parent; if (o) this.onPick(o.userData.pick); }
      }
      down = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.style.touchAction = 'none';
  }
  tween(dur, fn) {
    return new Promise(res => {
      if (REDUCED || dur <= 0) { fn(1); res(); return; }
      this.anims.push({ t: 0, dur, fn, res });
    });
  }
  focus(p, t, dur = .9) {
    const p0 = this.cam.position.clone(), t0 = this.ctrl.target.clone();
    const p1 = new THREE.Vector3(...p), t1 = new THREE.Vector3(...t);
    const asp = this.el.clientWidth / this.el.clientHeight;
    p1.sub(t1).multiplyScalar(Math.min(1.9, Math.max(1, 1.7 / asp))).add(t1); // узкий экран — камера дальше
    return this.tween(dur, k => { this.cam.position.lerpVectors(p0, p1, k); this.ctrl.target.lerpVectors(t0, t1, k); });
  }
  update() {
    const dt = Math.min(this.clock.getDelta(), .05);
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]; a.t += dt; const k = Math.min(1, a.t / a.dur);
      a.fn(ease(k)); if (k >= 1) { this.anims.splice(i, 1); a.res(); }
    }
    if (this.spin && !REDUCED) this.spin.rotation.y += dt * .35;
    this.ctrl.update();
    this.r.render(this.scene, this.cam); this.css.render(this.scene, this.cam);
  }
  clear() {
    this.anims.forEach(a => a.res()); this.anims = [];
    disposeTree(this.root); this.root.clear();
    this.pickables = []; this.onPick = null; this.onDrag = null; this.spin = null;
    this.ctrl.autoRotate = false;
  }
  board(mat, L, W, T, radius = .004) {
    const r = Math.min(radius, T * MM / 2 - .0005, W * MM / 2 - .001);
    const m = new THREE.Mesh(new RoundedBoxGeometry(L * MM, T * MM, W * MM, 3, Math.max(.0005, r)), cloneSet(woodMaterials(mat, this.cache)));
    return shadowAll(m);
  }

  /* ---- этап 1: образцы материалов ---- */
  showMaterials(materials, onPick) {
    this.clear(); this.onPick = onPick; this.samples = {};
    materials.forEach((m, i) => {
      const g = new THREE.Group(); g.userData.pick = m.id;
      const b = this.board(m.id, 90, 55, m.id === 'pine' ? 18 : 10, .006);
      b.position.y = (m.id === 'pine' ? 18 : 10) * MM / 2; g.add(b);
      g.position.set((i - 1) * 1.2, 0, 0); g.rotation.y = (i - 1) * -.2;
      const l = label(m.name); l.position.set(0, -.02, .45); g.add(l);
      this.root.add(g); this.pickables.push(g); this.samples[m.id] = g;
    });
    this.focus([0, 2.1, 3.3], [0, 0, 0]);
  }
  highlightMaterial(id) {
    Object.entries(this.samples || {}).forEach(([k, g]) => {
      const on = k === id, y0 = g.position.y, r0 = g.rotation.x;
      g.children.find(c => c.isCSS2DObject).element.className = 'lbl ' + (on ? 'wood' : '');
      this.tween(.5, e => { g.position.y = lerp(y0, on ? .22 : 0, e); g.rotation.x = lerp(r0, on ? .35 : 0, e); });
    });
  }

  /* ---- этап 2: заготовка с размерами ---- */
  showBlank(mat, dims) {
    this.clear();
    this.blank = shadowAll(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), cloneSet(woodMaterials(mat, this.cache))));
    this.root.add(this.blank);
    const lineM = new THREE.LineBasicMaterial({ color: 0x23382f });
    this.dimL = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.5, 0, 0), new THREE.Vector3(.5, 0, 0)]), lineM);
    this.dimW = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -.5), new THREE.Vector3(0, 0, .5)]), lineM.clone());
    this.root.add(this.dimL, this.dimW);
    this.lL = label(''); this.lW = label(''); this.lT = label('');
    this.root.add(this.lL, this.lW, this.lT);
    this.updateDims(dims, {});
    this.focus([1.1, 1.9, 2.4], [0, 0, 0]);
  }
  updateDims(d, ok) {
    const L = d.length * MM, W = d.width * MM, T = d.thickness * MM;
    this.blank.scale.set(L, T, W); this.blank.position.y = T / 2;
    this.dimL.scale.x = L; this.dimL.position.set(0, .002, W / 2 + .12);
    this.dimW.scale.z = W; this.dimW.position.set(L / 2 + .12, .002, 0);
    const cls = k => ok[k] === true ? 'ok' : ok[k] === false ? 'bad' : '';
    this.lL.element.textContent = d.length + ' мм'; this.lL.element.className = 'lbl ' + cls('length'); this.lL.position.set(0, .02, W / 2 + .2);
    this.lW.element.textContent = d.width + ' мм'; this.lW.element.className = 'lbl ' + cls('width'); this.lW.position.set(L / 2 + .28, .02, 0);
    this.lT.element.textContent = d.thickness + ' мм'; this.lT.element.className = 'lbl ' + cls('thickness'); this.lT.position.set(-L / 2 - .1, T + .08, W / 2);
  }

  /* ---- этап 3: разметка ---- */
  showMarking(mat, d, mark, onMark) {
    this.clear();
    const L = d.length * MM, W = d.width * MM, T = d.thickness * MM;
    this.mk = { L, W, T };
    const b = this.board(mat, d.length, d.width, d.thickness); b.position.y = T / 2; this.root.add(b);
    this.pickables = [b];
    const ruler = makeRuler(); ruler.position.set(-L / 2, .006, -W / 2 - .17); this.root.add(ruler);
    this.line = new THREE.Mesh(new THREE.BoxGeometry(.007, .002, W), new THREE.MeshBasicMaterial({ color: 0x202722 }));
    this.line.position.y = T + .0012; this.root.add(this.line);
    this.lineLbl = label(''); this.root.add(this.lineLbl);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(.012, .003, W + .1), new THREE.MeshBasicMaterial({ color: 0x2f7a4f, transparent: true, opacity: .85 }));
    this.ghost.visible = false; this.ghost.position.y = T + .0015; this.root.add(this.ghost);
    this.ghostLbl = label('', 'ok'); this.ghostLbl.visible = false; this.root.add(this.ghostLbl);
    this.setMark(mark);
    this.onDrag = p => onMark(Math.round((p.x + L / 2) / MM));
    this.focus([-.2, 2.1, 1.25], [-.2, 0, -.05]);
  }
  setMark(mm, state = '') {
    const { L, W } = this.mk;
    const vis = mm != null;
    this.line.visible = this.lineLbl.visible = vis; if (!vis) return;
    this.line.position.x = -L / 2 + mm * MM;
    this.line.material.color.set(state === 'bad' ? 0xb0412e : state === 'ok' ? 0x2f7a4f : 0x202722);
    this.lineLbl.element.textContent = mm + ' мм'; this.lineLbl.element.className = 'lbl ' + state;
    this.lineLbl.position.set(-L / 2 + mm * MM, .02, W / 2 + .1);
  }
  showTarget(mm) {
    const { L, W } = this.mk;
    this.ghost.visible = this.ghostLbl.visible = true;
    this.ghost.position.x = -L / 2 + mm * MM;
    this.ghostLbl.element.textContent = 'Дұрыс: ' + mm + ' мм'; this.ghostLbl.position.set(-L / 2 + mm * MM, .02, -W / 2 - .05);
  }

  /* ---- этап 4: обработка ---- */
  setupProcess(mat, d, mark, done) {
    this.clear();
    this.pr = { mat, d, mark, T: d.thickness * MM, L: d.length * MM, W: d.width * MM };
    const { T, L, W } = this.pr;
    const radius = done.includes('file') ? Math.min(3, d.thickness * .4) * MM : .0008;
    this.pieces = new THREE.Group(); this.root.add(this.pieces);
    if (done.includes('saw')) this.makePieces(radius);
    else { const b = this.board(mat, d.length, d.width, d.thickness, radius); b.position.y = T / 2; this.pieces.add(b); }
    if (!done.includes('saw')) {
      this.cutLine = new THREE.Mesh(new THREE.BoxGeometry(.007, .002, W), new THREE.MeshBasicMaterial({ color: 0x202722 }));
      this.cutLine.position.set(-L / 2 + mark * MM, T + .0012, 0); this.root.add(this.cutLine);
    }
    if (done.includes('sand')) this.sanded(1);
    this.clamp = makeClamp(); this.clamp.scale.setScalar(.55);
    this.clamp.position.set(L / 2 - .2, done.includes('clamp') ? T + .066 : 1.2, -W / 2 + .05);
    this.clamp.visible = done.includes('clamp'); this.root.add(this.clamp);
    this.saw = makeSaw(); this.saw.scale.setScalar(.6); this.saw.visible = false; this.root.add(this.saw);
    this.fileM = makeFile(); this.fileM.visible = false; this.root.add(this.fileM);
    this.block = makeSandBlock(); this.block.scale.setScalar(.8); this.block.visible = false; this.root.add(this.block);
    this.focus([.6, 1.7, 2.0], [0, 0, 0]);
  }
  makePieces(radius) {
    const { mat, d, mark, T, L } = this.pr;
    this.pieces.children.slice().forEach(c => { disposeTree(c); this.pieces.remove(c); });
    const s = this.board(mat, mark, d.width, d.thickness, radius); s.position.set(-L / 2 + mark * MM / 2 - .06, T / 2, 0);
    const b = this.board(mat, d.length - mark, d.width, d.thickness, radius); b.position.set(-L / 2 + mark * MM + (d.length - mark) * MM / 2 + .06, T / 2, 0);
    this.pieces.add(s, b);
  }
  sanded(k) {
    this.pieces.traverse(o => { if (o.isMesh) o.material.forEach(m => { m.roughness = lerp(.72, .5, k); m.color.setScalar(lerp(1, 1.12, k)); }); });
  }
  async doClamp() {
    const { T } = this.pr; this.clamp.visible = true; const y0 = this.clamp.position.y, y1 = T + .066;
    await this.tween(.8, k => { this.clamp.position.y = lerp(y0, y1, k); });
  }
  async doSaw() {
    const { L, W, T, mark } = this.pr; const x = -L / 2 + mark * MM;
    const s = this.saw; s.visible = true; s.rotation.set(0, Math.PI / 2, -.35);
    const z0 = W / 2 + .1;
    await this.tween(1.6, k => {
      const stroke = Math.sin(k * Math.PI * 10) * .18;
      s.position.set(x, T + .06 - k * .05, z0 - k * (W + .1) + stroke);
    });
    s.visible = false; if (this.cutLine) { this.root.remove(this.cutLine); disposeTree(this.cutLine); this.cutLine = null; }
    this.makePieces(.0008);
    const [a, b] = this.pieces.children; const ax = a.position.x, bx = b.position.x;
    a.position.x += .06; b.position.x -= .06;
    await this.tween(.6, k => { a.position.x = lerp(ax + .06, ax, k); b.position.x = lerp(bx - .06, bx, k); });
  }
  async doFile() {
    const { W, T, d } = this.pr; const f = this.fileM; f.visible = true;
    const [a, b] = this.pieces.children;
    await this.tween(1.3, k => {
      const target = k < .5 ? a : b;
      f.position.set(target.position.x + Math.sin(k * Math.PI * 8) * .15, T + .03, W / 2 + .02);
      f.rotation.set(0, 0, .5);
    });
    f.visible = false;
    this.makePieces(Math.min(3, d.thickness * .4) * MM);
  }
  async doSand() {
    const { T } = this.pr; const bl = this.block; bl.visible = true;
    const [a, b] = this.pieces.children;
    await this.tween(1.5, k => {
      const target = k < .5 ? a : b, ang = k * Math.PI * 12;
      bl.position.set(target.position.x + Math.cos(ang) * .1, T, Math.sin(ang) * .12);
      this.sanded(k);
    });
    bl.visible = false;
  }
  async shake(kind) {
    const g = this.pieces; const x0 = g.position.x, r0 = g.rotation.y;
    let warn = null;
    if (kind === 'saw') { // последствие: кривой пропил
      const { L, W, T, mark } = this.pr;
      warn = new THREE.Mesh(new THREE.BoxGeometry(.008, .003, W * .6), new THREE.MeshBasicMaterial({ color: 0xb0412e }));
      warn.position.set(-L / 2 + mark * MM + .05, T + .002, W * .15); warn.rotation.y = .35; this.root.add(warn);
    }
    await this.tween(.7, k => { g.position.x = x0 + Math.sin(k * 40) * .03 * (1 - k); g.rotation.y = r0 + Math.sin(k * 30) * .08 * (1 - k); });
    if (warn) setTimeout(() => { if (warn.parent) { this.root.remove(warn); disposeTree(warn); } }, 1400);
  }

  /* ---- этап 5: сборка ---- */
  showAssembly(mat, d, mark, angle, done, withFocus = true) {
    this.clear();
    const T = d.thickness * MM, W = d.width * MM, B = (d.length - mark) * MM, S = mark * MM;
    const rad = Math.min(3, d.thickness * .4) * MM;
    this.as = { T, W, B, S, mat, d };
    this.prod = new THREE.Group(); this.root.add(this.prod);
    const base = this.board(mat, d.length - mark, d.width, d.thickness, rad); base.position.y = T / 2; this.prod.add(base);
    base.material.forEach(m => { m.roughness = .5; m.color.setScalar(1.12); });
    this.xs = -B / 2 + B * .3;
    // тирек: pivot в нижней кромке, деталь тянется в -x
    this.pivot = new THREE.Group(); this.prod.add(this.pivot);
    const sup = this.board(mat, mark, d.width, d.thickness, rad); sup.position.set(-S / 2, T / 2, 0);
    sup.material.forEach(m => { m.roughness = .5; m.color.setScalar(1.12); });
    this.pivot.add(sup);
    this.glue = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, W * .9, 10), MAT.white()); this.glue.rotation.x = Math.PI / 2;
    this.glue.position.set(-.012, 0, 0); this.glue.visible = done.includes('glue'); this.pivot.add(this.glue);
    this.lip = shadowAll(new THREE.Mesh(new RoundedBoxGeometry(.08, .1, W, 2, .01), cloneSet(woodMaterials(mat, this.cache))));
    this.prod.add(this.lip);
    this.layoutAssembly(done, angle, false);
    this.phone = null;
    if (withFocus) this.focus([1.6, 1.5, 2.2], [0, .2, 0]);
  }
  supportPose(angle) { return { x: this.xs, y: this.as.T, rz: -angle * Math.PI / 180 }; }
  phoneX(angle) { const a = angle * Math.PI / 180; return this.xs + this.as.T / Math.sin(a); } // низ телефона касается тирека
  lipPose(angle) {
    const a = angle * Math.PI / 180, { T } = this.as;
    return { x: this.phoneX(angle) + Math.sin(a) * .08 + .045, y: T + .05 };
  }
  layoutAssembly(done, angle) {
    const { W, B } = this.as;
    if (done.includes('place')) { const p = this.supportPose(angle); this.pivot.position.set(p.x, p.y, 0); this.pivot.rotation.z = p.rz; }
    else { this.pivot.position.set(B / 2 + .2 + this.as.S, 0, W / 2 + .35); this.pivot.rotation.z = 0; }
    if (done.includes('lip')) { const p = this.lipPose(angle); this.lip.position.set(p.x, p.y, 0); }
    else this.lip.position.set(-.3, .05, W / 2 + .45);
    this.glue.visible = done.includes('glue');
  }
  async doGlue() { this.glue.visible = true; this.glue.scale.set(1, .01, 1); await this.tween(.7, k => this.glue.scale.set(1, Math.max(.01, k), 1)); }
  async doPlace(angle, glued) {
    const p = this.supportPose(angle), p0 = this.pivot.position.clone();
    await this.tween(1, k => { this.pivot.position.set(lerp(p0.x, p.x, k), lerp(p0.y, p.y, k) + Math.sin(k * Math.PI) * .25, lerp(p0.z, 0, k)); this.pivot.rotation.z = lerp(0, p.rz, k); });
    if (!glued) { // последствие: без клея тирек падает
      await this.tween(.7, k => { this.pivot.rotation.z = lerp(p.rz, -.02, k); });
      await new Promise(r => setTimeout(r, REDUCED ? 0 : 400));
      this.layoutAssembly([], angle);
    }
  }
  setSupportAngle(angle, done) { if (done.includes('place')) { this.pivot.rotation.z = -angle * Math.PI / 180; } if (done.includes('lip')) { const p = this.lipPose(angle); this.lip.position.x = p.x; } this.removePhone(); }
  async doLip(angle) {
    const p = this.lipPose(angle), p0 = this.lip.position.clone();
    await this.tween(.8, k => this.lip.position.set(lerp(p0.x, p.x, k), lerp(p0.y, p.y, k) + Math.sin(k * Math.PI) * .2, lerp(p0.z, 0, k)));
  }
  removePhone() { if (this.phone) { this.prod.remove(this.phone); disposeTree(this.phone); this.phone = null; } }
  async testPhone(angle, ok) {
    this.removePhone();
    const a = angle * Math.PI / 180, { T } = this.as;
    const ph = new THREE.Group(); const m = makePhone(); m.position.set(-.75, .04, 0); ph.add(m); // pivot у нижнего края
    this.phone = ph; this.prod.add(ph);
    const px = this.phoneX(angle), py = T + .002;
    ph.position.set(px, py + 1.2, 0); ph.rotation.z = -a;
    await this.tween(.8, k => { ph.position.y = py + (1 - k) * 1.2; });
    if (!ok) { // последствие: телефон падает вперёд через тосқауыл
      const x0 = ph.position.x;
      await this.tween(1.1, k => { ph.rotation.z = lerp(-a, -Math.PI + .08, k); ph.position.x = x0 + k * .22; ph.position.y = py + Math.sin(k * Math.PI) * .05; });
    }
  }
  showFinal(mat, d, mark, angle) {
    this.showAssembly(mat, d, mark, angle, ['glue', 'place', 'lip'], false);
    this.testPhone(angle, true);
    this.ctrl.autoRotate = !REDUCED; this.ctrl.autoRotateSpeed = .8;
    this.focus([1.7, 1.3, 2.1], [0, .3, 0]);
  }
  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.clear();
    disposeTree(this.scene); Object.values(this.cache).flat().forEach(m => m.map && m.map.dispose());
    this.env.dispose(); this.ctrl.dispose(); this.r.dispose();
    this.css.domElement.remove(); this.r.domElement.remove();
  }
}
