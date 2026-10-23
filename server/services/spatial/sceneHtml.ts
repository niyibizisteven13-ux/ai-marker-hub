import { sceneSummary, type Scene } from '../../../src/lib/scene/spec.js';

/**
 * A self-contained HTML viewer for one scene, for Telegram and downloads: opens in any phone or desktop
 * browser (three.js from a pinned CDN version), with rotate/zoom, labels, tap for details, exploded view and
 * guided views. The scene is embedded as JSON data, never as code.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function sceneHtml(scene: Scene): string {
  const data = JSON.stringify(scene).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(scene.title)} · Bwenge 3D</title>
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0c0f15;color:#e7e5e4;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
#app{position:fixed;inset:0}header{position:fixed;top:0;left:0;right:0;padding:10px 14px;background:linear-gradient(#0c0f15ee,#0c0f1500);z-index:2}
h1{margin:0;font-size:15px}p.sub{margin:2px 0 0;color:#a8a29e;font-size:12px}
#panel{position:fixed;right:10px;top:64px;width:260px;max-width:calc(100% - 20px);background:#000c;border-radius:12px;padding:12px;display:none;z-index:2}
#panel b{display:block;font-size:14px;margin-bottom:4px}#bar{position:fixed;left:0;right:0;bottom:0;padding:10px 12px;background:linear-gradient(#0c0f1500,#0c0f15f0);z-index:2}
#views{display:flex;gap:6px;overflow-x:auto;margin-bottom:6px}#views button,#tools button{flex:none;border:1px solid #ffffff22;background:#ffffff10;color:#eee;border-radius:999px;padding:6px 12px;font-size:12px}
#tools{display:flex;gap:8px;align-items:center}input[type=range]{flex:1;accent-color:#d97757}.lbl{font:600 11px system-ui;color:#fff;background:#0f1219bb;padding:2px 6px;border-radius:6px;white-space:nowrap}
#note{color:#a8a29e;font-size:12px;margin-top:6px}
</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"}}</script>
</head><body><div id="app"></div>
<header><h1>${esc(scene.title)}</h1><p class="sub">${esc(sceneSummary(scene))} Drag to rotate, pinch to zoom, tap a part.</p></header>
<div id="panel"></div>
<div id="bar"><div id="views"></div><div id="tools"><button id="labels">Labels</button><span style="font-size:12px">Explode</span><input id="explode" type="range" min="0" max="1.5" step="0.01" value="0"></div><div id="note">${esc(scene.description)}</div></div>
<script id="scene" type="application/json">${data}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
const S = JSON.parse(document.getElementById('scene').textContent);
const app = document.getElementById('app');
const r = new THREE.WebGLRenderer({ antialias: true }); r.setPixelRatio(Math.min(2, devicePixelRatio)); r.shadowMap.enabled = true; app.appendChild(r.domElement);
const L = new CSS2DRenderer(); L.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none'; app.appendChild(L.domElement);
const W = new THREE.Scene(); W.background = new THREE.Color(S.background);
const cam = new THREE.PerspectiveCamera(50, 1, 0.001, 1e6);
W.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.castShadow = true; W.add(sun);
const d2r = THREE.MathUtils.degToRad, V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function geo(p) { const s = p.size, rr = s.radius ?? 0.5; switch (p.shape) {
  case 'sphere': return new THREE.SphereGeometry(rr, 32, 20);
  case 'ellipsoid': { const g = new THREE.SphereGeometry(1, 32, 20); const q = s.radii || [1, .6, .4]; g.scale(q[0], q[1], q[2]); return g; }
  case 'cylinder': return new THREE.CylinderGeometry(s.radiusTop ?? rr, s.radiusBottom ?? rr, s.height ?? 1, 32);
  case 'cone': return new THREE.ConeGeometry(s.radiusBottom ?? rr, s.height ?? 1, 32);
  case 'torus': return new THREE.TorusGeometry(rr, s.tube ?? .15, 16, 48);
  case 'capsule': return new THREE.CapsuleGeometry(rr, s.height ?? 1, 8, 16);
  case 'plane': { const g = new THREE.PlaneGeometry(s.width ?? 1, s.depth ?? s.height ?? 1); g.rotateX(-Math.PI / 2); return g; }
  case 'tube': return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s.points.map((q) => new THREE.Vector3(q[0] || 0, q[1] || 0, q[2] || 0))), 64, s.tube ?? .1, 10);
  case 'extrude': { const g = new THREE.ExtrudeGeometry(new THREE.Shape(s.points.map((q) => new THREE.Vector2(q[0], q[1]))), { depth: s.depth ?? 1, bevelEnabled: false }); g.translate(0, 0, -(s.depth ?? 1) / 2); return g; }
  case 'lathe': return new THREE.LatheGeometry(s.points.map((q) => new THREE.Vector2(Math.abs(q[0]), q[1])), 40);
  default: return new THREE.BoxGeometry(s.width ?? 1, s.height ?? 1, s.depth ?? 1); } }
const root = new THREE.Group(), meshes = new Map(), base = new Map(), labels = [];
for (const p of S.parts) {
  const m = new THREE.Mesh(geo(p), new THREE.MeshStandardMaterial({ color: p.color, metalness: p.metalness, roughness: p.roughness, transparent: p.opacity < 1, opacity: p.opacity, side: p.shape === 'plane' || p.shape === 'lathe' ? THREE.DoubleSide : THREE.FrontSide }));
  m.position.copy(V(p.position)); m.rotation.set(d2r(p.rotation[0]), d2r(p.rotation[1]), d2r(p.rotation[2])); m.scale.copy(V(p.scale)); m.castShadow = m.receiveShadow = true; m.userData.id = p.id;
  if (p.label) { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = p.name; const o = new CSS2DObject(el); m.geometry.computeBoundingBox(); o.position.y = (m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y) / 2; m.add(o); labels.push(o); }
  root.add(m); meshes.set(p.id, m); base.set(p.id, m.position.clone());
}
const links = S.connections.map((c) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 1, 12), new THREE.MeshStandardMaterial({ color: c.color })); root.add(m); return { m, c }; });
W.add(root);
const box = new THREE.Box3().setFromObject(root), C = box.getCenter(new THREE.Vector3()), R = Math.max(.001, box.getSize(new THREE.Vector3()).length() / 2);
if (S.ground) { const g = new THREE.Mesh(new THREE.CircleGeometry(R * 6, 48), new THREE.MeshStandardMaterial({ color: 0x2a2f3a })); g.rotation.x = -Math.PI / 2; g.position.y = Math.min(0, box.min.y); g.receiveShadow = true; W.add(g); }
sun.position.set(C.x + R * 3, C.y + R * 6, C.z + R * 4);
cam.position.copy(S.camera ? V(S.camera.position) : C.clone().add(new THREE.Vector3(R * 1.6, R * 1.1, R * 2.2))); cam.near = R / 1000; cam.far = R * 1000; cam.updateProjectionMatrix();
const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.target.copy(S.camera ? V(S.camera.target) : C);
let ex = 0; document.getElementById('explode').oninput = (e) => { ex = +e.target.value; };
let showL = S.parts.length <= 40; const setL = () => labels.forEach((o) => o.visible = showL); setL(); document.getElementById('labels').onclick = () => { showL = !showL; setL(); };
const panel = document.getElementById('panel'), byId = new Map(S.parts.map((p) => [p.id, p]));
const t = (s) => { const d = document.createElement('div'); d.textContent = s; return d; };
const ray = new THREE.Raycaster(); let down = null;
r.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
r.domElement.addEventListener('pointerup', (e) => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), cam);
  const h = ray.intersectObjects([...meshes.values()])[0]; const p = h && byId.get(h.object.userData.id);
  panel.replaceChildren(); if (!p) { panel.style.display = 'none'; return; }
  const b = document.createElement('b'); b.textContent = p.name; panel.append(b); if (p.description) panel.append(t(p.description));
  for (const [k, v] of Object.entries(p.properties || {})) panel.append(t(k + ': ' + v)); panel.style.display = 'block'; });
const views = document.getElementById('views'), note = document.getElementById('note');
S.views.forEach((v, i) => { const b = document.createElement('button'); b.textContent = (i + 1) + '. ' + v.name; b.onclick = () => { cam.position.copy(V(v.camera.position)); ctl.target.copy(V(v.camera.target)); if (v.note) note.textContent = v.note; }; views.append(b); });
const size = () => { r.setSize(innerWidth, innerHeight); L.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }; addEventListener('resize', size); size();
const tmp = new THREE.Vector3();
r.setAnimationLoop(() => {
  for (const p of S.parts) { const m = meshes.get(p.id), b = base.get(p.id); const dir = p.explode ? V(p.explode) : b.clone().sub(C); if (!p.explode) { if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0); dir.normalize().multiplyScalar(R * .8); } m.position.copy(b).addScaledVector(dir, ex); }
  for (const { m, c } of links) { const a = meshes.get(c.from).position, b = meshes.get(c.to).position; const d = tmp.copy(b).sub(a); const len = d.length(); m.position.copy(a).addScaledVector(d, .5); m.scale.set(1, len || 1e-6, 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }
  ctl.update(); r.render(W, cam); L.render(W, cam);
});
</script></body></html>`;
}
