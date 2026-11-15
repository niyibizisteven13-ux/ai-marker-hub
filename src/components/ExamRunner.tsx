import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Clock, Pause, ShieldCheck, TriangleAlert } from 'lucide-react';
import DynamicForm from './DynamicForm';
import { FaceWatch, frameStatus, normalizeExam, type FrameStatus, type WatchState } from '../../shared/examRules';
import { createFaceDetector, type FaceDetector } from '../lib/faceDetector';

/**
 * A timed test on the student's side. The clock belongs to the server: this page asks for the time left every few
 * seconds and only displays it. Before the start the student gives their registration number and, when the test has
 * a camera rule, shows their face in the frame once; then the clock starts. During the test the camera watches only
 * whether a face is in the frame (on this device; no picture is sent or stored). A short look away is a countdown;
 * a long one is reported, and with the "pause" rule the test stops until the lecturer resumes it.
 * When the time is up the page sends what the student has.
 */

interface SessionView {
  id: string; status: 'running' | 'paused' | 'submitted' | 'ended'; serverNow: number; remainingMs: number; totalMs: number; endsAt: number | null;
  pause: { by: 'student' | 'system' | 'lecturer'; reason: string } | null; camera: 'off' | 'warn' | 'pause'; graceSeconds: number; studentName: string;
  accommodations: { largeText: boolean; voiceAnswers: boolean; breaks: boolean; cameraExempt: boolean; extraTimePercent: number } | null;
  secret?: string;
}
type Props = { schema: any; uploadFile?: React.ComponentProps<typeof DynamicForm>['uploadFile']; onSubmit: (answers: any) => Promise<any> };

const BASE = '/api/form-exams/public';
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : '')}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`; };
const store = {
  get(id: string): { sid: string; secret: string } | null { try { return JSON.parse(sessionStorage.getItem(`exam:${id}`) || 'null'); } catch { return null; } },
  set(id: string, v: { sid: string; secret: string }) { try { sessionStorage.setItem(`exam:${id}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6';
const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300';
const FRAME_HELP: Record<FrameStatus, string> = { ok: 'Your face is in the frame.', no_face: 'No face found. Look at the camera.', partial: 'Move back so your whole face is in the frame.', multiple: 'Only you should be in the frame.' };

