import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, KeyboardEvent, ElementType } from 'react';
import { Check, Circle, Highlighter, Loader2, MousePointer2, RectangleHorizontal, Trash2, Type, Underline, X as XIcon } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
type Sym = 'tick' | 'cross' | 'half';
export interface Item {
  id: string; kind: 'mark' | 'correction' | 'total' | 'note' | 'stamp' | 'underline' | 'circle' | 'box' | 'highlight'; own?: boolean; questionId?: string; number?: string; page: number; fx: number; fy: number; w: number; h: number;
  placed: boolean; auto: boolean; hidden: boolean; symbols?: Sym[]; label?: string; text?: string; flagged?: boolean;
  confidence?: { level: 'high' | 'medium' | 'low'; score: number; basis: string[] } | null;
}
const RED = '#D61C17';
const SYMBOL = 0.024, GAP = 0.006, LABEL_CHAR = 0.0125, NOTE_CHAR = 0.0115;
function SymbolSvg({ kind, size }: { kind: Sym; size: number }) {
  const sw = Math.max(1.6, size / 8);
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" style={{ overflow: 'visible' }}>
      {kind === 'cross'
        ? <path d="M1 1 L9 9 M1 9 L9 1" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" fill="none" />
        : <>
          <path d="M0 5.5 L3.5 9.2 L10 0.5" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {kind === 'half' && <path d="M4.5 3.8 L9.2 6.2" stroke={RED} strokeWidth={(sw * 10) / size} strokeLinecap="round" fill="none" />}
        </>}
    </svg>
  );
}

export type PenTool = 'select' | 'tick' | 'cross' | 'circle' | 'box' | 'highlight' | 'underline' | 'note';
export interface PenActions {
  add: (m: { page: number; kind: Exclude<PenTool, 'select'>; x0: number; y0: number; x1?: number; y1?: number; text?: string }) => Promise<void>;
  remove: (penId: string) => Promise<void>;
}

