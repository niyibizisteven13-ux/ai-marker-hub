import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

/**
 * Shown in the message box while dictating: a pulsing dot, the time, moving sound bars, what
 * is being heard right now, and Cancel / Done. The words themselves go into the message box as they are recognised.
 */
export default function RecordingBar({ interim, onCancel, onDone }: { interim: string; onCancel: () => void; onDone: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Moving bars while listening. They do not open the microphone themselves: a second recording at the same time
  // makes voice typing fail with "no microphone" on many phones and some computers. They jump when words arrive.
  const energy = useRef(0.35);
  useEffect(() => { energy.current = 1; }, [interim]);
  useEffect(() => {
    let raf = 0;
    const bars = new Array(40).fill(0.08);
    let t = 0;
    const draw = () => {
      t++;
      energy.current = Math.max(0.25, energy.current * 0.97);
      if (t % 3 === 0) { bars.shift(); bars.push(Math.max(0.08, Math.min(1, energy.current * (0.35 + Math.random() * 0.65)))); }
      const c = canvas.current;
      if (c) {
        const g = c.getContext('2d')!;
        const w = c.width, h = c.height, step = w / bars.length;
        g.clearRect(0, 0, w, h);
        g.fillStyle = '#F0A586';
        bars.forEach((b, i) => { const bh = Math.max(3, b * h); g.fillRect(i * step + step * 0.25, (h - bh) / 2, step * 0.5, bh); });
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(1, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="mb-2 flex items-center gap-3 rounded-2xl border border-[#D97757]/30 bg-[#D97757]/[0.07] px-3 py-2" role="status" aria-live="polite">
      <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" /></span>
      <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-neutral-200">{mm}:{ss}</span>
      <canvas ref={canvas} width={240} height={28} className="hidden h-7 w-40 shrink-0 sm:block" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] italic text-neutral-400">{interim || 'Listening… speak now'}</span>
      <button type="button" onClick={onCancel} aria-label="Cancel voice input" title="Cancel" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-neutral-300 hover:bg-white/10 hover:text-white"><X size={16} /></button>
      <button type="button" onClick={onDone} aria-label="Done speaking" title="Done" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#D97757] text-white hover:bg-[#c96a4c]"><Check size={16} /></button>
    </div>
  );
}
