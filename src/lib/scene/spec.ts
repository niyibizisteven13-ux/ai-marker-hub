/**
 * Bwenge 3D scene format, shared by the server (validation, materials analysis, Telegram viewer) and the
 * browser viewer. A scene is plain JSON: named parts built from simple solids, connections between them
 * (bonds, beams, cables), annotations, guided views, and optional physical data (material, load, velocity)
 * that drives the interactive tools: isolate, explode, section, stress map, gravity, sun and seasons,
 * walkthrough, VR, glTF export and a bill of materials.
 *
 * No code runs from a scene: every field is validated and clamped, strings are length-limited.
 */

export type Vec3 = [number, number, number];
export type Shape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'plane' | 'tube' | 'extrude' | 'lathe' | 'ellipsoid';
export type Subject = 'biology' | 'medicine' | 'chemistry' | 'physics' | 'engineering' | 'architecture' | 'geography' | 'art' | 'mathematics' | 'general';

export interface ScenePart {
  id: string;
  name: string;
  description?: string;
  group?: string;
  shape: Shape;
  /** Dimensions in scene units: width/height/depth (box), radius (sphere…), radiusTop/radiusBottom/height (cylinder, cone),
   *  radius+tube (torus), points (tube path [x,y,z]; extrude outline [x,y]; lathe profile [x,y]), depth (extrude), radii (ellipsoid). */
  size: { width?: number; height?: number; depth?: number; radius?: number; radiusTop?: number; radiusBottom?: number; tube?: number; points?: number[][]; radii?: Vec3 };
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
  color: string;
  opacity: number;
  metalness: number;
  roughness: number;
  wireframe?: boolean;
  material?: string;
  /** Relative load 0–1 for the stress map (illustrative unless stated). */
  stress?: number;
  /** Physics demo: initial velocity (units/s), mass (kg), fixed parts do not move. */
  velocity?: Vec3;
  mass?: number;
  fixed?: boolean;
  animation?: { type: 'rotate' | 'oscillate' | 'orbit' | 'pulse'; axis: Vec3; speed: number; amplitude: number; center?: Vec3 };
  /** Direction for the exploded view (defaults to away from the centre). */
  explode?: Vec3;
  label: boolean;
  properties: Record<string, string | number>;
}

export interface SceneConnection { from: string; to: string; radius: number; color: string; label?: string; kind?: string }
export interface SceneAnnotation { text: string; position: Vec3; partId?: string }
export interface SceneView { name: string; camera: { position: Vec3; target: Vec3 }; show?: string[]; section?: { axis: 'x' | 'y' | 'z'; offset: number }; note?: string }
export interface SceneQuiz { question: string; answerPartId: string; explanation?: string }

export interface Scene {
  version: 1;
  title: string;
  subject: Subject;
  description: string;
  units: string;
  /** Real-world metres per scene unit, for volumes, masses and costs (1 when units are metres). */
  metresPerUnit: number;
  background: string;
  ground: boolean;
  gravity: number;
  sun: { latitude: number; month: number; hour: number; enabled: boolean };
  camera?: { position: Vec3; target: Vec3 };
  parts: ScenePart[];
  connections: SceneConnection[];
  annotations: SceneAnnotation[];
  views: SceneView[];
  quiz: SceneQuiz[];
  walkthrough: boolean;
}

export class SceneError extends Error {}

const LIMITS = { parts: 400, connections: 800, annotations: 60, views: 20, quiz: 20, points: 400, text: 600, name: 80 };
const SHAPES: Shape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'plane', 'tube', 'extrude', 'lathe', 'ellipsoid'];
const SUBJECTS: Subject[] = ['biology', 'medicine', 'chemistry', 'physics', 'engineering', 'architecture', 'geography', 'art', 'mathematics', 'general'];

