import { useEffect, useRef, useState } from 'react';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.y-b.y);
const model = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export function HandControl({ pick, orbit }: { pick: (x: number,y: number) => void; orbit: (x: number,y: number) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const actions = useRef({ pick, orbit });
  actions.current = { pick, orbit };
  useEffect(() => {
    if (!enabled) return;
    const player = video.current!;
    let closed = false;
    let stream: MediaStream | undefined;
    let detector: HandLandmarker | undefined;
    let frame = 0;
    let previousTime = -100;
    let lastVideoTime = -1;
    let start: Point | null = null;
    let last: Point | null = null;
    let dragged = false;
    function stop() {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
      player.srcObject = null;
      detector?.close();
      detector = undefined;
      if (dot.current) dot.current.hidden = true;
    }
    function fail() {
      stop();
      setMessage('Camera or tracking model unavailable. You can still drag and tap.');
      setEnabled(false);
    }
    function tick(time: number) {
      if (closed) return;
      try {
        if (detector && player.readyState >= 2 && player.currentTime !== lastVideoTime && time-previousTime >= 65) {
          previousTime = time;
          lastVideoTime = player.currentTime;
          const hand = detector.detectForVideo(player,time).landmarks[0];
          if (dot.current) dot.current.hidden = !hand;
          if (!hand) { start = null; last = null; }
          else {
            const point = { x: 1-hand[8].x, y: hand[8].y };
            if (dot.current) { dot.current.style.left = point.x*100+'%'; dot.current.style.top = point.y*100+'%'; }
            const pinch = distance(hand[4],hand[8])/Math.max(0.01,distance(hand[5],hand[17]));
            if (pinch < (start ? 0.52 : 0.32)) {
              if (!start) { start = point; dragged = false; }
              if (distance(start,point)>0.035) dragged = true;
              if (dragged && last) actions.current.orbit(point.x-last.x,point.y-last.y);
              last = point;
            } else if (start) {
              if (!dragged) actions.current.pick(start.x,start.y);
              start = null;
              last = null;
            }
          }
        }
        frame = requestAnimationFrame(tick);
      } catch { fail(); }
    }
    function hide() { if (document.hidden) { stop(); setEnabled(false); setMessage('Camera off.'); } }
    document.addEventListener('visibilitychange',hide);
    void (async () => {
      try {
        setMessage('Starting camera…');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 } } });
        if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
        player.srcObject = stream;
        await player.play();
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        if (closed) return;
        const wasm = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
        if (closed) return;
        const instance = await HandLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:model},runningMode:'VIDEO',numHands:1});
        if (closed) { instance.close(); return; }
        detector = instance;
        setMessage('Pinch to select. Pinch and drag to rotate.');
        frame = requestAnimationFrame(tick);
      } catch { if (!closed) fail(); }
    })();
    return () => { document.removeEventListener('visibilitychange',hide); stop(); };
  },[enabled]);
  return <>
    <div ref={dot} hidden aria-hidden="true" className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-teal-400" />
    <div className="absolute right-2 top-14 flex max-w-40 flex-col items-end gap-1 text-right text-xs sm:top-2">
      <button type="button" aria-pressed={enabled} className="min-h-10 rounded-xl border border-teal-300/40 bg-slate-950/95 px-3 text-teal-200" onClick={() => { setMessage(''); setEnabled(!enabled); }}>{enabled ? 'Turn camera off' : 'Enable hand control'}</button>
      <video muted playsInline ref={video} hidden={!enabled} className="w-16 -scale-x-100 rounded" />
      {message && <span role="status" className="rounded bg-slate-950/90 p-1 text-white">{message}</span>}
    </div>
  </>;
}
