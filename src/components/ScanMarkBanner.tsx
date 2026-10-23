import { useEffect, useId, useRef } from 'react';

/**
 * Landing banner: a handwritten page is scanned with a phone, flies into Bwenge AI, is marked with red ticks and
 * crosses (a pen moves from answer to answer, the score counts up), and comes out as a marked PDF and an Excel
 * sheet. Every step is animated; a three-step tracker under the drawing follows along. Pauses off screen and
 * shows the finished frame when the visitor prefers reduced motion.
 */

const T = 14.6; // loop length, seconds
const ph = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const io = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const oo = (x: number) => 1 - Math.pow(1 - x, 3);
const bk = (x: number) => { const c = 1.70158, d = c + 1; return 1 + d * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

// Step boundaries for the tracker: scan, mark, export.
const STEPS: [number, number][] = [[0, 5], [5, 11.2], [11.2, 13.4]];
// [element, start, end] for strokes drawn on the marked page.
const MARKS: [string, number, number][] = [['k1', 7.9, 8.25], ['k2', 8.55, 8.9], ['k3', 9.2, 9.55], ['n3', 9.6, 9.95], ['k4', 10.1, 10.45]];
const MARGINS: [string, number][] = [['m1', 8.25], ['m2', 8.9], ['m3', 9.55], ['m4', 10.45]];
// Where the red pen sits while drawing each stroke (marked-page coordinates).
const PEN: [number, number, number][] = [[7.6, 466, 104], [8.25, 470, 106], [8.4, 466, 130], [8.9, 470, 132], [9.05, 466, 158], [9.55, 470, 162], [9.6, 414, 172], [9.95, 430, 174], [10.0, 466, 186], [10.45, 470, 188], [10.55, 484, 76], [11.0, 484, 76]];
const HAND = "'Segoe Script','Bradley Hand','Ink Free','Comic Sans MS',cursive";
const INK = '#2A3A8F', RED = '#D62D20';

export function ScanMarkBanner({ labels, className = '' }: { labels: { s1: string; s2: string; s3: string; mark: string; marking: string; done: string }; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const arrowId = `arw-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const textRef = useRef(labels);
  textRef.current = labels;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = (k: string) => el.querySelector<SVGElement>(`[data-k="${k}"]`)!;
    const set = (k: string, a: string, v: string | number) => q(k).setAttribute(a, String(v));
    const draw = (k: string, p: number) => { set(k, 'stroke-dashoffset', 1 - p); set(k, 'opacity', p > 0 ? 1 : 0); };
    const steps = Array.from(el.querySelectorAll<HTMLElement>('[data-step]'));

    const frame = (t: number) => {
      const out = 1 - ph(t, 13.7, 14.4);
      set('all', 'opacity', out.toFixed(3));

      // 1 · paper slides in and its handwriting is written line by line
      const pin = oo(ph(t, 0, 0.7));
      set('paper', 'transform', `translate(${(-36 * (1 - pin)).toFixed(1)} 0) rotate(-5 98 157)`);
      set('paper', 'opacity', pin.toFixed(3));
      for (let i = 0; i < 6; i++) draw(`pl${i}`, ph(t, 0.35 + i * 0.13, 0.6 + i * 0.13));

      // phone drops in over the page, scans (sweeping band, pulsing corners), flashes and confirms
      const pd = oo(ph(t, 1.0, 1.6));
      const bob = t > 1.7 && t < 3.6 ? Math.sin(t * 7) * 1.2 : 0;
      set('ph', 'transform', `translate(0 ${(-40 * (1 - pd) + bob).toFixed(2)})`);
      set('ph', 'opacity', pd.toFixed(3));
      const sw = ph(t, 1.7, 3.5);
      set('band', 'transform', `translate(0 ${(84 * io(sw)).toFixed(2)})`);
      set('band', 'opacity', (ph(t, 1.6, 1.75) * (1 - ph(t, 3.5, 3.7))).toFixed(3));
      set('corn', 'stroke', t > 3.6 ? '#F5B83D' : '#1D9E75');
      set('corn', 'opacity', t > 1.7 && t < 3.6 ? (0.55 + 0.45 * Math.abs(Math.sin(t * 6))).toFixed(2) : 1);
      const fl = ph(t, 3.55, 3.65) * (1 - ph(t, 3.65, 3.95));
      set('flash', 'opacity', (0.9 * fl).toFixed(3));
      const cp = ph(t, 3.65, 4.05);
      set('chk', 'transform', `translate(163 140) scale(${bk(cp).toFixed(3)})`);
      set('chk', 'opacity', cp > 0 ? 1 - ph(t, 4.4, 4.8) : 0);

      // 2 · the page flies along an arc into Bwenge AI, which glows as it lands
      const fp = ph(t, 4.0, 5.0), fe = io(fp);
      set('chip', 'transform', `translate(${(208 + 92 * fe).toFixed(1)} ${(150 - 34 * Math.sin(Math.PI * fe)).toFixed(1)}) rotate(${(-12 * Math.sin(Math.PI * fe)).toFixed(1)}) scale(${(1 - 0.55 * fe).toFixed(3)})`);
      set('chip', 'opacity', fp > 0 && fp < 1 ? (fp < 0.85 ? 1 : 1 - (fp - 0.85) / 0.15) : 0);
      const a1 = ph(t, 3.9, 4.1) * (1 - ph(t, 4.9, 5.2));
      set('arr1', 'opacity', (0.25 + 0.75 * a1).toFixed(2));
      set('arr1', 'stroke-dashoffset', (-t * 22).toFixed(1));
      const cs = 1 + 0.045 * Math.sin(Math.PI * ph(t, 4.9, 5.3));
      set('card', 'transform', `translate(300 150) scale(${cs.toFixed(3)}) translate(-300 -150)`);
      const halo = ph(t, 4.9, 5.6);
      set('halo', 'opacity', halo > 0 ? (0.8 * (1 - halo)).toFixed(3) : 0);
      set('halo', 'transform', `translate(300 150) scale(${(1 + 0.18 * halo).toFixed(3)}) translate(-300 -150)`);

      // cursor arrives, presses Mark (ripple), a progress bar fills while marking
      const ce = io(ph(t, 5.2, 6.0));
      set('cur', 'transform', `translate(${(352 - 30 * ce).toFixed(1)} ${(232 - 50 * ce).toFixed(1)})`);
      set('cur', 'opacity', (ph(t, 5.2, 5.4) * (1 - ph(t, 6.6, 7.0))).toFixed(3));
      const press = Math.sin(Math.PI * ph(t, 6.0, 6.3));
      set('btn', 'transform', `translate(300 182) scale(${(1 - 0.07 * press).toFixed(3)}) translate(-300 -182)`);
      const rr = ph(t, 6.0, 6.7);
      set('rip', 'r', (6 + 20 * rr).toFixed(1));
      set('rip', 'opacity', rr > 0 ? (1 - rr).toFixed(2) : 0);
      const L = textRef.current;
      const label = t < 6.1 ? L.mark : t < 11.2 ? `${L.marking}${'.'.repeat(1 + (Math.floor(t * 3) % 3))}` : `✓ ${L.done}`;
      const btnTxt = q('btnTxt');
      if (btnTxt.textContent !== label) btnTxt.textContent = label;
      set('btnR', 'fill', t >= 11.2 ? '#9FE1CB' : '#2DD4BF');
      const prog = ph(t, 6.2, 11.1);
      set('bar', 'width', (80 * prog).toFixed(1));
      set('barBg', 'opacity', t > 6.1 && t < 11.6 ? 1 - ph(t, 11.2, 11.6) : 0);
      const act = ph(t, 6.1, 6.4) * (1 - ph(t, 10.9, 11.3));
      const s1 = 0.8 + act * (0.35 + 0.35 * Math.sin(t * 5)), s2 = 0.8 + act * (0.35 + 0.35 * Math.sin(t * 5 + 2));
      set('sp1', 'transform', `translate(372 96) rotate(${(act * t * 40).toFixed(1)}) scale(${s1.toFixed(3)}) translate(-372 -96)`);
      set('sp2', 'transform', `translate(374 206) rotate(${(-act * t * 40).toFixed(1)}) scale(${s2.toFixed(3)}) translate(-374 -206)`);
      const a2 = ph(t, 6.6, 6.8) * (1 - ph(t, 7.5, 7.8));
      set('arr2', 'opacity', (0.25 + 0.75 * a2).toFixed(2));
      set('arr2', 'stroke-dashoffset', (-t * 22).toFixed(1));

      // the marked page appears; a red pen ticks each answer and writes the marks, the score counts up
      const pp = ph(t, 7.0, 7.6);
      set('op', 'transform', `translate(450 137) scale(${(0.85 + 0.15 * oo(pp)).toFixed(3)}) rotate(4) translate(-450 -137)`);
      set('op', 'opacity', pp.toFixed(3));
      for (const [k, a, b] of MARKS) draw(k, ph(t, a, b));
      for (const [k, a] of MARGINS) set(k, 'opacity', ph(t, a, a + 0.25).toFixed(3));
      draw('ring', ph(t, 10.55, 11.0));
      const score = Math.round(6 * ph(t, 10.6, 11.1));
      const tot = q('tot');
      const totText = `${score}/10`;
      if (tot.textContent !== totText) tot.textContent = totText;
      set('tot', 'opacity', ph(t, 10.55, 10.75).toFixed(3));
      let px = PEN[0][1], py = PEN[0][2];
      for (let i = 1; i < PEN.length; i++) {
        if (t >= PEN[i - 1][0] && t <= PEN[i][0]) { const e = io(ph(t, PEN[i - 1][0], PEN[i][0])); px = PEN[i - 1][1] + (PEN[i][1] - PEN[i - 1][1]) * e; py = PEN[i - 1][2] + (PEN[i][2] - PEN[i - 1][2]) * e; break; }
        if (t > PEN[i][0]) { px = PEN[i][1]; py = PEN[i][2]; }
      }
      set('pen', 'transform', `translate(${px.toFixed(1)} ${py.toFixed(1)})`);
      set('pen', 'opacity', (ph(t, 7.5, 7.7) * (1 - ph(t, 11.0, 11.3))).toFixed(3));

      // 3 · a PDF badge pops and an Excel sheet slides in, filling row by row
      const bp = ph(t, 11.2, 11.6);
      set('pdf', 'transform', `translate(406 205) scale(${bk(bp).toFixed(3)}) translate(-406 -205)`);
      set('pdf', 'opacity', bp > 0 ? 1 : 0);
      const xe = oo(ph(t, 11.4, 12.0));
      set('xl', 'transform', `translate(${(40 * (1 - xe)).toFixed(1)} 0)`);
      set('xl', 'opacity', xe.toFixed(3));
      for (let r = 0; r < 5; r++) set(`xr${r}`, 'opacity', ph(t, 11.8 + r * 0.15, 11.95 + r * 0.15).toFixed(3));
      const dl = ph(t, 12.6, 13.4);
      set('dl', 'opacity', dl > 0 ? (1 - ph(t, 13.2, 13.5)).toFixed(3) : 0);
      set('dl', 'transform', `translate(0 ${(4 * Math.abs(Math.sin(dl * Math.PI * 2))).toFixed(2)})`);

      // tracker under the drawing
      steps.forEach((s, i) => {
        const [a, b] = STEPS[i];
        const state = t >= a && t < b ? 'on' : t >= b && t < 13.7 ? 'done' : 'off';
        if (s.dataset.state !== state) s.dataset.state = state;
        const fill = s.querySelector<HTMLElement>('i > b');
        if (fill) fill.style.width = `${(100 * (state === 'done' ? 1 : state === 'on' ? ph(t, a, b) : 0)).toFixed(1)}%`;
      });
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { frame(13); return; }
    let raf = 0, visible = true, offset = 0, last = performance.now();
    const loop = (now: number) => {
      offset = (offset + Math.min(0.1, (now - last) / 1000)) % T; // no jump after the tab was hidden
      last = now;
      frame(offset);
      raf = visible ? requestAnimationFrame(loop) : 0;
    };
    const resume = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } };
    const io2 = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; resume(); }) : null;
    io2?.observe(el);
    const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else resume(); };
    document.addEventListener('visibilitychange', onVis);
    frame(0);
    resume();
    return () => { cancelAnimationFrame(raf); io2?.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const wave = (x: number, y: number, n: number, k: string, w = 1.4, a = 4, s = 8, color = INK) => (
    <path data-k={k} d={`M${x} ${y} q${a} -7 ${s} 0` + ` t${s} 0`.repeat(n)} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={0} />
  );
  const ink = (d: string, w = 1.2) => <path d={d} stroke={INK} strokeWidth={w} fill="none" strokeLinecap="round" />;
  const tick = (k: string, d: string) => <path data-k={k} d={d} stroke={RED} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1} opacity={0} />;
  const margin = (k: string, x: number, y: number, text: string) => <text data-k={k} x={x} y={y} fontSize={11} textAnchor="middle" fill={RED} opacity={0} style={{ fontFamily: HAND }}>{text}</text>;

  return (
    <div ref={root} className={`smb ${className}`}>
      <svg viewBox="0 40 680 200" role="img" aria-label={`${labels.s1}, ${labels.s2}, ${labels.s3}`}>
        <defs>
          <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#1D9E75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <g data-k="all">
          <g data-k="paper" opacity={0}>
            <rect x="50" y="95" width="96" height="124" rx="3" fill="#FBFAF5" stroke="#CFCBBE" strokeWidth="0.5" />
            <path d="M60 108 h40" stroke="#9A978C" strokeWidth="1" fill="none" />
            {wave(60, 126, 8, 'pl0')}{wave(60, 142, 6, 'pl1')}{wave(60, 158, 7, 'pl2')}{wave(60, 174, 4, 'pl3')}{wave(60, 190, 7, 'pl4')}{wave(60, 206, 3, 'pl5')}
          </g>

          <g data-k="ph" opacity={0}>
            <g transform="rotate(8 163 140)">
              <rect x="128" y="70" width="70" height="140" rx="12" fill="#26262A" stroke="#55555B" strokeWidth="0.5" />
              <rect x="134" y="82" width="58" height="116" rx="6" fill="#FBFAF5" />
              <g data-k="band"><rect x="134" y="92" width="58" height="16" fill="#9FE1CB" opacity="0.8" /><line x1="134" y1="92" x2="192" y2="92" stroke="#1D9E75" strokeWidth="2.5" /></g>
              {ink('M140 106 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}{ink('M140 120 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0')}{ink('M140 134 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
              {ink('M140 148 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}{ink('M140 162 q3 -5 6 0 t6 0 t6 0 t6 0')}{ink('M140 176 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
              <path data-k="corn" d="M140 98 V90 H148 M186 98 V90 H178 M140 182 V190 H148 M186 182 V190 H178" stroke="#1D9E75" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <rect data-k="flash" x="134" y="82" width="58" height="116" rx="6" fill="#FFFFFF" opacity={0} />
              <circle cx="163" cy="76" r="2.5" fill="#55555B" />
              <g data-k="chk" transform="translate(163 140) scale(0)" opacity={0}><circle r="14" fill="#1D9E75" /><path d="M-6 1 l4 5 l9 -11" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
            </g>
          </g>

          <path data-k="arr1" d="M205 150 H236" stroke="#1D9E75" strokeWidth="1.5" strokeDasharray="4 4" fill="none" markerEnd={`url(#${arrowId})`} opacity={0.25} />
          <g data-k="chip" opacity={0}>
            <rect x="-12" y="-15" width="24" height="30" rx="2" fill="#FBFAF5" stroke="#CFCBBE" strokeWidth="0.5" />
            <path d="M-7 -7 q2 -3 4 0 t4 0 t4 0 M-7 0 q2 -3 4 0 t4 0 t4 0 t4 0 M-7 7 q2 -3 4 0 t4 0" stroke={INK} strokeWidth="1" fill="none" strokeLinecap="round" />
          </g>

          <rect data-k="halo" x="236" y="81" width="128" height="138" rx="17" fill="none" stroke="#2DD4BF" strokeWidth="2" opacity={0} />
          <g data-k="card">
            <rect x="240" y="85" width="120" height="130" rx="14" fill="#0B1420" stroke="#2C3B52" strokeWidth="0.5" />
            <circle cx="300" cy="116" r="17" fill="#0F766E" />
            <text x="300" y="122" fontSize="18" fontWeight="600" textAnchor="middle" fill="#FFFFFF">B</text>
            <text x="300" y="152" fontSize="14" fontWeight="500" textAnchor="middle" fill="#E6F1FB">Bwenge AI</text>
            <g data-k="btn">
              <rect data-k="btnR" x="260" y="166" width="80" height="28" rx="14" fill="#2DD4BF" />
              <text data-k="btnTxt" x="300" y="185" fontSize="12.5" fontWeight="600" textAnchor="middle" fill="#04342C">{labels.mark}</text>
            </g>
            <g data-k="barBg" opacity={0}>
              <rect x="260" y="201" width="80" height="4" rx="2" fill="#1E2B3D" />
              <rect data-k="bar" x="260" y="201" width="0" height="4" rx="2" fill="#F5B83D" />
            </g>
          </g>
          <circle data-k="rip" cx="322" cy="180" r="6" fill="none" stroke="#9FE1CB" strokeWidth="1.5" opacity={0} />
          <polygon data-k="cur" points="0,0 0,22 5.5,17 9.5,26 13.5,24 9.5,15 17,15" fill="#FFFFFF" stroke="#0B1420" strokeWidth="1" strokeLinejoin="round" opacity={0} />
          <path data-k="sp1" d="M372 88 l2.5 5.5 l5.5 2.5 l-5.5 2.5 l-2.5 5.5 l-2.5 -5.5 l-5.5 -2.5 l5.5 -2.5 z" fill="#F5B83D" />
          <path data-k="sp2" d="M374 200 l1.8 4.2 l4.2 1.8 l-4.2 1.8 l-1.8 4.2 l-1.8 -4.2 l-4.2 -1.8 l4.2 -1.8 z" fill="#F5B83D" />
          <path data-k="arr2" d="M366 150 H392" stroke="#1D9E75" strokeWidth="1.5" strokeDasharray="4 4" fill="none" markerEnd={`url(#${arrowId})`} opacity={0.25} />

          <g data-k="xl" opacity={0}>
            <rect x="496" y="96" width="112" height="116" rx="6" fill="#EAF3DE" stroke="#3B6D11" strokeWidth="0.5" />
            <path d="M496 102 a6 6 0 0 1 6 -6 h100 a6 6 0 0 1 6 6 v18 h-112 z" fill="#3B6D11" />
            <text x="552" y="113" fontSize="12" fontWeight="500" textAnchor="middle" fill="#EAF3DE">marks.xlsx</text>
            <g data-k="dl" opacity={0}><path d="M598 104 v8 M594 109 l4 4 l4 -4" stroke="#EAF3DE" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>
            <path d="M496 138 H608 M496 156 H608 M496 174 H608 M496 192 H608 M566 120 V212" stroke="#97C459" strokeWidth="0.5" fill="none" />
            {[34, 30, 36, 28, 32].map((w, r) => (
              <g key={r} data-k={`xr${r}`} opacity={0}><rect x="516" y={126 + r * 18} width={w} height="6" rx="3" fill="#C0DD97" /><rect x="576" y={126 + r * 18} width="20" height="6" rx="3" fill="#97C459" /></g>
            ))}
          </g>

          <g data-k="op" opacity={0}>
            <rect x="395" y="62" width="110" height="150" rx="3" fill="#FBFAF5" stroke="#CFCBBE" strokeWidth="0.5" />
            {ink('M404 82 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0')}
            <ellipse data-k="ring" cx="484" cy="80" rx="18" ry="11" fill="none" stroke={RED} strokeWidth="1.8" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1} opacity={0} />
            <text data-k="tot" x="484" y="84" fontSize="11" textAnchor="middle" fill={RED} opacity={0} style={{ fontFamily: HAND }}>0/10</text>
            {ink('M404 110 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
            {tick('k1', 'M462 108 l3 4 l7 -9')}{margin('m1', 490, 113, '2/2')}
            {ink('M404 136 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
            {tick('k2', 'M462 134 l3 4 l7 -9')}{margin('m2', 490, 139, '2/2')}
            {ink('M404 162 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
            {tick('k3', 'M462 156 l8 8 M470 156 l-8 8')}{margin('m3', 490, 165, '0/2')}
            {wave(404, 176, 3, 'n3', 1.2, 3, 6, RED)}
            {ink('M404 192 q3 -5 6 0 t6 0 t6 0 t6 0 t6 0 t6 0')}
            {tick('k4', 'M462 190 l3 4 l7 -9')}{margin('m4', 490, 195, '2/4')}
            <g data-k="pen" opacity={0}>
              <g transform="rotate(35)"><rect x="-2.2" y="-26" width="4.4" height="20" rx="1.5" fill="#3A3F4B" /><path d="M-2.2 -6 L0 0 L2.2 -6 Z" fill={RED} /></g>
            </g>
          </g>
          <g data-k="pdf" opacity={0}><rect x="388" y="196" width="36" height="18" rx="4" fill={RED} /><text x="406" y="209" fontSize="11" fontWeight="600" textAnchor="middle" fill="#FFFFFF">PDF</text></g>
        </g>
      </svg>
      <ol className="smb-steps">
        {[labels.s1, labels.s2, labels.s3].map((s, i) => (
          <li key={i} data-step={i} data-state="off"><span><em>{i + 1}</em>{s}</span><i><b /></i></li>
        ))}
      </ol>
    </div>
  );
}