const num = (v: unknown, d: number, min = -1e6, max = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : d);
const vec = (v: unknown, d: Vec3, min = -1e5, max = 1e5): Vec3 => (Array.isArray(v) && v.length >= 3 ? [num(v[0], d[0], min, max), num(v[1], d[1], min, max), num(v[2], d[2], min, max)] : d);
const color = (v: unknown, d: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(s) || /^#[0-9a-f]{3}$/i.test(s)) return s.toLowerCase();
  return NAMED[s.toLowerCase()] ?? d;
};
const NAMED: Record<string, string> = {
  red: '#e5484d', green: '#30a46c', blue: '#3e63dd', yellow: '#f5d90a', orange: '#f76b15', purple: '#8e4ec6', pink: '#d6409f', brown: '#8d5a3b',
  white: '#f5f5f5', black: '#222222', grey: '#8b8d98', gray: '#8b8d98', teal: '#12a594', cyan: '#00a2c7', gold: '#ffc53d', silver: '#c0c4cc',
};
const PALETTE = ['#3e63dd', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#ffc53d', '#d6409f', '#8d5a3b', '#00a2c7'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part';

// ── Molecules: CPK colours and radii (Å) ─────────────────────────────────────
const ELEMENTS: Record<string, { color: string; radius: number; name: string }> = {
  H: { color: '#ffffff', radius: 0.31, name: 'Hydrogen' }, C: { color: '#404040', radius: 0.76, name: 'Carbon' }, N: { color: '#3050f8', radius: 0.71, name: 'Nitrogen' },
  O: { color: '#ff0d0d', radius: 0.66, name: 'Oxygen' }, S: { color: '#ffff30', radius: 1.05, name: 'Sulfur' }, P: { color: '#ff8000', radius: 1.07, name: 'Phosphorus' },
  Cl: { color: '#1ff01f', radius: 1.02, name: 'Chlorine' }, Na: { color: '#ab5cf2', radius: 1.66, name: 'Sodium' }, K: { color: '#8f40d4', radius: 2.03, name: 'Potassium' },
  Ca: { color: '#3dff00', radius: 1.76, name: 'Calcium' }, Fe: { color: '#e06633', radius: 1.32, name: 'Iron' }, Mg: { color: '#8aff00', radius: 1.41, name: 'Magnesium' },
  F: { color: '#90e050', radius: 0.57, name: 'Fluorine' }, Br: { color: '#a62929', radius: 1.2, name: 'Bromine' }, I: { color: '#940094', radius: 1.39, name: 'Iodine' },
  Zn: { color: '#7d80b0', radius: 1.22, name: 'Zinc' }, Cu: { color: '#c88033', radius: 1.32, name: 'Copper' }, Si: { color: '#f0c8a0', radius: 1.11, name: 'Silicon' },
};

/** Expands { molecule: { atoms, bonds } } into parts and connections (ball-and-stick). */
function expandMolecule(m: any): { parts: any[]; connections: any[] } {
  const atoms = Array.isArray(m?.atoms) ? m.atoms.slice(0, LIMITS.parts) : [];
  const parts = atoms.map((a: any, i: number) => {
    const el = String(a?.element ?? 'C').replace(/[^A-Za-z]/g, '').slice(0, 2);
    const e = ELEMENTS[el] ?? { color: '#ff1493', radius: 0.8, name: el };
    return { id: `a${i + 1}`, name: `${e.name} ${i + 1}`, shape: 'sphere', size: { radius: e.radius * 0.45 }, position: a?.position, color: e.color, group: e.name, label: false, properties: { element: el } };
  });
  const bonds = Array.isArray(m?.bonds) ? m.bonds.slice(0, LIMITS.connections) : [];
  const connections = bonds.flatMap((b: any) => {
    const order = Math.min(3, Math.max(1, Math.round(num(b?.order, 1))));
    return [{ from: `a${num(b?.a, 0) + 1}`, to: `a${num(b?.b, 0) + 1}`, radius: order > 1 ? 0.07 : 0.1, color: '#b8b8b8', kind: order === 2 ? 'double bond' : order === 3 ? 'triple bond' : 'bond' }];
  });
  return { parts, connections };
}

/** Validates and normalises a scene; throws SceneError with a message the model can act on. */
export function validateScene(input: any): Scene {
  if (!input || typeof input !== 'object') throw new SceneError('The scene must be a JSON object.');
  let rawParts: any[] = Array.isArray(input.parts) ? input.parts : [];
  let rawConn: any[] = Array.isArray(input.connections) ? input.connections : [];
  if (input.molecule) { const m = expandMolecule(input.molecule); rawParts = [...rawParts, ...m.parts]; rawConn = [...rawConn, ...m.connections]; }
  if (!rawParts.length) throw new SceneError('The scene has no parts. Add at least one part (or a molecule with atoms).');
  if (rawParts.length > LIMITS.parts) throw new SceneError(`Too many parts (${rawParts.length}); the limit is ${LIMITS.parts}. Merge small parts or use groups.`);
  const ids = new Set<string>();
  const parts: ScenePart[] = rawParts.map((p, i) => {
    const shape = SHAPES.includes(p?.shape) ? p.shape : 'box';
    let id = slug(str(p?.id, 40) || str(p?.name, 40) || `part-${i + 1}`);
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const s = p?.size ?? {};
    const pts = Array.isArray(s.points) ? s.points.slice(0, LIMITS.points).map((q: any) => (Array.isArray(q) ? q.slice(0, 3).map((x: any) => num(x, 0)) : [0, 0])) : undefined;
    if ((shape === 'tube' || shape === 'extrude' || shape === 'lathe') && (!pts || pts.length < 2)) throw new SceneError(`Part "${p?.name ?? id}" (${shape}) needs size.points with at least 2 points.`);
    const size = {
      width: num(s.width, 1, 0.0001, 1e5), height: num(s.height, 1, 0.0001, 1e5), depth: num(s.depth, 1, 0.0001, 1e5),
      radius: num(s.radius, 0.5, 0.0001, 1e5), radiusTop: num(s.radiusTop ?? s.radius, 0.5, 0, 1e5), radiusBottom: num(s.radiusBottom ?? s.radius, 0.5, 0, 1e5),
      tube: num(s.tube, 0.15, 0.0001, 1e5), ...(pts ? { points: pts } : {}), ...(s.radii ? { radii: vec(s.radii, [1, 0.6, 0.4], 0.0001) } : {}),
    };
    const anim = p?.animation && ['rotate', 'oscillate', 'orbit', 'pulse'].includes(p.animation.type)
      ? { type: p.animation.type, axis: vec(p.animation.axis, [0, 1, 0], -1, 1), speed: num(p.animation.speed, 1, -20, 20), amplitude: num(p.animation.amplitude, 0.2, 0, 1e3), ...(p.animation.center ? { center: vec(p.animation.center, [0, 0, 0]) } : {}) }
      : undefined;
    const props: Record<string, string | number> = {};
    if (p?.properties && typeof p.properties === 'object') for (const [k, v] of Object.entries(p.properties).slice(0, 20)) props[str(k, 40)] = typeof v === 'number' && Number.isFinite(v) ? v : str(v, 200);
    return {
      id, name: str(p?.name, LIMITS.name) || id, description: str(p?.description, LIMITS.text) || undefined, group: str(p?.group, 60) || undefined, shape, size,
      position: vec(p?.position, [0, 0, 0]), rotation: vec(p?.rotation, [0, 0, 0], -3600, 3600), scale: vec(p?.scale, [1, 1, 1], 0.0001, 1e4),
      color: color(p?.color, PALETTE[i % PALETTE.length]), opacity: num(p?.opacity, 1, 0.05, 1), metalness: num(p?.metalness, 0.1, 0, 1), roughness: num(p?.roughness, 0.6, 0, 1),
      wireframe: p?.wireframe === true || undefined, material: str(p?.material, 40).toLowerCase() || undefined,
      stress: p?.stress === undefined ? undefined : num(p.stress, 0, 0, 1), velocity: p?.velocity ? vec(p.velocity, [0, 0, 0], -1e4, 1e4) : undefined,
      mass: p?.mass === undefined ? undefined : num(p.mass, 1, 0, 1e9), fixed: p?.fixed === true || undefined, animation: anim as ScenePart['animation'],
      explode: p?.explode ? vec(p.explode, [0, 1, 0], -1e3, 1e3) : undefined, label: p?.label !== false, properties: props,
    };
  });
  if (rawConn.length > LIMITS.connections) throw new SceneError(`Too many connections (${rawConn.length}); the limit is ${LIMITS.connections}.`);
  const byOriginal = new Map<string, string>();
  rawParts.forEach((p, i) => { byOriginal.set(String(p?.id ?? ''), parts[i].id); byOriginal.set(slug(String(p?.id ?? p?.name ?? '')), parts[i].id); });
  const resolve = (x: unknown) => { const k = String(x ?? ''); return ids.has(k) ? k : byOriginal.get(k) ?? byOriginal.get(slug(k)) ?? null; };
  const connections: SceneConnection[] = rawConn.flatMap((c) => {
    const from = resolve(c?.from), to = resolve(c?.to);
    if (!from || !to || from === to) return [];
    return [{ from, to, radius: num(c?.radius, 0.05, 0.001, 1e3), color: color(c?.color, '#9aa3b2'), label: str(c?.label, 60) || undefined, kind: str(c?.kind, 30) || undefined }];
  });
  const resolveIds = (list: unknown) => (Array.isArray(list) ? list.map(resolve).filter((x): x is string => !!x) : undefined);
  const views: SceneView[] = (Array.isArray(input.views) ? input.views : []).slice(0, LIMITS.views).map((v: any, i: number) => ({
    name: str(v?.name, 60) || `View ${i + 1}`, camera: { position: vec(v?.camera?.position, [4, 3, 6]), target: vec(v?.camera?.target, [0, 0, 0]) },
    show: resolveIds(v?.show), section: v?.section && ['x', 'y', 'z'].includes(v.section.axis) ? { axis: v.section.axis, offset: num(v.section.offset, 0) } : undefined, note: str(v?.note, LIMITS.text) || undefined,
  }));
  const quiz: SceneQuiz[] = (Array.isArray(input.quiz) ? input.quiz : []).slice(0, LIMITS.quiz).flatMap((q: any) => {
    const answer = resolve(q?.answerPartId);
    return answer && str(q?.question, 300) ? [{ question: str(q.question, 300), answerPartId: answer, explanation: str(q?.explanation, LIMITS.text) || undefined }] : [];
  });
  const sun = input.sun ?? {};
  return {
    version: 1, title: str(input.title, 120) || 'Untitled model', subject: SUBJECTS.includes(input.subject) ? input.subject : 'general', description: str(input.description, 2000),
    units: str(input.units, 12) || 'm', metresPerUnit: num(input.metresPerUnit, unitToMetres(str(input.units, 12) || 'm'), 1e-12, 1e6),
    background: color(input.background, '#10141c'), ground: input.ground !== false, gravity: num(input.gravity, 9.81, 0, 300),
    sun: { latitude: num(sun.latitude, -1.95, -90, 90), month: Math.round(num(sun.month, 6, 1, 12)), hour: num(sun.hour, 12, 0, 24), enabled: sun.enabled === true || input.subject === 'architecture' },
    camera: input.camera ? { position: vec(input.camera.position, [6, 4, 8]), target: vec(input.camera.target, [0, 0, 0]) } : undefined,
    parts, connections,
    annotations: (Array.isArray(input.annotations) ? input.annotations : []).slice(0, LIMITS.annotations).map((a: any) => ({ text: str(a?.text, 200), position: vec(a?.position, [0, 0, 0]), partId: resolve(a?.partId) ?? undefined })).filter((a: SceneAnnotation) => a.text),
    views, quiz, walkthrough: input.walkthrough === true || input.subject === 'architecture',
  };
}

export function unitToMetres(u: string): number {
  return ({ m: 1, cm: 0.01, mm: 0.001, km: 1000, um: 1e-6, 'µm': 1e-6, nm: 1e-9, 'å': 1e-10, a: 1e-10, angstrom: 1e-10, ft: 0.3048, in: 0.0254 } as Record<string, number>)[u.toLowerCase()] ?? 1;
}

// ── Volumes, masses and costs (cross-disciplinary: engineering ↔ economics) ──
/** Density in kg/m³ and a default price in RWF per kg (editable by the user). */
export const MATERIALS: Record<string, { density: number; rwfPerKg: number; label: string }> = {
  concrete: { density: 2400, rwfPerKg: 90, label: 'Concrete' }, steel: { density: 7850, rwfPerKg: 1900, label: 'Steel' }, aluminium: { density: 2700, rwfPerKg: 4500, label: 'Aluminium' },
  wood: { density: 600, rwfPerKg: 700, label: 'Timber' }, brick: { density: 1900, rwfPerKg: 120, label: 'Brick' }, glass: { density: 2500, rwfPerKg: 2500, label: 'Glass' },
  stone: { density: 2600, rwfPerKg: 60, label: 'Stone' }, copper: { density: 8960, rwfPerKg: 14000, label: 'Copper' }, plastic: { density: 950, rwfPerKg: 2200, label: 'Plastic' },
  water: { density: 1000, rwfPerKg: 1, label: 'Water' }, bone: { density: 1900, rwfPerKg: 0, label: 'Bone' }, tissue: { density: 1060, rwfPerKg: 0, label: 'Soft tissue' },
  soil: { density: 1600, rwfPerKg: 15, label: 'Soil' }, sand: { density: 1600, rwfPerKg: 25, label: 'Sand' }, iron: { density: 7870, rwfPerKg: 1500, label: 'Iron' },
};

/** Volume of one part in scene units³ (outer volume; hollow parts are not modelled). */
export function partVolume(p: ScenePart): number {
  const s = p.size, k = Math.abs(p.scale[0] * p.scale[1] * p.scale[2]);
  const r = s.radius ?? 0.5;
  let v = 0;
  switch (p.shape) {
    case 'box': v = (s.width ?? 1) * (s.height ?? 1) * (s.depth ?? 1); break;
    case 'sphere': v = (4 / 3) * Math.PI * r ** 3; break;
    case 'ellipsoid': { const q = s.radii ?? [1, 0.6, 0.4]; v = (4 / 3) * Math.PI * q[0] * q[1] * q[2]; break; }
    case 'cylinder': { const a = s.radiusTop ?? r, b = s.radiusBottom ?? r; v = (Math.PI * (s.height ?? 1) / 3) * (a * a + a * b + b * b); break; }
    case 'cone': v = (Math.PI * (s.radiusBottom ?? r) ** 2 * (s.height ?? 1)) / 3; break;
    case 'torus': v = 2 * Math.PI ** 2 * r * (s.tube ?? 0.15) ** 2; break;
    case 'capsule': v = Math.PI * r * r * (s.height ?? 1) + (4 / 3) * Math.PI * r ** 3; break;
    case 'plane': v = 0; break;
    case 'tube': { const pts = s.points ?? []; let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], (pts[i][1] ?? 0) - (pts[i - 1][1] ?? 0), (pts[i][2] ?? 0) - (pts[i - 1][2] ?? 0)); v = len * Math.PI * (s.tube ?? 0.1) ** 2; break; }
    case 'extrude': { const pts = s.points ?? []; let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } v = (Math.abs(a) / 2) * (s.depth ?? 1); break; }
    case 'lathe': { const pts = s.points ?? []; for (let i = 1; i < pts.length; i++) { const r1 = Math.abs(pts[i - 1][0]), r2 = Math.abs(pts[i][0]), h = Math.abs(pts[i][1] - pts[i - 1][1]); v += (Math.PI * h / 3) * (r1 * r1 + r1 * r2 + r2 * r2); } break; }
  }
  return v * k;
}

