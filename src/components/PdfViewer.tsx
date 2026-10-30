import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';

/**
 * Sharp in-chat PDF pages (pdf.js), for scanned and handwritten scripts and marked papers: pages are drawn at
 * the screen's pixel density and re-drawn when zooming, so faint handwriting and red marks stay crisp.
 * Pages render only when scrolled into view.
 */

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => Promise<void> };
let pdfjs: Promise<any> | null = null;
export async function loadPdfJs() {
  pdfjs ??= (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjs;
}

function Page({ doc, n, width, zoom }: { doc: PdfDoc; n: number; width: number; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [ratio, setRatio] = useState(1.414);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !width) return;
    let task: any = null;
    let live = true;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (!live) return;
      setRatio(base.height / base.width);
      const cssW = width * zoom;
      const scale = (cssW / base.width) * Math.min(3, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale });
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      task = page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => undefined);
    })().catch(() => undefined);
    return () => { live = false; task?.cancel?.(); };
  }, [doc, n, width, zoom, visible]);

  return (
    <div ref={box} className="relative mx-auto bg-white shadow-md" style={{ width: width * zoom, height: width * zoom * ratio }}>
      <canvas ref={canvas} className="block h-full w-full" />
      <span className="absolute bottom-1.5 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{n}</span>
    </div>
  );
}

export function PdfViewer({ url, name, tall }: { url: string; name: string; tall?: boolean }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let live = true;
    let loaded: PdfDoc | null = null;
    (async () => {
      const lib = await loadPdfJs();
      loaded = await lib.getDocument({ url, isEvalSupported: false }).promise;
      if (live) setDoc(loaded); else void loaded?.destroy();
    })().catch(() => { if (live) setError('This PDF could not be shown here. Download it instead.'); });
    return () => { live = false; void loaded?.destroy(); };
  }, [url]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  const body = (
    <div className={`flex flex-col ${full ? 'h-full' : ''}`}>
      <div className="flex items-center gap-1.5 px-1 pb-2 text-xs text-stone-400">
        <span className="min-w-0 flex-1 truncate">{doc ? `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}` : ' '}</span>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="rounded-md p-1.5 hover:bg-stone-800 hover:text-white"><ZoomOut className="h-4 w-4" /></button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} className="rounded-md p-1.5 hover:bg-stone-800 hover:text-white"><ZoomIn className="h-4 w-4" /></button>
        <button type="button" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)} className="rounded-md p-1.5 hover:bg-stone-800 hover:text-white">{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
        <a href={url} download={name} aria-label={`Download ${name}`} className="rounded-md p-1.5 hover:bg-stone-800 hover:text-white"><Download className="h-4 w-4" /></a>
      </div>
      <div ref={area} className={`overflow-auto rounded-lg bg-stone-800/60 p-3 ${full ? 'flex-1' : tall ? 'max-h-[80vh]' : 'max-h-[520px]'}`}>
        {error ? <p className="p-3 text-sm text-red-300">{error}</p>
          : !doc ? <div className="flex h-40 items-center justify-center text-stone-500"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
            : <div className="flex flex-col gap-3">{Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} width={width} zoom={zoom} />)}</div>}
      </div>
    </div>
  );
  if (!full) return body;
  return <div role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-[100] bg-black/90 p-3 sm:p-6">{body}</div>;
}
