import { useEffect, useRef, useState } from 'react';

/**
 * Runs on the student's test or hand-in page, only inside MySEB. Every few seconds it tells the lecturer's live room which
 * question the student is on. If the lecturer asked for camera pictures, it first shows a plain notice and waits for the
 * student to agree; then it sends one small picture (about 5 KB) every 10 seconds. Pictures are not recorded or saved.
 */
const inMySeb = () => typeof navigator !== 'undefined' && (/MySEB\//.test(navigator.userAgent) || document.documentElement.dataset.myseb === '1');
type Cam = 'off' | 'ask' | 'on' | 'denied';

/** The question the student is looking at, read from the page: the last question heading that has reached the middle of the screen. */
function currentQuestion(total?: number): { index: number | null; total: number | null; label: string } | null {
  const labels = [...document.querySelectorAll<HTMLElement>('[id$="-label"]')];
  if (!labels.length) return null;
  const line = window.innerHeight * 0.6;
  let at = 0;
  labels.forEach((el, i) => { if (el.getBoundingClientRect().top <= line) at = i; });
  const text = (labels[at].textContent ?? '').replace(/\s+/g, ' ').trim();
  const n = /^(\d+)\.\s*/.exec(text);
  return { index: n ? Number(n[1]) : at + 1, total: total ?? (labels.length > 1 ? labels.length : null), label: text.replace(/^\d+\.\s*/, '').replace(/\*\s*\(required\)$/, '').slice(0, 120) };
}

export default function MySebLiveReporter({ kind, refId, total, status }: { kind: 'form' | 'task'; refId: string; total?: number; status?: () => string | null }) {
  const [faces, setFaces] = useState(false);
  const [cam, setCam] = useState<Cam>('off');
  const camRef = useRef<Cam>('off');
  const facesRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrame = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;   // the page's own wording (e.g. "2 files attached") without restarting the timer on every render
  const live = inMySeb();
  camRef.current = cam; facesRef.current = faces;

  useEffect(() => {
    if (!live || !refId) return;
    let stopped = false, misses = 0;
    const url = `/api/myseb/live/${kind}/${encodeURIComponent(refId)}`;
    const frame = (): string | undefined => {
      const v = videoRef.current;
      if (!v || camRef.current !== 'on' || !facesRef.current || !v.videoWidth || Date.now() - lastFrame.current < 9500) return undefined;
      const c = document.createElement('canvas'); c.width = 160; c.height = 120;
      const ctx = c.getContext('2d'); if (!ctx) return undefined;
      const r = Math.max(160 / v.videoWidth, 120 / v.videoHeight);   // fill the picture, cropping the edges
      ctx.drawImage(v, (160 - v.videoWidth * r) / 2, (120 - v.videoHeight * r) / 2, v.videoWidth * r, v.videoHeight * r);
      lastFrame.current = Date.now();
      return c.toDataURL('image/jpeg', 0.45);
    };
    const send = async () => {
      if (stopped) return;
      try {
        const q = currentQuestion(total);
        const note = statusRef.current?.();
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
          body: JSON.stringify({ question: note ? { index: null, total: null, label: note } : q, camera: camRef.current, frame: frame() }),
        });
        if (res.status === 204 || res.status === 403 || res.status === 404) { if (++misses >= 3) stopped = true; return; }   // not a MySEB test, or not allowed: stop quietly
        misses = 0;
        const b = await res.json().catch(() => ({}));
        if (typeof b.faces === 'boolean') { setFaces(b.faces); if (b.faces && camRef.current === 'off') setCam('ask'); if (!b.faces && camRef.current !== 'off') { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCam('off'); } }
      } catch { /* the heartbeat and the guard deal with real connection problems */ }
    };
    void send();
    const t = window.setInterval(send, 5000);
    return () => { stopped = true; window.clearInterval(t); streamRef.current?.getTracks().forEach((x) => x.stop()); streamRef.current = null; };
  }, [live, kind, refId, total]);

  const turnOn = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => undefined); }
      s.getVideoTracks()[0]?.addEventListener('ended', () => setCam('denied'));
      setCam('on');
    } catch { setCam('denied'); }
  };

  if (!live) return null;
  return (
    <>
      <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ position: 'fixed', width: 2, height: 2, opacity: 0, pointerEvents: 'none', bottom: 0, left: 0 }} />
      {faces && cam === 'ask' && (
        <div role="dialog" aria-label="Camera notice" className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl">
          <p className="text-sm font-bold text-slate-900">Your lecturer can see you during this test</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">A small picture from your camera is shown to your lecturer every 10 seconds, so they can see you are taking the test yourself. It is not recorded or saved anywhere. Without the camera, tell your lecturer.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={turnOn} className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">Turn on my camera</button>
          </div>
        </div>
      )}
      {faces && cam === 'denied' && (
        <div role="alert" className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 shadow-lg">
          The camera is off or blocked. Your lecturer can see that. Allow the camera for this app, or tell your lecturer.
          <button type="button" onClick={turnOn} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
    </>
  );
}
