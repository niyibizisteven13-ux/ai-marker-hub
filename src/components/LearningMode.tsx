import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GraduationCap, MessageSquare, Theater, Volume2, VolumeX, X } from 'lucide-react';
import { ROLEPLAY_PRESETS, speechLang, type LearningSettings } from '../lib/learning/presets';
import { checkMicrophone, explainCaptureFailure } from '../utils/microphone';

/**
 * Learning modes in the composer: Normal, Socratic tutor (hints instead of answers) and Roleplay (practise a
 * language or a scenario with a character, with real voice input and replies read aloud).
 */

const KEY = 'bwenge-learning-mode';
export function useLearningMode() {
  const [settings, setSettings] = useState<LearningSettings>(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v?.mode) return v; } catch { /* ignore */ }
    return { mode: 'normal' };
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }, [settings]);
  return [settings, setSettings] as const;
}

const LABEL = { normal: 'Normal', socratic: 'Socratic tutor', roleplay: 'Roleplay' } as const;

export function LearningModePicker({ value, onChange }: { value: LearningSettings; onChange: (s: LearningSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ character: '', scenario: '', language: '', level: '' });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const Icon = value.mode === 'socratic' ? GraduationCap : value.mode === 'roleplay' ? Theater : MessageSquare;
  const pick = (s: LearningSettings) => { onChange(s); setOpen(false); };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${value.mode === 'normal' ? 'border-white/10 text-neutral-300 hover:text-white' : 'border-[var(--brand)]/50 bg-[var(--brand)]/15 text-[var(--brand-soft)]'}`}>
        <Icon size={12} aria-hidden="true" /> {LABEL[value.mode]} <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-50 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[var(--app-panel-2)] p-1.5 text-xs text-neutral-200 shadow-2xl">
          {(['normal', 'socratic'] as const).map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={value.mode === m} onClick={() => pick({ mode: m })} className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-white/5">
              {m === 'normal' ? <MessageSquare size={15} className="mt-0.5 text-neutral-400" /> : <GraduationCap size={15} className="mt-0.5 text-emerald-300" />}
              <span className="flex-1"><span className="block font-semibold text-white">{LABEL[m]}</span><span className="text-neutral-400">{m === 'normal' ? 'Answers, files, charts and everything else.' : 'Guides you with questions and hints instead of giving answers. Good for homework and revision.'}</span></span>
              {value.mode === m && <Check size={14} className="mt-0.5 text-[var(--brand)]" />}
            </button>
          ))}
          <div className="mt-1 border-t border-white/10 px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">Roleplay</div>
          {ROLEPLAY_PRESETS.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={value.mode === 'roleplay' && value.character === p.settings.character} onClick={() => pick(p.settings)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left hover:bg-white/5">
              <Theater size={14} className="text-violet-300" /> <span className="flex-1">{p.title}</span>
              {value.mode === 'roleplay' && value.character === p.settings.character && <Check size={14} className="text-[var(--brand)]" />}
            </button>
          ))}
          <details className="mx-1 mt-1 rounded-xl bg-white/[0.03] px-2.5 py-2">
            <summary className="cursor-pointer text-neutral-300">Your own scenario…</summary>
            <form className="mt-2 space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (!custom.character.trim()) return; pick({ mode: 'roleplay', character: custom.character, scenario: custom.scenario || undefined, language: custom.language || undefined, level: custom.level || undefined }); }}>
              <input required value={custom.character} onChange={(e) => setCustom({ ...custom, character: e.target.value })} placeholder="Who the AI plays (e.g. a bank clerk)" className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-neutral-500" />
              <input value={custom.scenario} onChange={(e) => setCustom({ ...custom, scenario: e.target.value })} placeholder="Situation (e.g. opening a savings account)" className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-neutral-500" />
              <div className="flex gap-1.5">
                <input value={custom.language} onChange={(e) => setCustom({ ...custom, language: e.target.value })} placeholder="Language (optional)" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-neutral-500" />
                <select value={custom.level} onChange={(e) => setCustom({ ...custom, level: e.target.value })} className="rounded-lg border border-white/10 bg-black/30 px-1.5 text-xs text-white"><option value="">Level</option>{['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => <option key={l}>{l}</option>)}</select>
              </div>
              <button className="w-full rounded-lg bg-[var(--brand)] py-1.5 text-xs font-semibold text-white">Start roleplay</button>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}

/** Banner above the composer while a learning mode is on. */
export function LearningModeBanner({ value, onExit, speak, onToggleSpeak, onFeedback }: { value: LearningSettings; onExit: () => void; speak: boolean; onToggleSpeak: () => void; onFeedback: () => void }) {
  if (value.mode === 'normal') return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-3 py-2 text-[11.5px] text-[#F5C7B5]">
      {value.mode === 'socratic' ? <GraduationCap size={14} className="shrink-0" /> : <Theater size={14} className="shrink-0" />}
      <span className="min-w-0 flex-1">
        {value.mode === 'socratic'
          ? <><b className="text-white">Socratic tutor</b> · I'll guide you with questions and hints, not give the answer.</>
          : <><b className="text-white">Roleplay</b> · {value.character}{value.language ? ` · ${value.language}${value.level ? ` ${value.level}` : ''}` : ''}. Say “end” for feedback.</>}
      </span>
      {value.mode === 'roleplay' && (
        <>
          <button type="button" onClick={onToggleSpeak} aria-pressed={speak} title={speak ? 'Stop reading replies aloud' : 'Read replies aloud'} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 hover:bg-white/10">{speak ? <Volume2 size={12} /> : <VolumeX size={12} />} {speak ? 'Voice on' : 'Voice off'}</button>
          <button type="button" onClick={onFeedback} className="rounded-full border border-white/10 px-2 py-0.5 hover:bg-white/10">End & feedback</button>
        </>
      )}
      <button type="button" onClick={onExit} aria-label="Turn off learning mode" className="rounded-full p-0.5 hover:bg-white/10"><X size={13} /></button>
    </div>
  );
}

// ── Voice: real speech recognition (where the browser supports it) and read-aloud ──
/**
 * Dictation like Claude's: words appear while you speak (interim), final words are committed with onText.
 * Errors are reported in words (microphone blocked, nothing heard) instead of failing silently.
 */
export function useSpeechInput(lang: string, onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<any>(null);
  const stopping = useRef(false);
  const Ctor = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const supported = !!Ctor;
  const stop = useCallback(() => { stopping.current = true; rec.current?.stop(); setListening(false); setInterim(''); }, []);
  const abort = useCallback(() => { stopping.current = true; rec.current?.abort?.(); setListening(false); setInterim(''); }, []);
  const begin = useCallback(() => {
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e: any) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) onText(t.trim()); else live += t;
      }
      setInterim(live.trim());
    };
    // Chrome ends a session after a pause; keep listening until the person presses Done or Cancel.
    r.onend = () => { if (!stopping.current && rec.current === r) { try { r.start(); return; } catch { /* already started */ } } setListening(false); setInterim(''); };
    r.onerror = (e: any) => {
      const code = e?.error;
      if (code === 'no-speech' || code === 'aborted') return;
      stopping.current = true;
      setListening(false); setInterim('');
      if (code === 'audio-capture') { void explainCaptureFailure().then(setError); return; }
      setError(code === 'not-allowed' || code === 'service-not-allowed' ? 'The microphone is blocked for this site. Click the lock icon in the address bar, set Microphone to Allow, then try again.'
        : code === 'network' ? 'Voice typing needs an internet connection (the browser sends your voice to its speech service).'
          : code === 'language-not-supported' ? 'Voice typing is not available for this language in your browser. Choose another answer language.'
            : 'Voice typing stopped. Try again.');
    };
    rec.current = r;
    try { r.start(); } catch { setError('Voice typing could not start. Try again.'); setListening(false); }
  }, [Ctor, lang, onText]);
  /** Checks the microphone first (this shows the permission prompt and finds the real problem), then listens. */
  const start = useCallback(() => {
    if (!Ctor) return false;
    stopping.current = false;
    setError(null);
    setListening(true);
    void checkMicrophone().then((mic) => {
      if (stopping.current) return;
      if (!mic.ok) { setError(mic.message ?? 'The microphone could not be started.'); setListening(false); return; }
      begin();
    });
    return true;
  }, [Ctor, begin]);
  useEffect(() => () => { stopping.current = true; rec.current?.abort?.(); }, []);
  return { supported, listening, interim, error, clearError: () => setError(null), start, stop, abort };
}

export function speakText(text: string, lang: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const plain = text
    .replace(/\*?Coach:[\s\S]*$/m, '') // the coaching note is for reading, not for the voice
    .replace(/```[\s\S]*?```/g, ' ').replace(/[*_#>`~]|\[(.*?)\]\(.*?\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (!plain) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain.slice(0, 1200));
  u.lang = lang;
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
  if (voice) u.voice = voice;
  window.speechSynthesis.speak(u);
}

export { speechLang };
