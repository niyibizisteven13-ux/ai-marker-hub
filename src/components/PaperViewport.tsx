import React, { useRef } from 'react';

export const clampPaperZoom = (value: number) => Math.max(100, Math.min(300, Math.round(value)));

/** Pointer-based pan/pinch keeps gestures on the paper instead of dragging red annotations. */
export default function PaperViewport({ zoom, onZoom, children }: { zoom: number; onZoom: (zoom: number) => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const end = (id: number) => { pointers.current.delete(id); pinch.current = null; };
  return <div ref={box} className="scan-paper-viewport" aria-label="Scanned paper viewer" tabIndex={0}
    onKeyDown={e => { if (e.key === '+' || e.key === '=') onZoom(clampPaperZoom(zoom + 25)); if (e.key === '-') onZoom(clampPaperZoom(zoom - 25)); }}
    onPointerDown={e => {
      if (e.pointerType !== 'touch') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom };
    }}
    onPointerMove={e => {
      const previous = pointers.current.get(e.pointerId);
      if (!previous) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2 && pinch.current?.distance) onZoom(clampPaperZoom(pinch.current.zoom * distance() / pinch.current.distance));
      else if (box.current) { box.current.scrollLeft -= e.clientX - previous.x; box.current.scrollTop -= e.clientY - previous.y; }
    }}
    onPointerUp={e => end(e.pointerId)} onPointerCancel={e => end(e.pointerId)} onLostPointerCapture={e => end(e.pointerId)}>
    <div className="scan-paper-page" style={{ width: `${zoom}%`, maxWidth: zoom === 100 ? 1200 : undefined }}>{children}</div>
  </div>;
}
