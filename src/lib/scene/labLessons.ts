import { validateScene, type Vec3 } from './spec';

function chamber(id: string, name: string, position: Vec3, radii: Vec3, color: string, description: string) {
  return { id, name, position, shape: 'ellipsoid', rotation: [0,0,15], size: { radii }, color, description };
}
function vessel(id: string, name: string, points: Vec3[], color: string, description: string) {
  return { id, name, shape: 'tube', size: { points, tube: 0.18 }, color, description, label: false };
}
const front = { position: [0,0.45,6.4], target: [0,0.15,0] };
export const heart = validateScene({
  title: 'Heart chambers', subject: 'medicine', units: 'relative', ground: false, camera: front, background: '#15232d',
  description: 'Explore the four chambers and the major vessels in a simplified teaching model.',
  parts: [
    chamber('ra','Right atrium',[-0.63,0.44,0.1],[0.53,0.56,0.48],'#8e96c9','Receives blood returning from the body.'),
    chamber('rv','Right ventricle',[-0.38,-0.43,0.35],[0.58,0.86,0.46],'#667db1','Pumps blood toward the lungs.'),
    chamber('la','Left atrium',[0.47,0.53,-0.32],[0.55,0.51,0.48],'#df9588','Receives oxygenated blood from the lungs.'),
    chamber('lv','Left ventricle',[0.45,-0.58,-0.05],[0.60,1.06,0.55],'#ba5a61','Pumps blood into the aorta.'),
    vessel('aorta','Aorta',[[0.32,0.01,0],[0.14,1.03,-0.1],[0.31,1.58,-0.18],[0.78,1.63,-0.45],[0.92,1.10,-0.70],[0.88,-0.32,-0.77]],'#d9786c','Carries blood from the left ventricle toward the body.'),
    vessel('trunk','Pulmonary trunk',[[-0.24,-0.22,0.5],[-0.17,0.51,0.55],[0.05,0.94,0.46],[0.49,1.12,0.18]],'#728abd','Carries blood from the right ventricle toward the pulmonary arteries.'),
    vessel('svc','Superior vena cava',[[-0.84,1.5,0],[-0.82,0.97,0],[-0.63,0.43,0]],'#8698cc','Returns blood from the upper body to the right atrium.'),
  ],
  views: [{ name: 'Front', camera: front }, { name: 'Chambers only', camera: front, show: ['ra','rv','la','lv'] }, { name: 'Back', camera: { position: [0,0.5,-6.4], target: [0,0.15,0] } }],
  quiz: [{ question: 'Select the chamber that pumps blood into the aorta.', answerPartId: 'lv' },
    { question: 'Which chamber receives blood from the upper body?', answerPartId: 'ra' }],
});

function ring(id: string, name: string, inner: number, outer: number, lift: number, description: string) {
  return { id, name, description, shape: 'lathe', size: { points: [[inner,-2],[outer,-2],[outer,2],[inner,2],[inner,-2]] },
    metalness: 0.5, roughness: 0.3, color: '#a7c2d3', explode: [0,lift,0] };
}
export const bearing = validateScene({
  title: 'Radial ball bearing', subject: 'engineering', units: 'mm', ground: false, background: '#15232d',
  description: 'Inspect the two rings and rolling elements. Use the exploded view to separate the assembly.',
  parts: [
    ring('inner','Inner ring',5,6.8,-8,'The shaft fits in the bore of the inner ring.'),
    ring('outer','Outer ring',10,12,8,'The outer ring seats in the housing.'),
    ...Array.from({length: 8}, (_,i) => {
      const angle = i*Math.PI/4;
      return { id: 'ball-'+i, name: 'Rolling element '+(i+1), shape: 'sphere', size: { radius: 1.6 },
        position: [8.4*Math.cos(angle),0,8.4*Math.sin(angle)], metalness: 0.4, color: '#d6ae70',
        description: 'The ball rolls between the inner and outer rings.', explode: [0,0,0], label: false };
    }),
  ],
  views: [{ name: 'Along shaft', camera: { position: [0,39,0.1], target: [0,0,0] } }],
  quiz: [{ question: 'Which ring fits around the shaft?', answerPartId: 'inner' },{ question: 'Which ring seats inside the housing?', answerPartId: 'outer' }],
});
