import { billOfMaterials, MATERIALS, sceneSummary, SceneError, validateScene, type Scene } from '../../../../src/lib/scene/spec.js';
import { MIME } from '../files/mime.js';
import type { Tool } from '../types.js';
import { err, saveFile } from './helpers.js';

/**
 * Interactive 3D models in the chat. The model writes a scene (named parts built from simple solids, or a
 * molecule as atoms and bonds); the student can rotate, isolate parts, explode, cut sections, see a stress
 * map, run gravity, move the sun through the seasons, walk through buildings, open it in VR, export glTF, and
 * get a bill of materials. analyze_3d_model links a model to economics: volumes, masses and materials cost.
 */

const SCENE_SCHEMA = {
  type: 'object', required: ['title', 'parts'],
  properties: {
    title: { type: 'string' },
    subject: { type: 'string', enum: ['biology', 'medicine', 'chemistry', 'physics', 'engineering', 'architecture', 'geography', 'art', 'mathematics', 'general'] },
    description: { type: 'string', description: 'What the model shows and how to explore it (2–4 sentences).' },
    units: { type: 'string', description: 'm, cm, mm, µm, nm or Å' },
    background: { type: 'string' },
    ground: { type: 'boolean' },
    gravity: { type: 'number', description: 'm/s² for the gravity demo (Earth 9.81, Moon 1.62, Mars 3.71)' },
    sun: { type: 'object', properties: { latitude: { type: 'number' }, month: { type: 'number' }, hour: { type: 'number' }, enabled: { type: 'boolean' } } },
    camera: { type: 'object', properties: { position: { type: 'array', items: { type: 'number' } }, target: { type: 'array', items: { type: 'number' } } } },
    walkthrough: { type: 'boolean', description: 'true for buildings: first-person walk mode' },
    parts: {
      type: 'array', maxItems: 400,
      items: {
        type: 'object', required: ['name', 'shape'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string', description: 'What this part is and does (shown when clicked)' }, group: { type: 'string' },
          shape: { type: 'string', enum: ['box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'capsule', 'plane', 'tube', 'extrude', 'lathe'] },
          size: { type: 'object', description: 'box: width,height,depth; sphere: radius; ellipsoid: radii [x,y,z]; cylinder: radiusTop,radiusBottom,height; cone: radiusBottom,height; torus: radius,tube; capsule: radius,height; tube: points [[x,y,z]…],tube; extrude: points [[x,y]…] outline,depth; lathe: points [[r,y]…] profile' },
          position: { type: 'array', items: { type: 'number' } }, rotation: { type: 'array', items: { type: 'number' }, description: 'degrees' }, scale: { type: 'array', items: { type: 'number' } },
          color: { type: 'string' }, opacity: { type: 'number' }, metalness: { type: 'number' }, roughness: { type: 'number' },
          material: { type: 'string', description: `For mass and cost: ${Object.keys(MATERIALS).join(', ')}` },
          stress: { type: 'number', description: 'Relative load 0–1 for the stress map' },
          velocity: { type: 'array', items: { type: 'number' } }, mass: { type: 'number' }, fixed: { type: 'boolean' },
          animation: { type: 'object', properties: { type: { type: 'string', enum: ['rotate', 'oscillate', 'orbit', 'pulse'] }, axis: { type: 'array', items: { type: 'number' } }, speed: { type: 'number' }, amplitude: { type: 'number' }, center: { type: 'array', items: { type: 'number' } } } },
          explode: { type: 'array', items: { type: 'number' } },
          properties: { type: 'object', description: 'Facts shown on click (e.g. function, charge, load in kN)' },
        },
      },
    },
    molecule: { type: 'object', description: 'Alternative to parts for chemistry: atoms [{element, position:[x,y,z] in Å}] and bonds [{a, b, order}] (0-based atom indexes)' },
    connections: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, radius: { type: 'number' }, color: { type: 'string' }, label: { type: 'string' } } } },
    annotations: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, position: { type: 'array', items: { type: 'number' } }, partId: { type: 'string' } } } },
    views: { type: 'array', description: 'Guided tour steps', items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' }, camera: { type: 'object' }, show: { type: 'array', items: { type: 'string' } }, section: { type: 'object', properties: { axis: { type: 'string', enum: ['x', 'y', 'z'] }, offset: { type: 'number' } } } } } },
    quiz: { type: 'array', description: '"Click the …" questions answered by clicking a part', items: { type: 'object', properties: { question: { type: 'string' }, answerPartId: { type: 'string' }, explanation: { type: 'string' } } } },
  },
};

const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toPrecision(3));

