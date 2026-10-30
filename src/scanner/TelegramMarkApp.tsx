import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, CheckCircle2, FileText, Loader2, Paperclip, Users, X } from 'lucide-react';
import DocumentScanner, { type PageItem } from '../components/DocumentScanner';
import { buildPdf } from './TelegramScanApp';
import { scansToZip } from '../utils/scansToZip';

/**
 * Mark, inside Telegram (scanner.html?mode=mark): the marking scheme or the question paper (one is required), then the students with the live camera
 * (one tap per page, "Next student"), optional instructions, then Mark. Everything goes up in one request with
 * each file's role; marking then runs in the Telegram chat with live progress, and the red-pen PDFs and the
 * Excel results arrive there.
 */

type Tg = {
  initData?: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
};
const tg = (): Tg | undefined => {
  const w = (window as any).Telegram?.WebApp as Tg | undefined;
  return w?.initData ? w : undefined;
};

type Scheme = { kind: 'scan'; pages: PageItem[] } | { kind: 'file'; file: File };
type Student = { key: string; name: string; pages: PageItem[] };

const SUGGESTIONS = ['Give half marks when the method is right.', 'Do not take marks off for spelling.', 'Accept any correct method, even if it is not in the scheme.'];

export default function TelegramMarkApp() {
  const token = new URLSearchParams(window.location.search).get('token');
  const app = tg();
  const [scheme, setScheme] = useState<Scheme | null>(null);
  // What step 1 holds: the marking scheme, or the question paper Bwenge writes the scheme from.
  const [guideKind, setGuideKind] = useState<'scheme' | 'paper'>('scheme');
  const [students, setStudents] = useState<Student[]>([]);
  const [scriptFiles, setScriptFiles] = useState<File[]>([]);
  const [instructions, setInstructions] = useState('');
  const [strict, setStrict] = useState(false);
  const [scanning, setScanning] = useState<'scheme' | 'scripts' | null>(null);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'started'; students: number } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const schemeInput = useRef<HTMLInputElement>(null);
  const scriptsInput = useRef<HTMLInputElement>(null);
  const scanRound = useRef(0);

  useEffect(() => {
    if (!app) return;
    app.ready();
    app.expand();
    app.setHeaderColor?.('#0f1013');
    app.setBackgroundColor?.('#0f1013');
    app.disableVerticalSwipes?.(); // dragging page corners must not close the app
  }, [app]);

  if (!app && !token) {
    return (
      <Screen icon={<FileText className="h-7 w-7 text-[#D97757]" />} title="Open Mark from Telegram">
        Send <b className="text-white">/mark</b> to the Bwenge bot and tap <b className="text-white">Open Mark</b>.
      </Screen>
    );
  }
  if (state.kind === 'started') {
    return (
      <Screen icon={<CheckCircle2 className="h-7 w-7 text-[#5DCAA5]" />} title="Marking started">
        Follow it in the chat: each student gets a tick as soon as they are marked, then the red-pen PDFs and the Excel results arrive.
        {!app && <span className="mt-3 block">You can close this tab.</span>}
      </Screen>
    );
  }

  const pageCount = students.reduce((n, s) => n + s.pages.length, 0);
  const total = students.length + scriptFiles.length;

  const onScanned = async (pages: PageItem[]) => {
    if (scanning === 'scheme') { setScheme({ kind: 'scan', pages }); return; }
    // Each camera round numbers its students from 1 again: keep them apart from earlier rounds.
    const round = ++scanRound.current;
    const groups = new Map<string, Student>();
    for (const p of pages) {
      const key = `${round}-${p.candidateId || p.studentName || 'student'}`;
      const g = groups.get(key) ?? { key, name: p.studentName || `Student ${students.length + groups.size + 1}`, pages: [] };
      g.pages.push(p);
      groups.set(key, g);
    }
    setStudents((cur) => [...cur, ...groups.values()]);
  };

  const submit = async () => {
    setState({ kind: 'sending' });
    try {
      const form = new FormData();
      if (scheme?.kind === 'file') form.append(guideKind, scheme.file, scheme.file.name);
      else if (scheme?.kind === 'scan') form.append(guideKind, await buildPdf(scheme.pages), guideKind === 'paper' ? 'Question paper.pdf' : 'Marking scheme.pdf');
      if (students.length) {
        const pages = students.flatMap((s) => s.pages.map((p) => ({ ...p, candidateId: s.key, studentName: s.name })));
        form.append('scripts', await scansToZip(pages));
      }
      for (const f of scriptFiles) form.append('scripts', f, f.name);
      if (instructions.trim()) form.append('instructions', instructions.trim());
      form.append('credit', strict ? 'strict' : 'partial');
      form.append('students', String(total));
      const res = await fetch(`/api/telegram/mark-upload${token ? `/${encodeURIComponent(token)}` : ''}`, {
        method: 'POST', body: form, headers: app?.initData ? { 'X-Telegram-Init-Data': app.initData } : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status}).`);
      app?.HapticFeedback?.notificationOccurred('success');
      setState({ kind: 'started', students: body.students ?? total });
      if (app) window.setTimeout(() => app.close(), 2200);
    } catch (e) {
      app?.HapticFeedback?.notificationOccurred('error');
      setState({ kind: 'error', message: (e as Error).message || 'Could not start marking. Your pages are kept; try again.' });
    }
  };

  const toggle = (s: string) => setInstructions((cur) => (cur.includes(s) ? cur.replace(s, '').replace(/\s{2,}/g, ' ').trim() : `${cur.trim()} ${s}`.trim()));
  const schemeLabel = scheme?.kind === 'scan' ? `Photographed · ${scheme.pages.length} page${scheme.pages.length === 1 ? '' : 's'}` : scheme?.kind === 'file' ? scheme.file.name : null;

  return (
    <div className="min-h-dvh bg-[#0f1013] pb-28 text-[#F2EFE9]">
      <main className="mx-auto max-w-md space-y-3 px-4 pt-5">
        <header className="mb-1">
          <h1 className="text-xl font-semibold">Mark a class</h1>
          <p className="text-[13px] text-[#9C9A92]">Scheme or question paper, then students. Marking runs in the chat with live progress.</p>
        </header>

        {/* 1. Marking scheme or question paper (required) */}
        <section className="rounded-2xl border border-white/10 bg-[#1A1918] p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Step n={1} done={!!scheme} />{scheme ? (guideKind === 'paper' ? 'Question paper' : 'Marking scheme') : 'Marking scheme or question paper'}</div>
          <div role="radiogroup" aria-label="What is it?" className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1 text-[12.5px]">
            {(['scheme', 'paper'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={guideKind === k} onClick={() => setGuideKind(k)}
                className={`rounded-lg px-2 py-1.5 font-semibold ${guideKind === k ? 'bg-[#D97757] text-white' : 'text-[#9C9A92]'}`}>{k === 'scheme' ? 'Marking scheme' : 'Question paper'}</button>
            ))}
          </div>
          {scheme ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
              <Check size={15} /><span className="min-w-0 flex-1 truncate">{schemeLabel}</span>
              <button type="button" aria-label={guideKind === 'paper' ? 'Remove the question paper' : 'Remove the marking scheme'} onClick={() => setScheme(null)} className="rounded p-1 text-[#9C9A92]"><X size={15} /></button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Btn primary onClick={() => setScanning('scheme')}><Camera size={16} />Photograph</Btn>
                <Btn onClick={() => schemeInput.current?.click()}><Paperclip size={16} />Choose file</Btn>
              </div>
              <p className="mt-2 text-[12px] text-[#9C9A92]">Required. With the question paper, Bwenge writes the scheme first, then marks.</p>
            </>
          )}
          <input ref={schemeInput} type="file" hidden accept=".pdf,.docx,.txt,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setScheme({ kind: 'file', file: f }); e.target.value = ''; }} />
        </section>

        {/* 2. Students */}
        <section className="rounded-2xl border border-white/10 bg-[#1A1918] p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Step n={2} done={total > 0} />Students' scripts</div>
          {total > 0 && (
            <ul className="mb-2 space-y-1">
              {students.map((s) => (
                <li key={s.key} className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px]">
                  <Users size={14} className="text-[#D97757]" /><span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-[12px] text-[#9C9A92]">{s.pages.length} page{s.pages.length === 1 ? '' : 's'}</span>
                  <button type="button" aria-label={`Remove ${s.name}`} onClick={() => setStudents((cur) => cur.filter((x) => x.key !== s.key))} className="rounded p-1 text-[#9C9A92]"><X size={14} /></button>
                </li>
              ))}
              {scriptFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px]">
                  <FileText size={14} className="text-[#D97757]" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setScriptFiles((cur) => cur.filter((_, j) => j !== i))} className="rounded p-1 text-[#9C9A92]"><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Btn primary={total === 0} onClick={() => setScanning('scripts')}><Camera size={16} />{total ? 'Scan more' : 'Scan students'}</Btn>
            <Btn onClick={() => scriptsInput.current?.click()}><Paperclip size={16} />Choose files</Btn>
          </div>
          <p className="mt-2 text-[12px] text-[#9C9A92]">One tap per page, <b className="text-[#C2C0B6]">Next student</b> between students.</p>
          <input ref={scriptsInput} type="file" hidden multiple accept=".pdf,.zip,.docx,image/*" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) setScriptFiles((cur) => [...cur, ...fs].slice(0, 9)); e.target.value = ''; }} />
        </section>

        {/* 3. Instructions */}
        <section className="rounded-2xl border border-white/10 bg-[#1A1918] p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Step n={3} done={!!instructions.trim()} />Instructions <span className="font-normal text-[#9C9A92]">(optional)</span></div>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value.slice(0, 2000))} rows={2} placeholder="For example: accept g = 9.8 or 10 m/s²."
            className="w-full resize-none rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[14px] placeholder:text-[#6F6D66] focus:border-[#D97757]/60 focus:outline-none" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => toggle(s)} className={`rounded-full border px-2.5 py-1 text-[12px] ${instructions.includes(s) ? 'border-[#D97757]/50 bg-[#D97757]/15 text-[#F2B39C]' : 'border-white/10 text-[#9C9A92]'}`}>{s.replace(/\.$/, '')}</button>
            ))}
            <button type="button" aria-pressed={strict} onClick={() => setStrict((v) => !v)} className={`rounded-full border px-2.5 py-1 text-[12px] ${strict ? 'border-[#D97757]/50 bg-[#D97757]/15 text-[#F2B39C]' : 'border-white/10 text-[#9C9A92]'}`}>Strict marking</button>
          </div>
        </section>

        {state.kind === 'error' && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{state.message}</p>}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0f1013]/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <span className="min-w-0 flex-1 text-[12px] leading-tight text-[#9C9A92]">
            {total ? <>{scheme ? (guideKind === 'paper' ? 'Question paper ready' : 'Scheme ready') : 'Add the scheme or question paper'}<br />{total} student{total === 1 ? '' : 's'}{pageCount ? ` · ${pageCount} pages` : ''}</> : 'Add the students to start'}
          </span>
          <button type="button" disabled={!total || !scheme || state.kind === 'sending'} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-[#D97757] px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-40">
            {state.kind === 'sending' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {state.kind === 'sending' ? 'Sending…' : `Mark ${total || ''} script${total === 1 ? '' : 's'}`.replace('  ', ' ')}
          </button>
        </div>
      </footer>

      {scanning && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0f1013]">
          <DocumentScanner
            labels="student"
            aiTools={false}
            allowExport={false}
            quick
            saveLabel={scanning === 'scheme' ? (guideKind === 'paper' ? 'Use as question paper' : 'Use as marking scheme') : 'Add these students'}
            onSavePages={onScanned}
            onClose={() => setScanning(null)}
          />
        </div>
      )}
    </div>
  );
}

function Step({ n, done }: { n: number; done: boolean }) {
  return <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${done ? 'bg-emerald-500 text-[#0f1013]' : 'bg-white/10 text-[#C2C0B6]'}`}>{done ? <Check size={12} /> : n}</span>;
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[14px] font-medium ${primary ? 'bg-[#D97757] text-white' : 'border border-white/10 text-[#E8E6DE]'}`}>{children}</button>;
}

function Screen({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0f1013] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">{icon}</div>
        <h1 className="mb-2 text-xl font-semibold text-white">{title}</h1>
        <p className="text-sm leading-relaxed text-[#C2C0B6]">{children}</p>
      </div>
    </main>
  );
}