export default function ExamRunner({ schema, uploadFile, onSubmit }: Props) {
  const formId: string = schema.id;
  const exam = useMemo(() => normalizeExam(schema.exam), [schema.exam]);
  const [studentId, setStudentId] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [view, setView] = useState<SessionView | null>(null);
  const [phase, setPhase] = useState<'intro' | 'setup' | 'running'>('intro');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [watch, setWatch] = useState<WatchState | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [camTry, setCamTry] = useState(0);

  const sess = useRef<{ sid: string; secret: string } | null>(null);
  const offset = useRef(0);
  const controlRef = useRef<{ submitNow: () => Promise<void> } | null>(null);
  const submitted = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(sess.current ? { 'x-exam-token': sess.current.secret } : {}), ...(init.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'Something went wrong. Try again.'), { code: body.code, status: res.status });
    return body;
  }, []);
  const accept = useCallback((v: SessionView) => { offset.current = v.serverNow - Date.now(); setView((cur) => ({ ...(cur ?? {}), ...v } as SessionView)); return v; }, []);
  const sendEvent = useCallback((type: string, seconds?: number) => {
    if (!sess.current) return;
    void call(`/session/${sess.current.sid}/event`, { method: 'POST', body: JSON.stringify({ type, seconds }) }).then(accept).catch(() => undefined);
  }, [call, accept]);

  // Back on the page after a refresh: the session is still there (the clock never stopped).
  useEffect(() => {
    const saved = store.get(formId);
    if (!saved) return;
    sess.current = saved;
    call(`/session/${saved.sid}`).then((v: SessionView) => { accept(v); setPhase(v.status === 'paused' && v.pause?.reason === 'setup' ? 'setup' : 'running'); }).catch(() => { sess.current = null; });
  }, [formId, call, accept]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const v: SessionView = await call(`/${formId}/start`, { method: 'POST', body: JSON.stringify({ studentId: studentId.trim(), name: name.trim() }) });
      sess.current = { sid: v.id, secret: v.secret! }; store.set(formId, sess.current);
      accept(v);
      setPhase(v.camera !== 'off' ? 'setup' : 'running');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start.'); } finally { setBusy(false); }
  };

  // The server's state every few seconds (also catches the lecturer pausing, resuming, adding time or ending).
  useEffect(() => {
    if (phase === 'intro') return;
    const t = window.setInterval(() => { if (sess.current) call(`/session/${sess.current.sid}`).then(accept).catch(() => undefined); }, 5000);
    return () => window.clearInterval(t);
  }, [phase, call, accept]);
  useEffect(() => { const t = window.setInterval(() => setTick((n) => n + 1), 250); return () => window.clearInterval(t); }, []);

  const remainingMs = !view ? 0 : view.status === 'running' && view.endsAt ? Math.max(0, view.endsAt - (Date.now() + offset.current)) : view.remainingMs;
  void tick;

  // Time is up (or the lecturer ended the test): the page sends what the student has.
  useEffect(() => {
    if (phase !== 'running' || !view || submitted.current) return;
    if (view.status === 'ended' || (view.status === 'running' && remainingMs <= 0)) {
      submitted.current = true;
      void controlRef.current?.submitNow();
    }
  });

  // Leaving the page is recorded (the lecturer sees it; it never changes a mark).
  useEffect(() => {
    if (phase !== 'running') return;
    const onVis = () => sendEvent(document.hidden ? 'tab_hidden' : 'tab_back');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, sendEvent]);

  // The camera: only while there is a camera rule, and only to see whether a face is in the frame.
  const camera = view?.camera ?? 'off';
  const needCamera = camera !== 'off' && (phase === 'setup' || phase === 'running') && view?.status !== 'ended';
  useEffect(() => {
    if (!needCamera) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let detector: FaceDetector | null = null;
    let timer = 0;
    const faceWatch = new FaceWatch((view?.graceSeconds ?? exam.graceSeconds) * 1000);
    let okSince: number | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => undefined); }
        stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!stop) { setCamError('The camera stopped. Check it is not used by another app, then try again.'); sendEvent('camera_stopped'); } });
        detector = await createFaceDetector();
        if (stop) { detector.close(); return; }
        setCamError(null);
        timer = window.setInterval(() => {
          const v = videoRef.current;
          if (!v || !detector) return;
          const status = frameStatus(detector.detect(v, performance.now()));
          const { state, events } = faceWatch.feed(status, Date.now());
          setWatch(state);
          for (const e of events) sendEvent(e.type, e.seconds);
          if (phaseRef.current === 'setup') {
            if (status === 'ok') { okSince ??= Date.now(); if (Date.now() - okSince >= 2500) { okSince = null; sendEvent('camera_ok'); setPhase('running'); } } else okSince = null;
          }
        }, 600);
      } catch (e) {
        if (stop) return;
        const denied = (e as DOMException)?.name === 'NotAllowedError' || (e as DOMException)?.name === 'NotFoundError';
        setCamError(denied ? 'The camera is blocked or missing. Allow the camera for this page, then try again. If you cannot use a camera, tell your lecturer: they can set you up without it.' : 'The camera check could not start on this device. Try again, or tell your lecturer.');
        sendEvent('camera_denied');
      }
    })();
    return () => { stop = true; window.clearInterval(timer); detector?.close(); stream?.getTracks().forEach((t) => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; };
  }, [needCamera, camTry]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBreak = async (on: boolean) => {
    try { accept(await call(`/session/${sess.current!.sid}/break`, { method: 'POST', body: JSON.stringify({ on }) })); } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the break.'); }
  };

  const examSchema = useMemo(() => ({ ...schema, allowMultipleResponses: false }), [schema]);
  const submitAnswers = useCallback((answers: any) => onSubmit({ ...answers, _exam: sess.current ? { sid: sess.current.sid, token: sess.current.secret } : undefined }), [onSubmit]);

  /* ------------------------------------------------------------ views */
  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <section className={card}>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Clock size={16} />Timed test</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{schema.title}</h1>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-slate-700">
            <li>You have <strong>{exam.minutes} minutes</strong> (more if you have extra time set up). The clock is kept by the server: refreshing the page does not stop it.</li>
            <li>When the time is up, your answers are sent automatically.</li>
            {exam.camera !== 'off' && <li>Your camera checks that <strong>your face is in the frame</strong>. This happens on your device: <strong>no video or picture is recorded or sent</strong>; your lecturer only sees events like “face out of frame for 9 seconds”.{exam.camera === 'pause' ? ' If your face leaves the frame for more than a few seconds, the test pauses until your lecturer resumes it.' : ''}</li>}
            <li>Leaving this page is recorded. Pasting into typed answers may be turned off.</li>
          </ul>
        </section>
        <section className={`${card} space-y-3`}>
          <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Registration number</span>
            <input value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={40} autoComplete="off" inputMode="numeric" placeholder="e.g. 222001234" className={field} /></label>
          {!exam.courseId && <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className={field} /></label>}
          {exam.camera !== 'off' && (
            <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5" />
              <span>I understand my camera is used on this device to check my face is in the frame, and that nothing is recorded or sent. If I cannot use a camera I will tell my lecturer before I start.</span></label>
          )}
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          <button type="button" disabled={busy || !studentId.trim() || (!exam.courseId && !name.trim()) || (exam.camera !== 'off' && !consent)} onClick={() => void start()}
            className="w-full rounded-xl bg-slate-900 px-4 py-3.5 text-[15px] font-semibold text-white disabled:opacity-40">{busy ? 'Starting…' : 'Start the test'}</button>
          <p className="text-center text-xs text-slate-500">The clock starts when your camera check passes (or right away without a camera check).</p>
        </section>
      </div>
    );
  }

  const paused = view?.status === 'paused' && phase === 'running';
  const reason = view?.pause?.reason;
  const low = remainingMs > 0 && remainingMs < 5 * 60_000;
  const zoom = view?.accommodations?.largeText ? 1.2 : 1;
  const preview = (small: boolean) => (
    <div className={`relative overflow-hidden rounded-xl bg-slate-900 ${small ? 'h-16 w-20' : 'mx-auto aspect-[4/3] w-full max-w-sm'}`}>
      <video ref={videoRef} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" aria-label="Your camera" />
      {!small && <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center"><div className={`h-[78%] w-[52%] rounded-[50%] border-4 ${watch?.status === 'ok' ? 'border-emerald-400' : 'border-white/70'}`} /></div>}
    </div>
  );

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <section className={`${card} space-y-3`}>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Camera size={16} />Camera check</p>
          <h1 className="text-xl font-bold text-slate-900">Show your face in the oval</h1>
          <p className="text-sm text-slate-600">Sit at your usual place with light on your face. Hold still for a moment: the test and its clock start when the oval turns green.</p>
          {camError ? (
            <div role="alert" className="space-y-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-900"><p className="flex items-start gap-2"><CameraOff size={18} className="mt-0.5 shrink-0" />{camError}</p>
              <button type="button" onClick={() => { setCamError(null); setCamTry((n) => n + 1); }} className="rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white">Try the camera again</button></div>
          ) : (<>{preview(false)}<p role="status" className="text-center text-sm font-medium text-slate-700">{watch ? FRAME_HELP[watch.status] : 'Starting the camera…'}</p></>)}
          <p className="text-xs text-slate-500">Your time has not started yet.</p>
        </section>
      </div>
    );
  }

  return (
    <div style={zoom !== 1 ? { zoom } : undefined}>
      <div className="sticky top-0 z-30 mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <Clock size={18} className={low ? 'text-rose-600' : 'text-slate-500'} />
        <div className="min-w-0 flex-1">
          <p role="timer" aria-live="off" className={`text-xl font-bold tabular-nums ${low ? 'text-rose-600' : 'text-slate-900'}`}>{mmss(remainingMs)}</p>
          <p className="truncate text-xs text-slate-500">{view?.studentName}{view?.accommodations && view.accommodations.extraTimePercent > 0 ? ` · +${view.accommodations.extraTimePercent}% time` : ''}</p>
        </div>
        {camera !== 'off' && (
          <div className="flex items-center gap-2">
            <span className={`hidden text-xs font-medium sm:block ${watch?.state === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>{watch ? (watch.state === 'ok' ? 'Face in frame' : watch.state === 'warning' ? `Come back: ${watch.secondsLeft}s` : 'Face lost') : 'Camera…'}</span>
            {preview(true)}
          </div>
        )}
        {view?.accommodations?.breaks && !paused && <button type="button" onClick={() => void toggleBreak(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"><Pause size={14} />Break</button>}
      </div>
      {camera !== 'off' && watch?.state === 'warning' && (
        <p role="alert" className="mb-3 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"><TriangleAlert size={16} />{FRAME_HELP[watch.status]} The test pauses in {watch.secondsLeft} s.</p>
      )}
      {camera !== 'off' && camError && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{camError} <button type="button" className="font-semibold underline" onClick={() => { setCamError(null); setCamTry((n) => n + 1); }}>Try again</button></p>}
      {view?.camera === 'off' && view.accommodations?.cameraExempt && <p className="mb-3 flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700"><ShieldCheck size={16} />You are sitting this test without the camera check.</p>}
      <div className="relative">
        <Suspense fallback={null}>
          <DynamicForm schema={examSchema} uploadFile={uploadFile} onSubmit={submitAnswers} controlRef={controlRef} locked={paused} draftKey={`exam-${formId}`} />
        </Suspense>
        {paused && (
          <div role="alertdialog" aria-live="assertive" aria-label="Test paused" className="absolute inset-0 z-20 flex items-start justify-center rounded-2xl bg-white/90 p-6 backdrop-blur-md">
            <div className="mt-10 max-w-sm space-y-3 text-center">
              <Pause size={32} className="mx-auto text-slate-500" />
              <h2 className="text-lg font-bold text-slate-900">Test paused</h2>
              <p className="text-sm text-slate-700">
                {reason === 'break' ? 'You are on a break. The clock is stopped.'
                  : reason === 'lecturer' ? 'Your lecturer paused the test. The clock is stopped.'
                    : reason === 'face_lost' ? 'Your face left the frame. The clock is stopped. Put your face back in the frame; your lecturer will resume the test.'
                      : reason === 'camera_denied' || reason === 'camera_stopped' ? 'The camera is not working. The clock is stopped. Fix the camera and tell your lecturer.'
                        : 'The clock is stopped. Wait for your lecturer.'}
              </p>
              {reason === 'break' && <button type="button" onClick={() => void toggleBreak(false)} className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white">Continue the test</button>}
              {(reason === 'face_lost') && watch?.state === 'ok' && <p className="text-sm font-medium text-emerald-700">Your face is back in the frame. Waiting for your lecturer.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
