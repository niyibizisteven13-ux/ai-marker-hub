import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import {
  Box, Camera, Download, Eye, EyeOff, Footprints, Glasses, HelpCircle, Layers, Maximize2, Minimize2, Pause, Play, RotateCcw, Scissors, Sun, Tag, Thermometer, Weight, X, Zap,
} from 'lucide-react';
import { billOfMaterials, MATERIALS, sunDirection, type Scene, type ScenePart, type Vec3 } from '../../lib/scene/spec';

/**
 * Interactive 3D viewer for Bwenge scenes. Everything runs in the browser with three.js; the scene JSON is
 * data only. Tools: orbit, click for details, isolate / hide, exploded view, section cut, stress map, gravity
 * demo, sun and seasons, first-person walkthrough, guided views, "click the part" quiz, VR (WebXR), glTF and
 * PNG export, and a bill of materials with editable prices.
 */

type Tool = 'none' | 'explode' | 'section' | 'stress' | 'physics' | 'sun' | 'quiz' | 'bom';
const deg = THREE.MathUtils.degToRad;
const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

function geometryFor(p: ScenePart): THREE.BufferGeometry {
  const s = p.size;
  const r = s.radius ?? 0.5;
  switch (p.shape) {
    case 'box': return new THREE.BoxGeometry(s.width ?? 1, s.height ?? 1, s.depth ?? 1);
    case 'sphere': return new THREE.SphereGeometry(r, 40, 24);
    case 'ellipsoid': { const g = new THREE.SphereGeometry(1, 40, 24); const q = s.radii ?? [1, 0.6, 0.4]; g.scale(q[0], q[1], q[2]); return g; }
    case 'cylinder': return new THREE.CylinderGeometry(s.radiusTop ?? r, s.radiusBottom ?? r, s.height ?? 1, 40);
    case 'cone': return new THREE.ConeGeometry(s.radiusBottom ?? r, s.height ?? 1, 40);
    case 'torus': return new THREE.TorusGeometry(r, s.tube ?? 0.15, 20, 64);
    case 'capsule': return new THREE.CapsuleGeometry(r, s.height ?? 1, 8, 24);
    case 'plane': { const g = new THREE.PlaneGeometry(s.width ?? 1, s.depth ?? s.height ?? 1); g.rotateX(-Math.PI / 2); return g; }
    case 'tube': {
      const pts = (s.points ?? []).map((q) => new THREE.Vector3(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(16, pts.length * 8), s.tube ?? 0.1, 12, false);
    }
    case 'extrude': {
      const shape = new THREE.Shape((s.points ?? []).map((q) => new THREE.Vector2(q[0] ?? 0, q[1] ?? 0)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: s.depth ?? 1, bevelEnabled: false });
      g.translate(0, 0, -(s.depth ?? 1) / 2);
      return g;
    }
    case 'lathe': return new THREE.LatheGeometry((s.points ?? []).map((q) => new THREE.Vector2(Math.abs(q[0] ?? 0), q[1] ?? 0)), 48);
  }
  return new THREE.BoxGeometry(1, 1, 1);
}

/** Blue → green → yellow → red. */
function stressColor(t: number) {
  const c = new THREE.Color();
  c.setHSL((1 - Math.min(1, Math.max(0, t))) * 0.66, 0.85, 0.5);
  return c;
}

interface Built { root: THREE.Group; meshes: Map<string, THREE.Mesh>; base: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }>; center: THREE.Vector3; radius: number; labels: CSS2DObject[]; links: Array<{ mesh: THREE.Mesh; from: string; to: string }> }

