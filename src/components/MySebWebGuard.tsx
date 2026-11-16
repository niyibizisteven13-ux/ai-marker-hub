import { useEffect, useRef, useState } from 'react';
import { createFaceDetector } from '../lib/faceDetector';
import { FaceWatch, frameStatus } from '../../shared/examRules';
import { cameraErrorMessage } from '../utils/cameraErrors';

/**
 * "MySEB Web": the browser way in, for iPhones and for anyone without the app, on tests the lecturer opened to browsers.
 * A browser cannot lock a device or close other apps, so it WATCHES, and with the lecturer's strict rules (the default) it is firm:
 * leaving the page (another app, another tab, a locked screen), closing the tab, turning the camera off or taking your face out of
 * the camera for a few seconds ENDS the test on the spot. The test cannot be started a second time from the same browser.
 * The face check runs on the phone (nothing is uploaded). A weak connection is never a reason to reject: reports wait and are
 * sent when the connection returns, and the heartbeat slows down instead of failing.
 * It runs only when the browser holds a MySEB Web session (a secure cookie it cannot read itself), and says so with data-myseb so the
 * camera / screen sharing of the live room works too (it reuses this camera).
 */
type Phase = 'off' | 'active' | 'paused' | 'ended' | 'lost';
type Cam = 'none' | 'ask' | 'loading' | 'setup' | 'id' | 'ok' | 'denied';
const ASIDE_YAW = 0.5;           // a face turned this far from the camera counts as looking aside (a number for the lecturer, never a penalty)
const BAD_KEY = (e: KeyboardEvent) => {
  const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;
  if (k === 'f12' || (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(k))) return 'devtools';
  if (ctrl && ['u', 'p', 's'].includes(k)) return 'shortcut';
  return null;
};
const GRACE_MS = 5000;           // a face may be out of the picture this long (looking down to write) before the test ends
const LEFT = ['background', 'visibility_hidden', 'blur', 'fullscreen_exit'];
const STRICT_REASONS = ['face_missing', 'camera_off', 'multiple_faces', ...LEFT];
const WHY: Record<string, string> = {
  face_missing: 'Your face left the camera.', camera_off: 'Your camera was turned off.', background: 'You left the test page or closed it.',
  visibility_hidden: 'You left the test page (another app or tab).', blur: 'You left the test page.', fullscreen_exit: 'You left full screen.',
  multiple_faces: 'More than one person was in the camera.', id_refused: 'Your student card was not accepted.',
  teacher: 'Your lecturer ended your test.', time_up: 'Your time is up.', exam_ended: 'The test has ended.',
};

