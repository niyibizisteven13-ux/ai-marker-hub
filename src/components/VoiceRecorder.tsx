import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

/**
 * Records a spoken answer in the browser and hands it back as an audio file (WebM, or MP4 audio on Safari),
 * so it can be attached like a photo or PDF. Shows the time while recording.
 */
export default function VoiceRecorder({ onRecorded, onError, maxSeconds = 600, className = '' }: { onRecorded: (f: File) => void; onError: (message: string) => void; maxSeconds?: number; className?: string }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => { rec.current?.state === 'recording' && rec.current.stop(); };
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (recording && seconds >= maxSeconds) stop(); }, [recording, seconds, maxSeconds]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError('Voice recording is not available in this browser. Use Chrome, Edge or Safari.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) window.clearInterval(timer.current);
        setRecording(false);
        const mime = (r.mimeType || type || 'audio/webm').split(';')[0];
        const ext = mime === 'audio/mp4' ? 'm4a' : 'webm';
        const blob = new Blob(chunks, { type: mime });
        if (blob.size) onRecorded(new File([blob], `voice-answer-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`, { type: mime }));
      };
      rec.current = r;
      r.start();
      setSeconds(0);
      setRecording(true);
      timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      onError('Allow the microphone for this page, then try again.');
    }
  };

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return recording ? (
    <button type="button" onClick={stop} className={`flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 py-3.5 text-[14.5px] font-semibold text-white ${className}`} aria-label="Stop recording">
      <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" /></span>
      <span className="tabular-nums">{mmss}</span><Square size={15} fill="currentColor" />Stop
    </button>
  ) : (
    <button type="button" onClick={() => void start()} className={`flex items-center justify-center gap-2 rounded-xl border border-neutral-300 px-3 py-3.5 text-[14.5px] font-medium hover:bg-neutral-50 ${className}`}>
      <Mic size={18} />Record voice
    </button>
  );
}