/** Saves the teacher's pen marks through the API and hands back the updated review. */
export function penActions(examId: string, submissionId: string, onReview: (review: any) => void): PenActions {
  const call = async (url: string, init: RequestInit) => {
    const res = await authFetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'The mark could not be saved.');
    onReview(body);
  };
  return {
    add: (m) => call(`/api/exams/${examId}/submissions/${submissionId}/pen`, { method: 'POST', body: JSON.stringify(m) }),
    remove: (id) => call(`/api/exams/${examId}/submissions/${submissionId}/pen/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

const TOOLS: Array<{ tool: PenTool; label: string; icon: ElementType }> = [
  { tool: 'select', label: 'Select and move', icon: MousePointer2 }, { tool: 'tick', label: 'Tick', icon: Check }, { tool: 'cross', label: 'Cross', icon: XIcon },
  { tool: 'circle', label: 'Circle', icon: Circle }, { tool: 'box', label: 'Box', icon: RectangleHorizontal }, { tool: 'highlight', label: 'Highlight', icon: Highlighter },
  { tool: 'underline', label: 'Underline', icon: Underline }, { tool: 'note', label: 'Write a note', icon: Type },
];

export function PageView({ examId, submissionId, page, aspect, items, selected, onSelect, onMove, editable = true, pen }: {
  examId: string; submissionId: string; page: number; aspect?: number; items: Item[]; selected: string | null;
  editable?: boolean;
  onSelect: (id: string | null) => void; onMove: (id: string, page: number, fx: number, fy: number) => void;
  /** Pen tools on this page (draw ticks, crosses, circles, boxes, highlights, underlines and notes). */
  pen?: PenActions;
}) {
  const [tool, setTool] = useState<PenTool>('select');
  const [sketch, setSketch] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [penBusy, setPenBusy] = useState(false);
  const [penError, setPenError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 800 : Math.min(800, window.innerWidth));
  const deliveryWidth = width > 1100 ? 2200 : width > 600 ? 1600 : 1000;
  const [imageAspect, setImageAspect] = useState(1.414);
  const [imageError, setImageError] = useState(false);
  const [retryImage, setRetryImage] = useState(0);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; sx: number; sy: number } | null>(null);

  useEffect(() => {
    let url: string | null = null;
    const controller = new AbortController();
    setSrc(null); setImageError(false);
    (async () => {
      const res = await authFetch(`/api/exams/${examId}/submissions/${submissionId}/pages/${page}?width=${deliveryWidth}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Page unavailable');
      const blob = await res.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSrc(url);
    })().catch(() => { if (!controller.signal.aborted) setImageError(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [examId, submissionId, page, retryImage, deliveryWidth]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = width * (aspect ?? imageAspect);
  const down = (e: RPointerEvent, it: Item) => {
    e.stopPropagation();
    onSelect(it.id);
    if (!editable || it.own) return; // the teacher's own pen marks are removed and redrawn, not dragged
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: it.id, dx: 0, dy: 0, sx: e.clientX, sy: e.clientY });
  };
  const move = (e: RPointerEvent) => { if (drag) setDrag({ ...drag, dx: (e.clientX - drag.sx) / width, dy: (e.clientY - drag.sy) / height }); };
  const up = () => {
    if (!drag) return;
    const it = items.find((x) => x.id === drag.id);
    if (it && (Math.abs(drag.dx) > 0.002 || Math.abs(drag.dy) > 0.002)) onMove(it.id, page, Math.min(1, Math.max(0, it.fx + drag.dx)), Math.min(1, Math.max(0, it.fy + drag.dy)));
    setDrag(null);
  };

  // Pen tools: tick, cross and note go where you click; circle, box, highlight and underline follow a drag.
  const at = (e: RPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const save = async (m: Parameters<PenActions['add']>[0]) => {
    if (!pen) return;
    setPenBusy(true); setPenError(null);
    try { await pen.add(m); } catch (err) { setPenError(err instanceof Error ? err.message : 'The mark could not be saved.'); } finally { setPenBusy(false); }
  };
  const pagePointerDown = (e: RPointerEvent) => {
    if (!pen || tool === 'select') { onSelect(null); return; }
    const p = at(e);
    if (tool === 'tick' || tool === 'cross') { void save({ page, kind: tool, x0: Math.max(0, p.x - SYMBOL / 2), y0: Math.max(0, p.y - SYMBOL / 2) }); return; }
    if (tool === 'note') {
      const text = window.prompt('Note to write on the paper:')?.trim();
      if (text) void save({ page, kind: 'note', x0: p.x, y0: p.y, text });
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSketch({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const pageMove = (e: RPointerEvent) => { if (sketch) { const p = at(e); setSketch({ ...sketch, x1: p.x, y1: p.y }); } else move(e); };
  const pageUp = () => {
    if (!sketch) { up(); return; }
    const s0 = sketch;
    setSketch(null);
    if (Math.abs(s0.x1 - s0.x0) < 0.01 && Math.abs(s0.y1 - s0.y0) < 0.005) return;
    if (tool !== 'select' && tool !== 'tick' && tool !== 'cross' && tool !== 'note') void save({ page, kind: tool, x0: s0.x0, y0: s0.y0, x1: s0.x1, y1: s0.y1 });
  };
  const sel = selected ? items.find((i) => i.id === selected && i.page === page && i.own) : undefined;

  return (
    <div ref={box} className={`relative w-full select-none overflow-hidden rounded-lg bg-white shadow-[0_10px_40px_-18px_rgba(0,0,0,.6)] ring-1 ring-black/10 ${pen && tool !== 'select' ? 'cursor-crosshair touch-none' : ''}`} style={{ height }} onPointerMove={pageMove} onPointerUp={pageUp} onPointerDown={pagePointerDown}>
      {pen && (
        <div role="toolbar" aria-label="Pen tools" onPointerDown={(e) => e.stopPropagation()} className="absolute right-2 top-2 z-20 flex flex-wrap items-center gap-0.5 rounded-xl bg-black/70 p-1 shadow-lg backdrop-blur">
          {TOOLS.map(({ tool: t, label, icon: Icon }) => (
            <button key={t} type="button" title={label} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}
              className={`grid h-7 w-7 place-items-center rounded-lg ${tool === t ? 'bg-white text-[#D61C17]' : 'text-white/85 hover:bg-white/15'}`}><Icon size={15} /></button>
          ))}
          {penBusy && <Loader2 size={14} className="mx-1 animate-spin text-white" />}
        </div>
      )}
      {penError && <span role="alert" className="absolute bottom-2 left-2 z-20 rounded bg-rose-600 px-2 py-1 text-[11px] text-white">{penError}</span>}
      {sketch && (() => {
        const x0 = Math.min(sketch.x0, sketch.x1), y0 = Math.min(sketch.y0, sketch.y1), w = Math.abs(sketch.x1 - sketch.x0), h = Math.abs(sketch.y1 - sketch.y0);
        return <div aria-hidden="true" className="pointer-events-none absolute z-10" style={{ left: x0 * width, top: y0 * height, width: w * width, height: tool === 'underline' ? 2 : h * height, border: tool === 'highlight' ? 'none' : `2px dashed ${RED}`, borderRadius: tool === 'circle' ? '50%' : 4, background: tool === 'highlight' ? 'rgba(255,219,51,.35)' : 'transparent', marginTop: tool === 'underline' ? h * height : 0 }} />;
      })()}
      {sel && pen && (
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => { const id = sel.id.replace(/^pen:/, ''); setPenBusy(true); void pen.remove(id).catch((err) => setPenError(err instanceof Error ? err.message : 'Could not remove.')).finally(() => setPenBusy(false)); onSelect(null); }}
          className="absolute z-20 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white shadow" style={{ left: Math.min(width - 80, sel.fx * width), top: Math.max(0, sel.fy * height - 30) }}>
          <Trash2 size={12} /> Remove
        </button>
      )}
      {src ? <img src={src} alt={`Page ${page}`} className="absolute inset-0 h-full w-full object-fill" onLoad={e => setImageAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} draggable={false} />
        : <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">{imageError ? <button onClick={() => setRetryImage(n => n + 1)} className="rounded border p-3">Page unavailable — retry</button> : <Loader2 className="animate-spin" size={20} />}</div>}
      <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Page {page}</span>
      {items.filter((it) => it.page === page && it.placed && !it.hidden).map((it) => {
        const d = drag?.id === it.id ? drag : null;
        const fx = it.fx + (d?.dx ?? 0), fy = it.fy + (d?.dy ?? 0);
        const sel = selected === it.id;
        const ring = (editable ? 'touch-none ' : '') + (sel ? 'outline outline-2 outline-offset-2 outline-sky-500' : it.flagged || it.confidence?.level === 'low' ? 'outline outline-1 outline-dashed outline-offset-2 outline-orange-500' : 'hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-sky-400');
        const label = it.kind === 'mark' ? `Question ${it.number}: ${it.label || 'mark'}` : it.kind === 'correction' ? `Correction: ${it.text}` : it.kind === 'note' ? `Note: ${it.text}`
          : it.kind === 'total' ? `Total: ${it.label}` : `${it.own ? 'Your' : 'AI'} ${it.kind === 'stamp' ? (it.symbols?.[0] ?? 'mark') : it.kind}${it.number ? ` (question ${it.number})` : ''}`;
        const common = { role: 'button', tabIndex: 0, 'aria-label': label, 'aria-pressed': sel,
          onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(it.id); } },
          onPointerDown: (e: RPointerEvent) => down(e, it), title: `${label} · ${editable ? 'Drag to move' : 'Select to review'}` };
        if (it.kind === 'circle' || it.kind === 'box' || it.kind === 'highlight') {
          return <div key={it.id} {...common} className={`absolute cursor-pointer ${ring}`} style={{ left: it.fx * width, top: it.fy * height, width: it.w * width, height: it.h * height,
            border: it.kind === 'highlight' ? 'none' : `2px solid ${RED}`, borderRadius: it.kind === 'circle' ? '50%' : 3, background: it.kind === 'highlight' ? 'rgba(255,219,51,.38)' : 'transparent' }} />;
        }
        if (it.kind === 'note') {
          const fs = Math.max(8, (NOTE_CHAR / 0.5) * width);
          return <div key={it.id} {...common} className={`absolute cursor-pointer whitespace-nowrap italic leading-none ${ring}`} style={{ left: fx * width, top: fy * height, transform: 'translateY(-50%)', color: RED, fontSize: fs, fontFamily: 'Helvetica, Arial, sans-serif' }}>{it.text}</div>;
        }
        if (it.kind === 'stamp') {
          const size = Math.max(8, SYMBOL * width);
          return <div key={it.id} {...common} className={`absolute cursor-pointer ${ring}`} style={{ left: it.fx * width, top: it.fy * height }}>{(it.symbols ?? []).map((sy, i) => <SymbolSvg key={i} kind={sy} size={size} />)}</div>;
        }
        if (it.kind === 'underline') {
          // Red underline under the working that lost marks; selectable like the other marks.
          return <div key={it.id} {...common} className={`absolute cursor-pointer ${ring}`} style={{ left: fx * width, top: fy * height - 3, width: it.w * width, height: 6, borderBottom: `2px solid ${RED}`, borderRadius: 2 }} />;
        }
        if (it.kind === 'total') {
          const fs = Math.max(9, 0.03 * width);
          return (
            <div key={it.id} {...common} className={`absolute flex ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} items-center justify-center rounded-[50%] ${ring}`}
              style={{ left: (fx - it.w / 2) * width, top: (fy - it.h / 2) * height, width: it.w * width, height: it.h * height, border: `2px solid ${RED}`, color: RED, fontWeight: 700, fontSize: fs }}>
              {it.label}
            </div>
          );
        }
        if (it.kind === 'correction') {
          const fs = Math.max(8, (NOTE_CHAR / 0.5) * width);
          return (
            <div key={it.id} {...common} className={`absolute ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} whitespace-nowrap italic leading-none ${ring}`}
              style={{ left: fx * width, top: fy * height, transform: 'translateY(-50%)', color: RED, fontSize: fs, fontFamily: 'Helvetica, Arial, sans-serif' }}>
              {it.text}
            </div>
          );
        }
        const size = Math.max(8, SYMBOL * width);
        const fs = Math.max(7.5, (LABEL_CHAR / 0.56) * width);
        return (
          <div key={it.id} {...common} className={`absolute flex ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} items-center ${ring}`} style={{ left: fx * width, top: fy * height, transform: 'translateY(-50%)', gap: GAP * width }}>
            {(it.symbols ?? []).map((s, i) => <SymbolSvg key={i} kind={s} size={size} />)}
            <span style={{ color: RED, fontWeight: 700, fontSize: fs, marginLeft: size * 0.3 - GAP * width, fontFamily: 'Helvetica, Arial, sans-serif' }}>{it.label}</span>
            {(it.flagged || it.confidence?.level === 'low') && <span className="ml-1 grid h-4 w-4 place-items-center rounded-full border border-orange-500 text-[10px] font-bold text-orange-500">?</span>}
          </div>
        );
      })}
    </div>
  );
}