export default function MySebWebGuard() {
  const [phase, setPhase] = useState<Phase>('off');
  const [reason, setReason] = useState<string | null>(null);
  const [strict, setStrict] = useState(false);
  const [cam, setCam] = useState<Cam>('none');
  const [camWhy, setCamWhy] = useState('');
  const [honest, setHonest] = useState(false);              // the student accepted the honesty statement
  const [idSent, setIdSent] = useState(false);               // the student card picture is with the lecturer, waiting
  const [multi, setMulti] = useState<number | 'warn' | null>(null);   // several faces: seconds left (disqualify rule) or just a warning
  const [warn, setWarn] = useState<number | null>(null);      // seconds left before a missing face ends the test
  const [weak, setWeak] = useState(false);                    // the connection is weak: the page keeps trying, nobody is rejected for it
  const videoRef = useRef<HTMLVideoElement>(null);
  const startCamRef = useRef<() => void>(() => undefined);
  const sendIdRef = useRef<() => void>(() => undefined);
  const idStatusRef = useRef<(s: string) => void>(() => undefined);   // the heartbeat tells the page what the lecturer decided about the student card

  useEffect(() => {
    let stopped = false; let hb = 0; let hidden = 0; let blur = 0; let faceTimer = 0;
    const undo: Array<() => void> = [];
    const on = <T extends EventTarget>(t: T, ev: string, fn: (e: any) => void, cap = false) => { t.addEventListener(ev, fn, cap); undo.push(() => t.removeEventListener(ev, fn, cap)); };
    let stream: MediaStream | null = null; let detector: { close(): void } | null = null;
    (async () => {
      let path = '';
      try { path = (await (await fetch('/api/myseb/status')).json()).webJoinPath ?? ''; } catch { /* not configured */ }
      if (!path || stopped) return;
      const me = await fetch(`${path}/api/web/me`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!me?.active || stopped) return;
      document.documentElement.dataset.myseb = '1';                 // the live room's camera / screen sharing looks for this
      window.dispatchEvent(new Event('myseb-web-active'));
      const strictOn = !!me.strict;
      setStrict(strictOn);
      const multiRule: string = me.multi ?? 'warn';
      const needId = !!me.idCheck && me.idStatus !== 'approved';

      let ended = false; let canReturn = false; let asideMs = 0;
      const apply = (status: string, why?: string | null, reload = false) => {
        const next: Phase = status === 'IN_EXAM' ? 'active' : status === 'ENDED' ? 'ended' : 'paused';
        if (next === 'active' && ended) { window.location.reload(); return; }       // the lecturer let this student back in: start fresh (camera and all)
        if (next === 'ended') { ended = true; setReason(why ?? null); canReturn = !!why && ['face_missing', 'camera_off', 'multiple_faces', 'background', 'visibility_hidden', 'blur', 'fullscreen_exit'].includes(why); }
        setPhase((cur) => { if (reload && cur === 'paused' && next === 'active') window.setTimeout(() => window.location.reload(), 50); return next; });
      };
      apply(me.status, me.reason);

      const post = (route: string, body?: unknown) => fetch(`${path}/api/${route}`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
        .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) })).catch(() => null);

      // Heartbeat: every 5 s, slower (up to 15 s) while the connection is weak. A failed beat is never a violation: the server gives
      // browsers three times the usual time before it even marks a student as away.
      let misses = 0; let gap = 5000; let beating = false;
      const queue: Array<{ type: string; detail: Record<string, unknown> }> = [];
      const flush = async () => {
        while (queue.length && !ended) {
          const v = queue[0]; const r = await post('violation', v);
          if (!r) return;                                           // still offline: keep it for the next try
          queue.shift();
          if (r.json?.status) apply(r.json.status, r.json.reason);
        }
      };
      const beat = async () => {
        if (beating || stopped || (ended && !canReturn)) return; beating = true;
        const t0 = performance.now();
        const r = await post('heartbeat', strictOn && !ended ? { aside: Math.round(asideMs / 1000) } : {});
        beating = false;
        if (!r) { misses++; if (misses >= 2) setWeak(true); gap = Math.min(15000, gap + 2500); }
        else {
          misses = 0; const rtt = performance.now() - t0; setWeak(rtt > 3000); gap = rtt > 3000 ? 10000 : 5000;
          if (r.status === 401 || r.status === 403) setPhase('lost'); else if (r.json?.status) { apply(r.json.status, r.json.reason, true); if (r.json.idStatus) idStatusRef.current(r.json.idStatus); }
          if (ended && canReturn) gap = 6000;                       // waiting to see whether the lecturer lets this student back in
          void flush();
        }
        if (!stopped && (!ended || canReturn)) hb = window.setTimeout(beat, gap);
      };
      hb = window.setTimeout(beat, 1000);
      on(window, 'online', () => { setWeak(false); void flush(); void beat(); });
      on(window, 'offline', () => setWeak(true));
      // A report that cannot be sent waits in memory and goes as soon as the connection returns, so going offline is not a way to hide a violation.
      const report = async (type: string, detail: Record<string, unknown> = {}) => {
        if (ended) return;
        queue.push({ type, detail: { via: 'browser', ...detail } });
        await flush();
      };

      // Leaving the page: another tab, another app, the screen locked. A glance shorter than 1.5 s is not reported
      // (strict rules: a longer glance ends the test; closing the page does at once).
      on(document, 'visibilitychange', () => { window.clearTimeout(hidden); if (document.hidden) hidden = window.setTimeout(() => void report('visibility_hidden'), strictOn ? 0 : 1500); });   // strict: at once, no glance allowed
      on(window, 'blur', () => { window.clearTimeout(blur); blur = window.setTimeout(() => { if (!document.hasFocus() && !document.hidden) void report('blur'); }, 1500); });
      on(window, 'focus', () => window.clearTimeout(blur));
      on(window, 'pagehide', () => { void report('background'); });
      // No copying, pasting or right-click; developer-tool and print shortcuts are caught.
      for (const t of ['copy', 'cut', 'paste']) on(document, t, (e) => { e.preventDefault(); void report(t); }, true);
      on(document, 'contextmenu', (e) => e.preventDefault(), true);
      on(window, 'keydown', (e: KeyboardEvent) => { const bad = BAD_KEY(e); if (bad) { e.preventDefault(); void report(bad); } }, true);
      on(window, 'beforeunload', (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; });
      // Full screen where the browser allows it (computers; not iPhones).
      if (document.documentElement.requestFullscreen) {
        const goFull = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => undefined); };
        on(document, 'click', goFull); on(document, 'keydown', goFull);
        on(document, 'fullscreenchange', () => { if (!document.fullscreenElement) void report('fullscreen_exit'); });
      }

      // Strict rules: the camera must stay on with the student's face in it. Nothing is recorded or uploaded by this check.
      if (strictOn && me.status !== 'ENDED') {
        setCam('ask');
        startCamRef.current = async () => {
          setCam('loading'); setCamWhy('');
          try {
            stream?.getTracks().forEach((t) => t.stop());
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 12 } }, audio: false });
            (window as unknown as { __mysebCam?: MediaStream }).__mysebCam = stream;       // the live room's reporter shares this camera
            const v = videoRef.current; if (v) { v.srcObject = stream; await v.play().catch(() => undefined); }
            stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stopped && !ended) void report('camera_off'); });
          } catch (e) { setCam('denied'); setCamWhy(cameraErrorMessage(e)); return; }
          // The face model is about 10 MB the first time (then kept by the browser). On a weak connection it may be slow: say so, and if it
          // cannot load at all, the camera stays required but the face check is skipped (the lecturer is told); nobody is rejected for it.
          let det: Awaited<ReturnType<typeof createFaceDetector>> | null = null;
          try { det = await Promise.race([createFaceDetector(), new Promise<null>((r) => window.setTimeout(() => r(null), 90_000))]); } catch { det = null; }
          if (stopped || ended) { det?.close(); return; }
          // The camera is on. Before the test opens: the student card (if the lecturer asked), then the quiz. The face rules start when it opens.
          let gateOpen = false;
          const openGate = () => { gateOpen = true; setCam('ok'); watch.reset(); };
          const afterFace = () => { if (needId) setCam('id'); else openGate(); };
          idStatusRef.current = (st) => { if (st === 'approved' && !gateOpen) openGate(); };
          sendIdRef.current = async () => {
            const v = videoRef.current; if (!v || !v.videoWidth) return;
            const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(640 * v.videoHeight / v.videoWidth);
            c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);          // not mirrored: the card must read the right way round
            const r = await post('id-check', { image: c.toDataURL('image/jpeg', 0.7) });
            if (r && r.status === 200) setIdSent(true); else setCamWhy('The picture could not be sent. Check your connection and try again.');
          };
          const watch = new FaceWatch(GRACE_MS); let okSince: number | null = null; let ready = false; let multiSince: number | null = null; let multiReported = false;
          if (!det) { void report('face_check_unavailable'); afterFace(); return; }
          detector = det;
          setCam('setup');
          faceTimer = window.setInterval(() => {
            const v = videoRef.current; if (!v || !det || ended) return;
            const faces = det.detect(v, performance.now()); const status = frameStatus(faces);
            if (!ready) { if (status === 'ok') { okSince ??= Date.now(); if (Date.now() - okSince >= 1500) { ready = true; afterFace(); } } else okSince = null; return; }
            if (!gateOpen || document.hidden) return;             // waiting for the card to be approved, or the page is hidden (leaving is handled above)
            if (faces.length === 1 && faces[0].yaw !== undefined && Math.abs(faces[0].yaw) > ASIDE_YAW) asideMs += 500;   // looking well to one side: counted for the lecturer
            const { state, events } = watch.feed(status, Date.now());
            setWarn(state.state === 'warning' && state.secondsLeft < Math.ceil(GRACE_MS / 1000) ? state.secondsLeft : null);
            for (const e of events) if (e.type === 'face_lost') void report('face_missing', { seconds: e.seconds });
            // More than one person in the camera: off, a warning (recorded), or a countdown then disqualified, as the lecturer chose.
            if (status === 'multiple' && multiRule !== 'off') {
              multiSince ??= Date.now();
              if (multiRule === 'warn') { setMulti('warn'); if (!multiReported) { multiReported = true; void report('multiple_faces'); } }
              else { const left = Math.ceil((GRACE_MS - (Date.now() - multiSince)) / 1000); setMulti(Math.max(0, left)); if (left <= 0 && !multiReported) { multiReported = true; void report('multiple_faces'); } }
            } else { multiSince = null; multiReported = false; setMulti(null); }
          }, 500);
        };
      }
    })();
    return () => { stopped = true; window.clearTimeout(hb); window.clearTimeout(hidden); window.clearTimeout(blur); window.clearInterval(faceTimer); detector?.close(); undo.forEach((f) => f()); };
  }, []);

  // Once the test is over, nothing needs the camera any more.
  useEffect(() => {
    if (phase !== 'ended') return;
    const s = (window as unknown as { __mysebCam?: MediaStream }).__mysebCam; s?.getTracks().forEach((t) => t.stop());
  }, [phase]);

  if (phase === 'off') return null;
  const needCam = strict && phase === 'active' && cam !== 'ok';
  const cheat = phase === 'ended' && strict && !!reason && STRICT_REASONS.includes(reason);
  const covered = phase !== 'active' || needCam;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] bg-amber-800 px-3 py-1.5 text-center text-xs font-semibold text-amber-50">
        {strict ? 'Browser test, strict rules: stay on this page with your face in the camera. Leaving ends your test.' : 'You are taking this test in the browser (lighter security). Stay on this page.'}
        {weak && <span className="ml-2 rounded bg-amber-950/40 px-1.5 py-0.5">Weak connection: stay on this page, it keeps trying</span>}
      </div>
      {strict && phase !== 'ended' && (
        <video ref={videoRef} muted playsInline autoPlay aria-label="Your camera" className="fixed bottom-3 right-3 z-[110] h-24 w-[72px] -scale-x-100 rounded-lg border-2 border-white/70 bg-slate-900 object-cover shadow-lg" />
      )}
      {strict && phase === 'active' && cam === 'ok' && multi !== null && (
        <div role="alert" className="fixed inset-x-3 top-24 z-[105] rounded-xl bg-rose-700 p-3 text-center text-sm font-bold text-white shadow-lg">
          {multi === 'warn' ? 'More than one person is in the camera. Only you may be in view. This is recorded for your lecturer.' : `More than one person is in the camera: your test ends in ${multi} s`}
        </div>
      )}
      {strict && phase === 'active' && warn !== null && cam === 'ok' && (
        <div role="alert" className="fixed inset-x-3 top-10 z-[105] rounded-xl bg-rose-700 p-3 text-center text-sm font-bold text-white shadow-lg">Put your face back in the camera: your test ends in {warn} s</div>
      )}
      {covered && (
        <div role="alert" className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 p-6 text-center text-slate-100">
          <div className="max-w-sm space-y-3">
            {needCam ? (
              <>
                <p className="text-xl font-bold">{cam === 'id' ? 'Show your student card' : cam === 'setup' ? 'Show your face to begin' : 'Turn on your camera to begin'}</p>
                <p className="text-sm text-slate-300">
                  {cam === 'id' ? (idSent ? 'Your lecturer is looking at your card. Stay on this page: the test opens when they accept it.' : 'Hold your student card in front of the camera so your name and photo can be read, then press the button. Your lecturer sees this one picture. It is deleted as soon as they decide.')
                    : cam === 'loading' ? 'Getting ready… the first time this loads a face check (about 10 MB). It stays on your phone: nothing is recorded or sent.'
                    : cam === 'setup' ? 'Hold your phone steady and put your face in the picture in the corner. The test starts when you are seen.'
                    : cam === 'denied' ? camWhy || 'The camera is blocked. Allow it in your browser settings, then try again.'
                    : 'This test needs your camera. Your face must stay in it the whole time. Nothing is recorded or sent. If you leave the page, close it or take your face away for more than a few seconds, your test ends and you cannot start again.'}
                </p>
                {(cam === 'ask' || cam === 'denied') && (
                  <>
                    <label className="flex cursor-pointer items-start gap-2 text-left text-xs text-slate-300">
                      <input type="checkbox" checked={honest} onChange={(e) => setHonest(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
                      <span>I will do this test alone, with no other person, app, device or notes. I understand that leaving the page or breaking a rule disqualifies me, and that my lecturer can see this.</span>
                    </label>
                    <button type="button" disabled={!honest} onClick={() => startCamRef.current()} className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-slate-900 disabled:opacity-40">Turn on my camera</button>
                  </>
                )}
                {cam === 'id' && !idSent && <button type="button" onClick={() => sendIdRef.current()} className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-slate-900">Send the picture of my card</button>}
              </>
            ) : (
              <>
                <p className="text-xl font-bold">{phase === 'ended' ? (cheat ? 'You are disqualified from this quiz' : 'Your test has ended') : phase === 'lost' ? 'The connection to your test was lost' : 'Your test is paused'}</p>
                <p className="text-sm text-slate-300">
                  {phase === 'ended' ? (cheat
                    ? `${LEFT.includes(reason!) ? 'You opened another app or another tab, or left the test page.' : WHY[reason!] ?? ''} This is treated as cheating, so you are disqualified and cannot start this quiz again unless your lecturer lets you back in. Your lecturer has been told. If this is a mistake, tell them: this page continues by itself if they allow it.`
                    : `${reason && WHY[reason] ? `${WHY[reason]} ` : ''}You can close this page.`)
                    : phase === 'lost' ? 'Reload this page. If it does not come back, tell your lecturer.' : 'You left the test page, so your lecturer was told. Wait for them to let you continue.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
