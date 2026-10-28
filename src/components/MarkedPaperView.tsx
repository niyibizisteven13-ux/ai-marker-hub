import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
type Sym = 'tick' | 'cross' | 'half';
export interface Item {
  id: string; kind: 'mark' | 'correction' | 'total'; questionId?: string; number?: string; page: number; fx: number; fy: number; w: number; h: number;
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

export function PageView({ examId, submissionId, page, aspect, items, selected, onSelect, onMove, editable = true }: {
  examId: string; submissionId: string; page: number; aspect?: number; items: Item[]; selected: string | null;
  editable?: boolean;
  onSelect: (id: string | null) => void; onMove: (id: string, page: number, fx: number, fy: number) => void;
}) {
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
    if (!editable) return;
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

  return (
    <div ref={box} className="relative w-full select-none overflow-hidden rounded-lg bg-white shadow-[0_10px_40px_-18px_rgba(0,0,0,.6)] ring-1 ring-black/10" style={{ height }} onPointerMove={move} onPointerUp={up} onPointerDown={() => onSelect(null)}>
      {src ? <img src={src} alt={`Page ${page}`} className="absolute inset-0 h-full w-full object-fill" onLoad={e => setImageAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} draggable={false} />
        : <div className="absolute inset-0 grid place-items-center text-sm text-neutral-400">{imageError ? <button onClick={() => setRetryImage(n => n + 1)} className="rounded border p-3">Page unavailable — retry</button> : <Loader2 className="animate-spin" size={20} />}</div>}
      <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">Page {page}</span>
      {items.filter((it) => it.page === page && it.placed && !it.hidden).map((it) => {
        const d = drag?.id === it.id ? drag : null;
        const fx = it.fx + (d?.dx ?? 0), fy = it.fy + (d?.dy ?? 0);
        const sel = selected === it.id;
        const ring = (editable ? 'touch-none ' : '') + (sel ? 'outline outline-2 outline-offset-2 outline-sky-500' : it.flagged || it.confidence?.level === 'low' ? 'outline outline-1 outline-dashed outline-offset-2 outline-orange-500' : 'hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-sky-400');
        const label = it.kind === 'mark' ? `Question ${it.number}: ${it.label || 'mark'}` : it.kind === 'correction' ? `Correction: ${it.text}` : `Total: ${it.label}`;
        const common = { role: 'button', tabIndex: 0, 'aria-label': label, 'aria-pressed': sel,
          onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSelect(it.id); } },
          onPointerDown: (e: RPointerEvent) => down(e, it), title: `${label} · ${editable ? 'Drag to move' : 'Select to review'}` };
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