export const create3dModel: Tool = {
  definition: {
    name: 'create_3d_model',
    description: 'Create an interactive 3D model the student can explore in the chat: anatomy, cells, organelles, proteins and molecules, machines and mechanisms, beams and bridges, buildings and rooms, planets and orbits, geometric solids. ' +
      'Build it from named parts (simple solids positioned in a shared coordinate system, y up, ground at y=0) with a short description each, group related parts, and use connections for bonds, beams and cables. ' +
      'Add views for a guided tour, quiz questions ("click the mitochondrion"), material for parts that have a real material (enables mass and cost), stress 0–1 for loaded members, velocity/mass for physics demos, walkthrough for buildings. ' +
      'Proportions matter: keep sizes realistic relative to each other. Use 10–150 parts; more detail is not always clearer.',
    parameters: { type: 'object', required: ['scene'], properties: { scene: SCENE_SCHEMA, fileName: { type: 'string' } } },
  },
  async execute(input, ctx) {
    let scene: Scene;
    try { scene = validateScene(input.scene); } catch (e) {
      if (e instanceof SceneError) return err(`The scene was rejected: ${e.message} Fix it and call create_3d_model again.`);
      throw e;
    }
    const json = JSON.stringify(scene);
    const ref = await saveFile(ctx, { name: input.fileName || scene.title, ext: 'scene.json', mime: MIME.scene, kind: 'model3d', data: Buffer.from(json, 'utf8') });
    const bom = billOfMaterials(scene);
    return {
      text: `Created the interactive 3D model "${scene.title}" (fileId ${ref.id}). ${sceneSummary(scene)} It is shown in the chat: the student can rotate it, click parts for details, isolate, explode, cut a section${scene.parts.some((p) => p.stress !== undefined) ? ', show the stress map' : ''}${scene.parts.some((p) => p.velocity) ? ', run the physics demo' : ''}${scene.sun.enabled ? ', move the sun through the seasons' : ''}${scene.walkthrough ? ', walk through it' : ''}, open it in VR and export it as glTF.${bom.lines.length ? ` Materials estimate: ${fmt(bom.totalMassKg)} kg, about ${fmt(bom.totalCostRwf)} RWF (use analyze_3d_model for the breakdown).` : ''} Explain in 2–4 sentences what to look at first; do not paste the JSON.`,
      attachments: [ref],
    };
  },
};

export const analyze3dModel: Tool = {
  definition: {
    name: 'analyze_3d_model',
    description: 'Compute volumes, masses and materials cost (RWF) of a 3D model created earlier, per part and per material, optionally with the user\'s prices per kg. Use it to connect a design to economics (budget, cost scaling) or physics (mass, weight).',
    parameters: {
      type: 'object', required: ['fileId'],
      properties: { fileId: { type: 'string' }, pricesRwfPerKg: { type: 'object', description: 'e.g. {"steel": 2100, "concrete": 95}' }, scale: { type: 'number', description: 'Scale factor to apply to all dimensions (cost scaling); volumes grow with the cube' } },
    },
  },
  async execute(input, ctx) {
    let scene: Scene;
    try {
      const { data, meta } = await ctx.files.read(String(input.fileId), ctx.userId);
      if (!meta.mime.startsWith(MIME.scene)) return err('That file is not a 3D model. Pass the fileId returned by create_3d_model.');
      scene = validateScene(JSON.parse(data.toString('utf8')));
    } catch {
      return err('The 3D model was not found or has expired. Create it again with create_3d_model.');
    }
    const k = typeof input.scale === 'number' && input.scale > 0 ? input.scale : 1;
    const prices: Record<string, number> = {};
    for (const [m, v] of Object.entries(input.pricesRwfPerKg ?? {})) if (typeof v === 'number' && v >= 0) prices[m.toLowerCase()] = v;
    const bom = billOfMaterials({ ...scene, metresPerUnit: scene.metresPerUnit * k }, prices);
    if (!bom.lines.length) return err('No part of this model has a material, so mass and cost cannot be computed. Recreate it with material on the structural parts.');
    const rows = bom.byMaterial.map((m) => `| ${m.label} | ${fmt(m.volumeM3)} m³ | ${fmt(m.massKg)} kg | ${fmt(m.costRwf)} RWF |`).join('\n');
    return {
      text: `Materials for "${scene.title}"${k !== 1 ? ` scaled ×${k}` : ''}:\n| Material | Volume | Mass | Cost |\n|---|---|---|---|\n${rows}\n| **Total** | | **${fmt(bom.totalMassKg)} kg** | **${fmt(bom.totalCostRwf)} RWF** |\n${bom.note}${k !== 1 ? ' Scaling every dimension by k multiplies volume, mass and cost by k³.' : ''}`,
    };
  },
};

export const sceneTools = [create3dModel, analyze3dModel];
