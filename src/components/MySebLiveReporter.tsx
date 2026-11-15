import { useEffect, useRef, useState } from 'react';

/**
 * (Live video) When the lecturer's room is in Live mode and the student has agreed, the lecturer's browser asks to watch and this
 * page answers with a small video stream (WebRTC, sent straight to the lecturer's browser, not through our servers).
 * The microphone is only switched on while the lecturer chooses to listen to this student.
 *
 * Runs on the student's test or hand-in page, only inside MySEB. Every few seconds it tells the lecturer's live room which
 * question the student is on. If the lecturer asked for camera pictures, it first shows a plain notice and waits for the
 * student to agree; then it sends one small picture (about 5 KB) every 10 seconds. Pictures are not recorded or saved.
 */
const inMySeb = () => typeof navigator !== 'undefined' && (/MySEB\//.test(navigator.userAgent) || document.documentElement.dataset.myseb === '1');
type Cam = 'off' | 'ask' | 'on' | 'denied';
type Screen = 'off' | 'ask' | 'on' | 'denied' | 'partial';   // partial: they shared a window or tab, not the whole screen
type Source = 'camera' | 'screen' | 'both';

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
  const [liveVideo, setLiveVideo] = useState(false);
  const [sound, setSound] = useState(false);
  const [listening, setListening] = useState(false);   // the lecturer is listening to this student right now
  const liveRef = useRef(false);
  const soundRef = useRef(false);
  const haveAudio = useRef(false);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const [cam, setCam] = useState<Cam>('off');
  const camRef = useRef<Cam>('off');
  const [source, setSource] = useState<Source>('camera');
  const [screen, setScreen] = useState<Screen>('off');
  const screenRef = useRef<Screen>('off');
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const lastScreen = useRef(0);
  const facesRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrame = useRef(0);
  const closeAllRef = useRef<() => void>(() => undefined);
  const statusRef = useRef(status);
  statusRef.current = status;   // the page's own wording (e.g. "2 files attached") without restarting the timer on every render
  const live = inMySeb();
  screenRef.current = screen;
  const needCamera = faces && source !== 'screen';
  const needScreen = faces && source !== 'camera';
  camRef.current = cam; facesRef.current = faces; liveRef.current = liveVideo; soundRef.current = sound;

  useEffect(() => {
    if (!live || !refId) return;
    let stopped = false, misses = 0;
    const url = `/api/myseb/live/${kind}/${encodeURIComponent(refId)}`;
    const closeAll = () => { pcs.current.forEach((pc) => pc.close()); pcs.current.clear(); };
    closeAllRef.current = closeAll;
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
    const screenFrame = (): string | undefined => {
      const v = screenVideoRef.current;
      if (!v || screenRef.current !== 'on' || !v.videoWidth || Date.now() - lastScreen.current < 4500) return undefined;
      const c = document.createElement('canvas'); c.width = 400; c.height = 225;
      const ctx = c.getContext('2d'); if (!ctx) return undefined;
      ctx.drawImage(v, 0, 0, 400, 225);
      lastScreen.current = Date.now();
      return c.toDataURL('image/jpeg', 0.5);
    };
    const stopCamera = () => { closeAll(); streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; haveAudio.current = false; setCam('off'); };
    const stopScreen = () => { closeAll(); screenStreamRef.current?.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; setScreen('off'); };
    const send = async () => {
      if (stopped) return;
      try {
        const q = currentQuestion(total);
        const note = statusRef.current?.();
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: true,
          body: JSON.stringify({ question: note ? { index: null, total: null, label: note } : q, camera: camRef.current, frame: frame(), screen: screenFrame(), screenState: screenRef.current }),
        });
        if (res.status === 204 || res.status === 403 || res.status === 404) { if (++misses >= 3) stopped = true; return; }   // not a MySEB test, or not allowed: stop quietly
        misses = 0;
        const b = await res.json().catch(() => ({}));
        if (typeof b.faces === 'boolean') {
          // A phone's in-app browser cannot share its screen: it shows its camera instead, and that is never counted against the student.
          const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
          const src: Source = (b.source === 'screen' || b.source === 'both') && canShare ? b.source : 'camera';
          setFaces(b.faces); setLiveVideo(!!b.live); setSound(!!b.sound); setSource(src);
          const wantCam = b.faces && src !== 'screen', wantScreen = b.faces && src !== 'camera';
          if (wantCam && camRef.current === 'off') setCam('ask');
          else if (wantCam && camRef.current === 'on' && b.sound && !haveAudio.current) setCam('ask');   // the lecturer added sound after the student agreed to video: ask again
          if (wantScreen && screenRef.current === 'off') setScreen('ask');
          if (!wantCam && camRef.current !== 'off') stopCamera();
          if (!wantScreen && screenRef.current !== 'off') stopScreen();
        }
      } catch { /* the heartbeat and the guard deal with real connection problems */ }
    };
    void send();
    const t = window.setInterval(send, 5000);
    return () => { stopped = true; window.clearInterval(t); closeAll(); streamRef.current?.getTracks().forEach((x) => x.stop()); streamRef.current = null; screenStreamRef.current?.getTracks().forEach((x) => x.stop()); screenStreamRef.current = null; };
  }, [live, kind, refId, total]);

  // Live video: answer the lecturer's "watch" with a small stream.
  useEffect(() => {
    if (!live || !refId || !liveVideo || !(needCamera || needScreen) || (needCamera && cam !== 'on') || (needScreen && screen !== 'on')) return;
    let stopped = false;
    const ac = new AbortController();
    const base = `/api/myseb/live/${kind}/${encodeURIComponent(refId)}`;
    const send = (msg: Record<string, unknown>) => fetch(`${base}/signal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ msg }) }).catch(() => undefined);
    let ice: RTCIceServer[] | null = null;
    const iceServers = async () => { if (!ice) { try { ice = (await (await fetch(`${base}/ice`, { credentials: 'same-origin' })).json()).iceServers ?? []; } catch { ice = []; } } return ice!; };
    const close = (viewer: string) => { pcs.current.get(viewer)?.close(); pcs.current.delete(viewer); };

    const handle = async (m: any) => {
      const viewer = String(m.viewer || 'v');
      if (m.type === 'watch') {
        const stream = needCamera ? streamRef.current : null;
        const shared = needScreen ? screenStreamRef.current : null;
        if (!stream && !shared) return;
        close(viewer);
        if (pcs.current.size >= 2) return;                                 // at most two lecturer tabs watching one student
        const pc = new RTCPeerConnection({ iceServers: await iceServers() });
        pcs.current.set(viewer, pc);
        stream?.getTracks().forEach((t) => pc.addTrack(t, stream));
        shared?.getTracks().forEach((t) => pc.addTrack(t, shared));
        pc.getSenders().forEach((snd) => { if (snd.track?.kind === 'video') { const p = snd.getParameters(); const isScreen = !!shared && shared.getVideoTracks().includes(snd.track); p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: isScreen ? 250_000 : 150_000, maxFramerate: isScreen ? 3 : 8 }]; snd.setParameters(p).catch(() => undefined); } });
        pc.onicecandidate = (e) => { if (e.candidate) void send({ type: 'ice', viewer, candidate: e.candidate.toJSON() }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') close(viewer); };
        await pc.setLocalDescription(await pc.createOffer());
        await send({ type: 'offer', viewer, sdp: pc.localDescription?.sdp, ...(shared ? { screenStream: shared.id } : {}) });
      } else if (m.type === 'answer') {
        const pc = pcs.current.get(viewer); if (pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      } else if (m.type === 'ice') {
        const pc = pcs.current.get(viewer); if (pc && m.candidate) await pc.addIceCandidate(m.candidate).catch(() => undefined);
      } else if (m.type === 'unwatch') {
        close(viewer);
      } else if (m.type === 'listen') {
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = m.on === true; });
        setListening(m.on === true && (streamRef.current?.getAudioTracks().length ?? 0) > 0);
      }
    };
    (async () => {
      let after = 0;
      while (!stopped) {
        try {
          const res = await fetch(`${base}/signal?after=${after}`, { credentials: 'same-origin', signal: ac.signal });
          if (res.status === 204) { await new Promise((r) => setTimeout(r, 3000)); continue; }
          const b = await res.json(); after = b.next ?? after;
          for (const m of b.msgs ?? []) await handle(m).catch(() => undefined);
        } catch { if (stopped) return; await new Promise((r) => setTimeout(r, 2000)); }
      }
    })();
    return () => { stopped = true; ac.abort(); pcs.current.forEach((pc) => pc.close()); pcs.current.clear(); streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; }); setListening(false); };
  }, [live, kind, refId, liveVideo, cam, screen, needCamera, needScreen]);

  const turnOnCamera = async () => {
    try {
      const wantAudio = soundRef.current && liveRef.current;
      closeAllRef.current();                                   // peers hold the old tracks: the lecturer's room reconnects on its own
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } }, audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false });
      s.getAudioTracks().forEach((t) => { t.enabled = false; });   // silent until the lecturer chooses to listen to this student
      haveAudio.current = s.getAudioTracks().length > 0;
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => undefined); }
      s.getVideoTracks()[0]?.addEventListener('ended', () => setCam('denied'));
      setCam('on');
    } catch { setCam('denied'); }
  };
  /** The whole screen, never a window or a tab: the lecturer must see what the student sees. */
  const turnOnScreen = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: { ideal: 3, max: 5 }, width: { max: 1600 } } as MediaTrackConstraints, audio: false });
      const track = s.getVideoTracks()[0];
      const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
      if (!track || (surface && surface !== 'monitor')) { s.getTracks().forEach((t) => t.stop()); setScreen('partial'); return; }
      closeAllRef.current();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = s;
      if (screenVideoRef.current) { screenVideoRef.current.srcObject = s; await screenVideoRef.current.play().catch(() => undefined); }
      track.addEventListener('ended', () => setScreen('denied'));
      setScreen('on');
    } catch { setScreen('denied'); }
  };
  const startSharing = async () => {
    if (needScreen && screenRef.current !== 'on') await turnOnScreen();   // the screen first: the browser wants this to come straight from the click
    if (needCamera && camRef.current !== 'on') await turnOnCamera();
  };

  if (!live) return null;
  return (
    <>
      <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" style={{ position: 'fixed', width: 2, height: 2, opacity: 0, pointerEvents: 'none', bottom: 0, left: 0 }} />
      <video ref={screenVideoRef} muted playsInline autoPlay aria-hidden="true" style={{ position: 'fixed', width: 2, height: 2, opacity: 0, pointerEvents: 'none', bottom: 0, left: 8 }} />
      {screen === 'on' && (
        <div role="status" className="fixed left-3 top-3 z-[80] flex items-center gap-2 rounded-full bg-slate-900/90 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg">
          <span className="h-2 w-2 rounded-full bg-rose-500" />Your screen is shared with your lecturer
        </div>
      )}
      {((needCamera && cam === 'ask') || (needScreen && screen === 'ask')) && (
        <div role="dialog" aria-label="Camera notice" className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-2xl">
          <p className="text-sm font-bold text-slate-900">{source === 'camera' ? (liveVideo ? 'Your lecturer can watch you during this test' : 'Your lecturer can see you during this test') : source === 'screen' ? 'Your lecturer can see your screen during this test' : 'Your lecturer can see your screen and your camera during this test'}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            {source !== 'camera' && 'Your whole screen is shown to your lecturer, including anything else that is open on it. Close private messages and other windows first, and choose "Entire screen" if you are asked. If you stop sharing, it counts as leaving the test. '}
            {source !== 'screen' && (liveVideo
              ? `Your camera is shown live to your lecturer, so they can see you are taking the test yourself.${sound ? ' Your microphone stays silent unless your lecturer chooses to listen to you, and you will see a notice when they do.' : ''} `
              : 'A small picture from your camera is shown to your lecturer every 10 seconds, so they can see you are taking the test yourself. ')}
            Nothing is recorded or saved anywhere. Without {source === 'camera' ? 'the camera' : 'sharing'}, tell your lecturer.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={startSharing} className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white">{source === 'screen' ? 'Share my screen' : source === 'both' ? 'Share my screen and camera' : 'Turn on my camera'}</button>
          </div>
        </div>
      )}
      {listening && (
        <div role="status" className="fixed right-3 top-3 z-[80] flex items-center gap-2 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />Your lecturer is listening
        </div>
      )}
      {needCamera && cam === 'denied' && (
        <div role="alert" className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 shadow-lg">
          The camera is off or blocked. Your lecturer can see that. Allow the camera for this app, or tell your lecturer.
          <button type="button" onClick={turnOnCamera} className="ml-2 font-semibold underline">Try again</button>
        </div>
      )}
      {needScreen && (screen === 'denied' || screen === 'partial') && (
        <div role="alert" className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-900 shadow-lg">
          {screen === 'partial' ? 'You shared a window or a tab. Please share your entire screen.' : 'Your screen is not being shared. Your lecturer can see that, and it counts as leaving the test.'}
          <button type="button" onClick={turnOnScreen} className="ml-2 font-semibold underline">Share my screen</button>
        </div>
      )}
    </>
  );
}
