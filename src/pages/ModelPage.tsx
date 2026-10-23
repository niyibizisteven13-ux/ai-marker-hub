import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { validateScene, type Scene } from '../lib/scene/spec';

const SceneViewer = lazy(() => import('../components/scene3d/SceneViewer'));

/** Full-page 3D viewer for a model link (/model?src=<signed file URL on this site>). */
export default function ModelPage() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get('src') ?? '';
    let url: URL | null = null;
    try { url = new URL(src, window.location.origin); } catch { /* invalid */ }
    // Only models stored on this site are opened.
    if (!url || url.origin !== window.location.origin) { setError('This model link is not valid.'); return; }
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(r.status === 410 ? 'This model link has expired.' : 'The model could not be loaded.'); return r.json(); })
      .then((j) => { const s = validateScene(j); setScene(s); document.title = `${s.title} · Bwenge 3D`; })
      .catch((e) => setError(e instanceof Error ? e.message : 'The model could not be loaded.'));
  }, []);
  return (
    <div className="flex h-[100dvh] flex-col bg-[#0c0f15] p-2 sm:p-4">
      {error ? <p className="m-auto text-sm text-stone-300">{error}</p>
        : !scene ? <Loader2 className="m-auto h-6 w-6 animate-spin text-stone-500" />
          : <Suspense fallback={<Loader2 className="m-auto h-6 w-6 animate-spin text-stone-500" />}><div className="min-h-0 flex-1"><SceneViewer scene={scene} fill /></div></Suspense>}
    </div>
  );
}