export interface BomLine { partId: string; name: string; material: string; volumeM3: number; massKg: number; costRwf: number }
export interface Bom { lines: BomLine[]; byMaterial: Array<{ material: string; label: string; volumeM3: number; massKg: number; costRwf: number }>; totalMassKg: number; totalCostRwf: number; note: string }

/** Bill of materials from the parts' volumes, materials and prices (user prices override the defaults). */
export function billOfMaterials(scene: Scene, prices: Record<string, number> = {}): Bom {
  const m3 = scene.metresPerUnit ** 3;
  const lines: BomLine[] = scene.parts.filter((p) => p.material && MATERIALS[p.material]).map((p) => {
    const mat = MATERIALS[p.material!];
    const volumeM3 = partVolume(p) * m3;
    const massKg = p.mass ?? volumeM3 * mat.density;
    const costRwf = massKg * (prices[p.material!] ?? mat.rwfPerKg);
    return { partId: p.id, name: p.name, material: p.material!, volumeM3, massKg, costRwf };
  });
  const agg = new Map<string, { volumeM3: number; massKg: number; costRwf: number }>();
  for (const l of lines) { const a = agg.get(l.material) ?? { volumeM3: 0, massKg: 0, costRwf: 0 }; a.volumeM3 += l.volumeM3; a.massKg += l.massKg; a.costRwf += l.costRwf; agg.set(l.material, a); }
  return {
    lines,
    byMaterial: [...agg].map(([material, a]) => ({ material, label: MATERIALS[material].label, ...a })).sort((x, y) => y.costRwf - x.costRwf),
    totalMassKg: lines.reduce((a, l) => a + l.massKg, 0), totalCostRwf: lines.reduce((a, l) => a + l.costRwf, 0),
    note: 'Estimate from outer volumes of the model and indicative material prices (RWF/kg); hollow sections, waste, labour and transport are not included.',
  };
}

// ── Sun position (architecture: daylight across seasons) ──────────────────────
/** Sun direction (unit vector, y up, -z north) for a latitude, month (1–12) and solar hour; elevation in degrees. */
export function sunDirection(latitude: number, month: number, hour: number): { dir: Vec3; elevation: number; azimuth: number } {
  const day = Math.round((month - 1) * 30.44 + 15);
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10)) * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const ha = ((hour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat) || 1e-9);
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (ha > 0) az = 2 * Math.PI - az; // afternoon: west
  const dir: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  return { dir, elevation: (el * 180) / Math.PI, azimuth: (az * 180) / Math.PI };
}

/** One-line summary for the model and for Telegram. */
export function sceneSummary(s: Scene): string {
  const groups = [...new Set(s.parts.map((p) => p.group).filter(Boolean))];
  return `${s.title}: ${s.parts.length} parts${groups.length ? ` in ${groups.length} groups (${groups.slice(0, 6).join(', ')})` : ''}, ${s.connections.length} connections${s.views.length ? `, ${s.views.length} guided views` : ''}${s.quiz.length ? `, ${s.quiz.length} quiz questions` : ''}.`;
}
