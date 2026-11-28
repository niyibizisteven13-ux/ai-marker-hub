import { useState } from 'react';
import { ArrowLeft, Box } from 'lucide-react';
import SceneViewer from '../components/scene3d/SceneViewer';
import { AgentComposer, AgentThread, useAgentChat } from '../components/AgentChat';
import { heart, bearing } from '../lib/scene/labLessons';
import type { Scene, ScenePart } from '../lib/scene/spec';

function Lesson({ scene }: { scene: Scene }) {
  const [part,setPart] = useState<ScenePart | null>(null);
  const chat = useAgentChat({ context: [
    'The student is exploring the Bwenge 3D Labs teaching model: '+scene.title+'.',
    scene.description, 'Parts available: '+scene.parts.map(p => p.name).join(', ')+'.',
    part ? 'Selected part: '+part.name+'. '+part.description : 'No part selected.',
    'Answer the student using this context. The model is schematic. You can guide the student through the viewer controls.',
  ].join(' ') });
  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <section className="min-w-0">
      <h2 className="mb-1 text-2xl font-semibold">{scene.title}</h2>
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{scene.description}</p>
      <SceneViewer scene={scene} onPart={setPart} />
      <p className="mt-3 text-sm text-slate-300">Drag to orbit. Select a part to inspect it or ask a question. On a compatible headset, choose View in VR.</p>
      {scene === heart && <a className="mt-3 inline-block text-sm text-teal-200 underline" href="https://www.nhlbi.nih.gov/health/heart/blood-flow">Heart circulation reference · NHLBI</a>}
    </section>
    <aside className="flex max-h-[36rem] min-h-80 flex-col rounded-2xl border border-white/10 bg-[#17222c]">
      <div className="border-b border-white/10 p-4"><h2 className="font-semibold">Ask Bwenge</h2><p className="mt-1 text-xs text-teal-200">{part?.name ?? scene.title}</p></div>
      <AgentThread chat={chat} light={false} intro="Ask about the model or the part you selected." suggestions={['Guide me through this model.','Give me a practice question.']} />
      <AgentComposer chat={chat} light={false} placeholder="Ask about this model…" />
    </aside>
  </div>;
}
export default function LabPage() {
  const engineering = new URLSearchParams(window.location.search).get('lesson') === 'bearing';
  const scene = engineering ? bearing : heart;
  return <main className="h-[100dvh] overflow-y-auto bg-[#0c161e] text-slate-100">
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-8">
      <a href="/" className="inline-flex min-h-10 items-center gap-2 text-sm text-slate-300"><ArrowLeft size={16}/> Bwenge chat</a>
      <h1 className="my-4 flex items-center gap-3 text-3xl font-semibold"><Box className="text-teal-300"/>Bwenge 3D Labs</h1>
      <nav aria-label="Lessons" className="mb-6 flex gap-2">{[['Anatomy','heart'],['Engineering','bearing']].map(([name,id]) =>
        <a key={id} href={'/3d-labs?lesson='+id} aria-current={(engineering ? 'bearing' : 'heart') === id ? 'page' : undefined}
          className="rounded-lg border border-white/15 px-4 py-2.5 text-sm aria-[current=page]:bg-teal-200 aria-[current=page]:text-slate-950">{name}</a>)}</nav>
      <Lesson key={scene.title} scene={scene}/>
    </div>
  </main>;
}
