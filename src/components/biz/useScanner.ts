import { useEffect, useRef, useState } from 'react';

export function useScanner(active: boolean, onCode: (text: string) => void, translate: (text: string) => string) {
  const video = useRef<HTMLVideoElement>(null); const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  const cb = useRef(onCode); cb.current = onCode;
  const tx = useRef(translate); tx.current = translate;
  useEffect(() => {
    if (!active) return; setError(''); let stop = false; let stream: MediaStream | null = null; let timer = 0; let last = ''; let lastAt = 0;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error(tx.current('This browser cannot open the camera. Type the code instead.'));
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!; v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play(); if (stop) return; setReady(true);
        const Detector = (window as any).BarcodeDetector; const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default; const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const tick = async () => {
          if (stop) return;
          try {
            let text = '';
            if (v.readyState >= 2 && v.videoWidth) {
              if (detector) { const found = await detector.detect(v); text = found[0]?.rawValue ?? ''; }
              else { const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w); canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h); text = jsQR!(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? ''; }
            }
            if (!stop && text && (text !== last || Date.now() - lastAt > 4000)) { last = text; lastAt = Date.now(); cb.current(text); }
          } catch { /* a frame that cannot be read is skipped */ }
          if (!stop) timer = window.setTimeout(tick, 220);
        };
        void tick();
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        if (!stop) { setReady(false); setError(tx.current('Allow the camera to scan passes, or type the code instead.')); }
      }
    })();
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); setReady(false); };
  }, [active]);
  return { video, error, ready };
}