export default function SceneViewer({ scene, fileName, fill }: { scene: Scene; fileName?: string; fill?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; labelRenderer: CSS2DRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls; walk: PointerLockControls;
    world: THREE.Scene; sunLight: THREE.DirectionalLight; hemi: THREE.HemisphereLight; built: Built; clip: THREE.Plane; ground: THREE.Mesh | null;
  } | null>(null);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<Set<string> | null>(null);
  const [tool, setTool] = useState<Tool>('none');
  const [labels, setLabels] = useState(scene.parts.length <= 40);
  const [playing, setPlaying] = useState(scene.parts.some((p) => p.animation));
  const [explode, setExplode] = useState(0);
  const [section, setSection] = useState<{ axis: 'x' | 'y' | 'z'; t: number }>({ axis: 'x', t: 1 });
  const [month, setMonth] = useState(scene.sun.month);
  const [hour, setHour] = useState(scene.sun.hour);
  const [gravity, setGravity] = useState(scene.gravity);
  const [sim, setSim] = useState<{ running: boolean; t: number }>({ running: false, t: 0 });
  const [walking, setWalking] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizResult, setQuizResult] = useState<null | { ok: boolean; text: string }>(null);
  const [view, setView] = useState<number | null>(null);
  const [vr, setVr] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [webgl, setWebgl] = useState(true);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const state = useRef({ playing, explode, gravity, sim, walking, quizIndex, isolated, hidden, selected });
  state.current = { playing, explode, gravity, sim, walking, quizIndex, isolated, hidden, selected };
  const velocities = useRef(new Map<string, THREE.Vector3>());
  const keys = useRef(new Set<string>());

  const byId = useMemo(() => new Map(scene.parts.map((p) => [p.id, p])), [scene]);
  const hasStress = scene.parts.some((p) => p.stress !== undefined);
  const dynamic = useMemo(() => scene.parts.filter((p) => !p.fixed && (p.velocity || p.mass !== undefined)).map((p) => p.id), [scene]);
  const bom = useMemo(() => billOfMaterials(scene, prices), [scene, prices]);

  // ── Build once per scene ───────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasHost.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch { setWebgl(false); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.xr.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.inset = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    el.appendChild(labelRenderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color(scene.background);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 1e6);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
    world.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    world.add(sunLight, sunLight.target);
    const clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e9);

    // Parts
    const root = new THREE.Group();
    const meshes = new Map<string, THREE.Mesh>();
    const base = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }>();
    const labelObjs: CSS2DObject[] = [];
    for (const p of scene.parts) {
      const mat = new THREE.MeshStandardMaterial({
        color: p.color, metalness: p.metalness, roughness: p.roughness, transparent: p.opacity < 1, opacity: p.opacity, wireframe: !!p.wireframe,
        side: p.shape === 'plane' || p.shape === 'lathe' ? THREE.DoubleSide : THREE.FrontSide, clippingPlanes: [clip], clipShadows: true,
      });
      mat.userData.baseColor = new THREE.Color(p.color);
      mat.userData.baseOpacity = p.opacity;
      const mesh = new THREE.Mesh(geometryFor(p), mat);
      mesh.position.copy(v3(p.position));
      mesh.rotation.set(deg(p.rotation[0]), deg(p.rotation[1]), deg(p.rotation[2]));
      mesh.scale.copy(v3(p.scale));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = p.id;
      root.add(mesh);
      meshes.set(p.id, mesh);
      base.set(p.id, { pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scale: mesh.scale.clone() });
      if (p.label) {
        const div = document.createElement('div');
        div.textContent = p.name;
        div.className = 'bw3d-label';
        const lab = new CSS2DObject(div);
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        lab.position.set(0, (bb.max.y - bb.min.y) / 2 + 0.02, 0);
        mesh.add(lab);
        mesh.userData.label = lab;
        labelObjs.push(lab);
      }
    }
    // Connections (bonds, beams, cables)
    const links: Built['links'] = [];
    for (const c of scene.connections) {
      const mat = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.5, metalness: 0.2, clippingPlanes: [clip] });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 1, 16), mat);
      mesh.castShadow = true;
      mesh.userData.link = true;
      root.add(mesh);
      links.push({ mesh, from: c.from, to: c.to });
    }
    for (const a of scene.annotations) {
      const div = document.createElement('div');
      div.textContent = a.text;
      div.className = 'bw3d-note';
      const lab = new CSS2DObject(div);
      lab.position.copy(v3(a.position));
      root.add(lab);
      labelObjs.push(lab);
    }
    world.add(root);

    const box = new THREE.Box3().setFromObject(root);
    world.fog = new THREE.Fog(scene.background, box.getSize(new THREE.Vector3()).length() * 2.5, box.getSize(new THREE.Vector3()).length() * 9);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
    let ground: THREE.Mesh | null = null;
    if (scene.ground) {
      ground = new THREE.Mesh(new THREE.CircleGeometry(radius * 40, 64), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = Math.min(0, box.min.y) - radius * 0.001;
      ground.receiveShadow = true;
      world.add(ground);
      const grid = new THREE.GridHelper(radius * 8, 32, 0x3a4150, 0x2c323e);
      grid.position.y = ground.position.y + radius * 0.0005;
      world.add(grid);
    }
    sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -radius * 3;
    sunLight.shadow.camera.right = sunLight.shadow.camera.top = radius * 3;
    sunLight.shadow.camera.far = radius * 40;
    sunLight.target.position.copy(center);

    if (scene.camera) { camera.position.copy(v3(scene.camera.position)); }
    else camera.position.copy(center).add(new THREE.Vector3(0.55, 0.42, 0.72).normalize().multiplyScalar(radius * 2.1 * Math.max(1, (el.clientHeight / Math.max(1, el.clientWidth)) ** 0.8)));
    camera.near = radius / 1000;
    camera.far = radius * 1000;
    camera.updateProjectionMatrix();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(scene.camera ? v3(scene.camera.target) : center);
    const walk = new PointerLockControls(camera, renderer.domElement);
    walk.addEventListener('unlock', () => setWalking(false));

    const built: Built = { root, meshes, base, center, radius, labels: labelObjs, links };
    three.current = { renderer, labelRenderer, camera, controls, walk, world, sunLight, hemi, built, clip, ground };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Click to select (ignored when the pointer moved: that was a rotation).
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || state.current.walking) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hits = ray.intersectObjects([...meshes.values()].filter((m) => m.visible), false).filter((h) => {
        const mm = h.object as THREE.Mesh;
        return (mm.material as THREE.MeshStandardMaterial).opacity > 0.2 && clip.distanceToPoint(h.point) >= 0;
      });
      const id = hits[0]?.object.userData.partId as string | undefined;
      setSelected(id ?? null);
      if (id && toolRef.current === 'quiz') {
        const q = scene.quiz[state.current.quizIndex];
        if (q) setQuizResult(id === q.answerPartId ? { ok: true, text: q.explanation || 'Correct.' } : { ok: false, text: `That is the ${byId.get(id)?.name ?? 'part'}. Try again.` });
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const onKey = (e: KeyboardEvent) => { if (e.type === 'keydown') keys.current.add(e.code); else keys.current.delete(e.code); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    // Animation loop (setAnimationLoop also drives VR).
    const clock = new THREE.Clock();
    let t = 0;
    const tmp = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.05, clock.getDelta());
      const st = state.current;
      if (st.playing) t += dt;
      // Exploded view and animations relative to the base pose.
      for (const p of scene.parts) {
        const m = meshes.get(p.id)!;
        const b = base.get(p.id)!;
        if (st.sim.running && dynamic.includes(p.id)) continue;
        const dir = p.explode ? v3(p.explode) : b.pos.clone().sub(center);
        if (!p.explode && dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
        if (!p.explode) dir.normalize().multiplyScalar(radius * 0.8);
        m.position.copy(b.pos).addScaledVector(dir, st.explode);
        m.quaternion.copy(b.quat);
        m.scale.copy(b.scale);
        const a = p.animation;
        if (a && t > 0) {
          const axis = v3(a.axis).normalize();
          if (a.type === 'rotate') m.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, t * a.speed));
          else if (a.type === 'oscillate') m.position.addScaledVector(axis, Math.sin(t * a.speed * 2) * a.amplitude);
          else if (a.type === 'pulse') m.scale.multiplyScalar(1 + Math.sin(t * a.speed * 2) * Math.min(0.5, a.amplitude));
          else if (a.type === 'orbit') { const c = a.center ? v3(a.center) : new THREE.Vector3(); m.position.sub(c).applyAxisAngle(axis, t * a.speed).add(c); }
        }
      }
      // Gravity demo: parts with mass or velocity fall, bounce on the ground and slide to rest.
      if (st.sim.running) {
        const g = st.gravity / scene.metresPerUnit;
        const floor = ground ? ground.position.y : -Infinity;
        // Static surfaces: the ground and every part that does not move (tables, shelves, floors).
        const solids = scene.parts.filter((p) => !dynamic.includes(p.id)).map((p) => new THREE.Box3().setFromObject(meshes.get(p.id)!));
        for (const id of dynamic) {
          const m = meshes.get(id)!;
          const v = velocities.current.get(id)!;
          const prevBottom = new THREE.Box3().setFromObject(m).min.y;
          v.y -= g * dt;
          m.position.addScaledVector(v, dt);
          const box = new THREE.Box3().setFromObject(m);
          const half = (box.max.y - box.min.y) / 2;
          // The highest surface under the object that it has reached this step.
          let top = floor;
          for (const sb of solids) if (box.max.x > sb.min.x && box.min.x < sb.max.x && box.max.z > sb.min.z && box.min.z < sb.max.z && prevBottom >= sb.max.y - 1e-6 && box.min.y < sb.max.y) top = Math.max(top, sb.max.y);
          if (box.min.y < top) { m.position.y += top - box.min.y; if (v.y < 0) v.y = -v.y * 0.45; v.x *= 0.92; v.z *= 0.92; if (Math.abs(v.y) < g * dt * 2) v.y = 0; }
          void half;
        }
        setSim((s) => (s.running ? { running: true, t: s.t + dt } : s));
      }
      // Links follow their parts.
      for (const l of links) {
        const a = meshes.get(l.from)!.position, b = meshes.get(l.to)!.position;
        const d = tmp.copy(b).sub(a);
        const len = d.length();
        l.mesh.visible = len > 1e-9 && meshes.get(l.from)!.visible && meshes.get(l.to)!.visible;
        l.mesh.position.copy(a).addScaledVector(d, 0.5);
        l.mesh.scale.set(1, len, 1);
        l.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      }
      // Walkthrough.
      if (st.walking && walk.isLocked) {
        const speed = (radius / 6) * dt * (keys.current.has('ShiftLeft') ? 2.5 : 1);
        if (keys.current.has('KeyW') || keys.current.has('ArrowUp')) walk.moveForward(speed);
        if (keys.current.has('KeyS') || keys.current.has('ArrowDown')) walk.moveForward(-speed);
        if (keys.current.has('KeyA') || keys.current.has('ArrowLeft')) walk.moveRight(-speed);
        if (keys.current.has('KeyD') || keys.current.has('ArrowRight')) walk.moveRight(speed);
      } else controls.update();
      renderer.render(world, camera);
      labelRenderer.render(world, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      controls.dispose();
      walk.dispose();
      world.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
      el.innerHTML = '';
      three.current = null;
    };
  }, [scene, byId, dynamic]);

  // ── Apply UI state to the 3D objects ──────────────────────────────────────
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const p of scene.parts) {
      const m = t.built.meshes.get(p.id)!;
      const mat = m.material as THREE.MeshStandardMaterial;
      m.visible = !hidden.has(p.id);
      const dim = isolated && !isolated.has(p.id);
      mat.color.copy(tool === 'stress' ? (p.stress !== undefined ? stressColor(p.stress) : new THREE.Color(0x5b6070)) : mat.userData.baseColor);
      mat.opacity = dim ? 0.07 : mat.userData.baseOpacity;
      mat.transparent = dim || mat.userData.baseOpacity < 1;
      mat.depthWrite = !dim;
      mat.emissive.set(selected === p.id ? 0x335577 : 0x000000);
      mat.needsUpdate = true;
    }
    for (const l of t.built.labels) l.visible = labels;
    // Labels follow their part: none for hidden, dimmed or cut-away parts.
    const wp = new THREE.Vector3();
    for (const p of scene.parts) {
      const m = t.built.meshes.get(p.id)!;
      const lab = m.userData.label as CSS2DObject | undefined;
      if (lab) lab.visible = labels && m.visible && !(isolated && !isolated.has(p.id)) && t.clip.distanceToPoint(m.getWorldPosition(wp)) >= 0;
    }
  }, [scene, hidden, isolated, selected, tool, labels, section]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const box = new THREE.Box3().setFromObject(t.built.root);
    if (tool !== 'section') { t.clip.constant = 1e9; return; }
    const n = section.axis === 'x' ? new THREE.Vector3(-1, 0, 0) : section.axis === 'y' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
    const min = box.min[section.axis], max = box.max[section.axis];
    t.clip.normal.copy(n);
    t.clip.constant = min + (max - min) * section.t;
    const wp = new THREE.Vector3();
    for (const m of t.built.meshes.values()) { const lab = m.userData.label as CSS2DObject | undefined; if (lab && lab.visible) lab.visible = t.clip.distanceToPoint(m.getWorldPosition(wp)) >= 0; }
  }, [tool, section]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const on = tool === 'sun' || scene.sun.enabled;
    const { dir, elevation } = sunDirection(scene.sun.latitude, month, hour);
    const d = t.built.radius * 8;
    if (on) {
      t.sunLight.position.set(t.built.center.x + dir[0] * d, t.built.center.y + Math.max(0.02, dir[1]) * d, t.built.center.z + dir[2] * d);
      const day = Math.max(0, Math.min(1, elevation / 25));
      t.sunLight.intensity = 0.15 + 2.2 * day;
      t.sunLight.color.setHSL(0.09, 0.6, 0.55 + 0.4 * day);
      t.hemi.intensity = 0.25 + 0.9 * day;
      (t.world.background as THREE.Color).set(elevation > 0 ? new THREE.Color().lerpColors(new THREE.Color('#2b2f4a'), new THREE.Color('#8fb7e0'), day) : new THREE.Color('#0b0d18'));
      t.world.fog?.color.copy(t.world.background as THREE.Color);
    } else {
      t.sunLight.position.set(t.built.center.x + d * 0.4, t.built.center.y + d * 0.8, t.built.center.z + d * 0.5);
      t.sunLight.intensity = 1.6;
      t.hemi.intensity = 1.1;
      (t.world.background as THREE.Color).set(scene.background);
      t.world.fog?.color.set(scene.background);
    }
  }, [tool, month, hour, scene]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (walking) {
      const eye = 1.6 / scene.metresPerUnit;
      t.camera.position.set(t.built.center.x, (t.ground?.position.y ?? 0) + eye, t.built.center.z + t.built.radius * 1.2);
      t.camera.lookAt(t.built.center.x, (t.ground?.position.y ?? 0) + eye, t.built.center.z);
      t.walk.lock();
    } else if (t.walk.isLocked) t.walk.unlock();
  }, [walking, scene]);

  const startSim = () => {
    const t = three.current;
    if (!t || !dynamic.length) return;
    velocities.current = new Map(dynamic.map((id) => [id, v3(byId.get(id)!.velocity ?? [0, 0, 0])]));
    setExplode(0);
    setSim({ running: true, t: 0 });
  };
  const stopSim = () => setSim({ running: false, t: 0 });

  const goView = useCallback((i: number) => {
    const t = three.current;
    const v = scene.views[i];
    if (!t || !v) return;
    setView(i);
    setIsolated(v.show?.length ? new Set(v.show) : null);
    if (v.section) { setTool('section'); const box = new THREE.Box3().setFromObject(t.built.root); const min = box.min[v.section.axis], max = box.max[v.section.axis]; setSection({ axis: v.section.axis, t: Math.min(1, Math.max(0, (v.section.offset - min) / (max - min || 1))) }); }
    const from = t.camera.position.clone(), to = v3(v.camera.position), tf = t.controls.target.clone(), tt = v3(v.camera.target);
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 800), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      t.camera.position.lerpVectors(from, to, e);
      t.controls.target.lerpVectors(tf, tt, e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [scene]);

  const reset = () => {
    const t = three.current;
    setHidden(new Set()); setIsolated(null); setSelected(null); setExplode(0); setTool('none'); setView(null); stopSim();
    if (t) { t.camera.position.copy(t.built.center).add(new THREE.Vector3(0.55, 0.42, 0.72).normalize().multiplyScalar(t.built.radius * 2.1)); t.controls.target.copy(t.built.center); }
  };

  const download = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const stem = (fileName || scene.title).replace(/\.scene\.json$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'model';
  const exportGlb = () => {
    const t = three.current;
    if (!t) return;
    new GLTFExporter().parse(t.built.root, (res) => download(new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' }), `${stem}.glb`), () => undefined, { binary: true });
  };
  const exportPng = () => three.current?.renderer.domElement.toBlob((b) => b && download(b, `${stem}.png`));

  useEffect(() => {
    let live = true;
    (navigator as any).xr?.isSessionSupported?.('immersive-vr').then((ok: boolean) => { if (live) setVr(!!ok); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const enterVr = async () => {
    const t = three.current;
    const xr = (navigator as any).xr;
    if (!t || !xr) return;
    const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await t.renderer.xr.setSession(session);
  };

  const sel = selected ? byId.get(selected) : null;
  const q = scene.quiz[quizIndex];
  const btn = (on: boolean) => `grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${on ? 'bg-[#D97757] text-white' : 'text-stone-200 hover:bg-white/10'}`;
  const ToolBtn = ({ id, label, children, disabled }: { id: Tool; label: string; children: React.ReactNode; disabled?: boolean }) => (
    <button type="button" title={label} aria-label={label} aria-pressed={tool === id} disabled={disabled} onClick={() => setTool((x) => (x === id ? 'none' : id))} className={`${btn(tool === id)} disabled:opacity-30`}>{children}</button>
  );
  const sunInfo = sunDirection(scene.sun.latitude, month, hour);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (!webgl) return <div className="rounded-xl border border-stone-800 bg-stone-900 p-4 text-sm text-stone-300">This device cannot display 3D graphics (WebGL is unavailable). Download the model and open it on another device.</div>;

  return (
    <div ref={host} className={full ? 'fixed inset-0 z-[110] flex flex-col bg-[#0c0f15]' : `relative flex flex-col overflow-hidden rounded-2xl border border-stone-800 bg-[#0c0f15] ${fill ? 'h-full' : ''}`}>
      <style>{`.bw3d-label{font:600 11px/1.2 Inter,system-ui,sans-serif;color:#fff;background:rgba(15,18,25,.72);padding:2px 6px;border-radius:6px;white-space:nowrap;transform:translateY(-10px)}.bw3d-note{font:500 11.5px/1.3 Inter,system-ui,sans-serif;color:#1b1b1b;background:#ffd166;padding:3px 7px;border-radius:7px;max-width:220px}`}</style>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Box className="h-4 w-4 shrink-0 text-[#D97757]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{scene.title}</div>
          <div className="truncate text-[11px] text-stone-400">{scene.parts.length} parts · drag to rotate, scroll or pinch to zoom, click a part</div>
        </div>
        <button type="button" title={full ? 'Exit full screen' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)} className={btn(false)}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
      </div>

      <div className={`relative ${full || fill ? 'min-h-[320px] flex-1' : 'h-[420px] sm:h-[480px]'}`}>
        <div ref={canvasHost} className="absolute inset-0 touch-none" />

        {/* Tools */}
        <div className="absolute left-2 right-2 top-2 flex gap-1 overflow-x-auto rounded-xl bg-black/55 p-1 backdrop-blur [scrollbar-width:none] sm:right-auto sm:max-h-[calc(100%-1rem)] sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden">
          <button type="button" title="Labels" aria-label="Labels" aria-pressed={labels} onClick={() => setLabels((x) => !x)} className={btn(labels)}><Tag className="h-4 w-4" /></button>
          <ToolBtn id="explode" label="Exploded view"><Layers className="h-4 w-4" /></ToolBtn>
          <ToolBtn id="section" label="Section cut"><Scissors className="h-4 w-4" /></ToolBtn>
          {hasStress && <ToolBtn id="stress" label="Stress map"><Thermometer className="h-4 w-4" /></ToolBtn>}
          {dynamic.length > 0 && <ToolBtn id="physics" label="Gravity demo"><Zap className="h-4 w-4" /></ToolBtn>}
          <ToolBtn id="sun" label="Sun and seasons"><Sun className="h-4 w-4" /></ToolBtn>
          {scene.quiz.length > 0 && <ToolBtn id="quiz" label="Quiz"><HelpCircle className="h-4 w-4" /></ToolBtn>}
          {bom.lines.length > 0 && <ToolBtn id="bom" label="Materials and cost"><Weight className="h-4 w-4" /></ToolBtn>}
          {scene.parts.some((p) => p.animation) && <button type="button" title={playing ? 'Pause animation' : 'Play animation'} aria-label={playing ? 'Pause animation' : 'Play animation'} onClick={() => setPlaying((x) => !x)} className={btn(false)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>}
          {scene.walkthrough && <button type="button" title="Walk through (W A S D, Esc to stop)" aria-label="Walk through" onClick={() => setWalking(true)} className={btn(walking)}><Footprints className="h-4 w-4" /></button>}
          {vr && <button type="button" title="View in VR" aria-label="View in VR" onClick={() => void enterVr()} className={btn(false)}><Glasses className="h-4 w-4" /></button>}
          <button type="button" title="Reset view" aria-label="Reset view" onClick={reset} className={btn(false)}><RotateCcw className="h-4 w-4" /></button>
          <button type="button" title="Save picture (PNG)" aria-label="Save picture" onClick={exportPng} className={btn(false)}><Camera className="h-4 w-4" /></button>
          <button type="button" title="Download 3D file (glTF, for VR, Blender, 3D printing tools)" aria-label="Download glTF" onClick={exportGlb} className={btn(false)}><Download className="h-4 w-4" /></button>
        </div>

        {/* Tool panel */}
        {tool !== 'none' && tool !== 'stress' && (
          <div className="absolute bottom-2 left-2 right-2 max-h-[55%] overflow-y-auto rounded-xl bg-black/70 p-3 text-xs text-stone-200 backdrop-blur sm:left-14 sm:right-auto sm:w-80">
            {tool === 'explode' && (<label className="block">Exploded view <input type="range" min={0} max={1.5} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="mt-1 w-full accent-[#D97757]" /></label>)}
            {tool === 'section' && (<div className="space-y-2">
              <div className="flex gap-1">{(['x', 'y', 'z'] as const).map((a) => <button key={a} type="button" onClick={() => setSection((s) => ({ ...s, axis: a }))} className={`rounded-md px-2.5 py-1 font-semibold ${section.axis === a ? 'bg-[#D97757] text-white' : 'bg-white/10'}`}>{a.toUpperCase()}</button>)}</div>
              <label className="block">Cut position <input type="range" min={0} max={1} step={0.005} value={section.t} onChange={(e) => setSection((s) => ({ ...s, t: Number(e.target.value) }))} className="mt-1 w-full accent-[#D97757]" /></label>
            </div>)}
            {tool === 'physics' && (<div className="space-y-2">
              <div className="flex flex-wrap gap-1">{[['Earth', 9.81], ['Moon', 1.62], ['Mars', 3.71], ['Jupiter', 24.79]].map(([n, g]) => <button key={n as string} type="button" onClick={() => setGravity(g as number)} className={`rounded-md px-2 py-1 ${gravity === g ? 'bg-[#D97757] text-white' : 'bg-white/10'}`}>{n}</button>)}</div>
              <label className="block">Gravity {gravity.toFixed(2)} m/s² <input type="range" min={0} max={30} step={0.01} value={gravity} onChange={(e) => setGravity(Number(e.target.value))} className="mt-1 w-full accent-[#D97757]" /></label>
              <div className="flex items-center gap-2">
                {sim.running ? <button type="button" onClick={stopSim} className="rounded-md bg-white/10 px-3 py-1.5 font-semibold">Reset</button> : <button type="button" onClick={startSim} className="rounded-md bg-[#D97757] px-3 py-1.5 font-semibold text-white">Drop</button>}
                <span className="tabular-nums text-stone-400">t = {sim.t.toFixed(2)} s</span>
              </div>
              <p className="text-[10.5px] text-stone-400">Simple simulation: constant gravity, bounce on the ground, no air resistance.</p>
            </div>)}
            {tool === 'sun' && (<div className="space-y-2">
              <label className="block">Month: {MONTHS[month - 1]} <input type="range" min={1} max={12} step={1} value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 w-full accent-[#D97757]" /></label>
              <label className="block">Time: {String(Math.floor(hour)).padStart(2, '0')}:{String(Math.round((hour % 1) * 60)).padStart(2, '0')} <input type="range" min={5} max={19} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-1 w-full accent-[#D97757]" /></label>
              <p className="text-stone-400">Sun {sunInfo.elevation > 0 ? `${sunInfo.elevation.toFixed(0)}° above the horizon` : 'below the horizon'} · latitude {scene.sun.latitude.toFixed(1)}°</p>
            </div>)}
            {tool === 'quiz' && q && (<div className="space-y-2">
              <p className="font-semibold text-white">Question {quizIndex + 1} of {scene.quiz.length}</p>
              <p>{q.question}</p>
              {quizResult && <p className={quizResult.ok ? 'text-emerald-300' : 'text-amber-300'}>{quizResult.text}</p>}
              {quizResult?.ok && quizIndex < scene.quiz.length - 1 && <button type="button" onClick={() => { setQuizIndex((i) => i + 1); setQuizResult(null); }} className="rounded-md bg-[#D97757] px-3 py-1.5 font-semibold text-white">Next question</button>}
            </div>)}
            {tool === 'bom' && (<div className="space-y-2">
              <p className="font-semibold text-white">Materials and cost</p>
              <table className="w-full text-[11px]">
                <thead className="text-stone-400"><tr><th className="text-left font-medium">Material</th><th className="text-right font-medium">Mass</th><th className="text-right font-medium">RWF/kg</th><th className="text-right font-medium">Cost</th></tr></thead>
                <tbody>{bom.byMaterial.map((m) => (
                  <tr key={m.material}><td>{m.label}</td><td className="text-right tabular-nums">{Math.round(m.massKg).toLocaleString('en-US')} kg</td>
                    <td className="text-right"><input type="number" min={0} value={prices[m.material] ?? MATERIALS[m.material].rwfPerKg} onChange={(e) => setPrices((p) => ({ ...p, [m.material]: Math.max(0, Number(e.target.value) || 0) }))} className="w-16 rounded bg-white/10 px-1 text-right" /></td>
                    <td className="text-right tabular-nums">{Math.round(m.costRwf).toLocaleString('en-US')}</td></tr>
                ))}</tbody>
                <tfoot className="font-semibold text-white"><tr><td>Total</td><td className="text-right tabular-nums">{Math.round(bom.totalMassKg).toLocaleString('en-US')} kg</td><td /><td className="text-right tabular-nums">{Math.round(bom.totalCostRwf).toLocaleString('en-US')} RWF</td></tr></tfoot>
              </table>
              <p className="text-[10.5px] text-stone-400">{bom.note}</p>
            </div>)}
          </div>
        )}
        {tool === 'stress' && (
          <div className="absolute bottom-2 left-2 rounded-xl bg-black/70 px-3 py-2 text-[11px] text-stone-200 backdrop-blur sm:left-14">
            <div className="mb-1 font-semibold">Relative load</div>
            <div className="h-2 w-40 rounded-full" style={{ background: 'linear-gradient(90deg,hsl(238,85%,50%),hsl(120,85%,50%),hsl(60,85%,50%),hsl(0,85%,50%))' }} />
            <div className="mt-0.5 flex justify-between text-stone-400"><span>low</span><span>high</span></div>
          </div>
        )}

        {/* Selected part */}
        {sel && (
          <div className="absolute right-2 top-14 w-64 max-w-[calc(100%-1rem)] rounded-xl bg-black/75 p-3 text-xs text-stone-200 backdrop-blur sm:top-2 sm:max-w-[calc(100%-4.5rem)]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{sel.name}</div>{sel.group && <div className="text-[10.5px] uppercase tracking-wide text-stone-400">{sel.group}</div>}</div>
              <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="rounded p-0.5 hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
            </div>
            {sel.description && <p className="mt-1.5 leading-relaxed">{sel.description}</p>}
            {(Object.keys(sel.properties).length > 0 || sel.material) && (
              <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px]">
                {sel.material && [<dt key="mk" className="text-stone-400">Material</dt>, <dd key="mv">{MATERIALS[sel.material]?.label ?? sel.material}</dd>]}
                {Object.entries(sel.properties).flatMap(([k, v]) => [<dt key={`k${k}`} className="text-stone-400">{k}</dt>, <dd key={`v${k}`}>{String(v)}</dd>])}
              </dl>
            )}
            <div className="mt-2.5 flex gap-1.5">
              <button type="button" onClick={() => setIsolated((s) => (s?.size === 1 && s.has(sel.id) ? null : new Set([sel.id])))} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 hover:bg-white/20"><Eye className="h-3 w-3" /> {isolated?.size === 1 && isolated.has(sel.id) ? 'Show all' : 'Isolate'}</button>
              <button type="button" onClick={() => { setHidden((h) => new Set(h).add(sel.id)); setSelected(null); }} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 hover:bg-white/20"><EyeOff className="h-3 w-3" /> Hide</button>
            </div>
          </div>
        )}
        {hidden.size > 0 && !sel && <button type="button" onClick={() => setHidden(new Set())} className="absolute right-2 top-14 rounded-lg sm:top-2 bg-black/60 px-2.5 py-1.5 text-xs text-stone-200">Show {hidden.size} hidden part{hidden.size > 1 ? 's' : ''}</button>}
        {walking && <div className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">Walking: W A S D to move, mouse to look, Shift to run, Esc to stop</div>}
      </div>

      {/* Guided views and description */}
      {(scene.views.length > 0 || scene.description) && (
        <div className="border-t border-white/[0.06] px-3 py-2">
          {scene.views.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
              {scene.views.map((v, i) => <button key={i} type="button" onClick={() => goView(i)} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${view === i ? 'border-[#D97757] bg-[#D97757]/15 text-white' : 'border-white/10 text-stone-300 hover:bg-white/5'}`}>{i + 1}. {v.name}</button>)}
            </div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-stone-400">{view !== null && scene.views[view]?.note ? scene.views[view].note : scene.description}</p>
        </div>
      )}
    </div>
  );
}
