import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Check,
  Copy,
  Info,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  XOctagon,
  FileCode,
  FileText,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  Download,
  Volume2,
  Film,
  Image as ImageIcon,
  Workflow,
  Database,
} from 'lucide-react';
import 'katex/dist/katex.min.css';

type ChartPoint = Record<string, string | number>;

function MermaidDiagram({ source }: { source: string }) {
  return <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/70 p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Diagram source</div><pre className="text-xs text-neutral-300">{source}</pre></div>;
}

function ImageGraphicArtifact({ artifact }: { artifact: any }) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const title = artifact.title || 'Generated Visual Asset';
  const style = artifact.style || 'Digital Illustration';
  const aspectRatio = artifact.aspectRatio || '16:9';
  const palette: string[] = Array.isArray(artifact.palette) ? artifact.palette : ['#0D2B24', '#10B981', '#D97757', '#FAF9F5'];
  const defaultSvg = `<svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette[0] || '#0D2B24'}" />
        <stop offset="60%" stop-color="#141824" />
        <stop offset="100%" stop-color="${palette[2] || '#D97757'}" stop-opacity="0.5" />
      </linearGradient>
      <radialGradient id="glow" cx="65%" cy="40%" r="45%">
        <stop offset="0%" stop-color="${palette[1] || '#10B981'}" stop-opacity="0.38" />
        <stop offset="100%" stop-color="#000000" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="800" height="450" rx="18" fill="url(#bgGrad)" />
    <rect width="800" height="450" rx="18" fill="url(#glow)" />
    <circle cx="540" cy="210" r="120" fill="none" stroke="${palette[1] || '#10B981'}" stroke-width="1.5" stroke-opacity="0.4" />
    <circle cx="540" cy="210" r="80" fill="${palette[1] || '#10B981'}" fill-opacity="0.12" stroke="${palette[1] || '#10B981'}" stroke-width="2" />
    <path d="M 120 330 Q 280 180 440 270 T 720 160" fill="none" stroke="${palette[2] || '#D97757'}" stroke-width="3" />
    <text x="64" y="130" fill="#FAF9F5" font-family="Georgia, serif" font-size="34" font-weight="600">${String(title).replace(/[<>&]/g, '')}</text>
    <text x="64" y="168" fill="#A3A39E" font-family="sans-serif" font-size="16">${String(style).replace(/[<>&]/g, '')} · GonkaRouter Visual Synthesis</text>
  </svg>`;

  const rawSvg = typeof artifact.svg === 'string' && artifact.svg.includes('<svg') ? artifact.svg : defaultSvg;
  const svgDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(rawSvg)}`;

  const handleDownloadSvg = () => {
    const blob = new Blob([rawSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'graphic'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#1B1B19]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <ImageIcon className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-[#FAF9F5]">{title}</span>
          <span className="text-xs text-[#9C9A92]">· {style} · {aspectRatio}</span>
        </div>
        <div className="flex items-center gap-2">
          {artifact.prompt && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(String(artifact.prompt));
                setCopiedPrompt(true);
                setTimeout(() => setCopiedPrompt(false), 1500);
              }}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-[#FAF9F5] transition hover:bg-white/10"
            >
              {copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="flex items-center gap-1.5 rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#c66849]"
          >
            <Download className="h-3.5 w-3.5" />
            Download SVG
          </button>
        </div>
      </div>
      <div className="bg-black/40 p-4">
        <img
          src={svgDataUri}
          alt={title}
          className="mx-auto max-h-[420px] w-full rounded-lg object-contain"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-2.5 text-xs text-[#9C9A92]">
        <span className="truncate">{artifact.model || 'GonkaRouter Visual · Nano Banana Pro'}</span>
        <div className="flex items-center gap-1.5">
          <span>Palette:</span>
          {palette.map((hex, i) => (
            <span key={i} className="inline-flex items-center gap-1 font-mono text-[11px]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-white/20" style={{ backgroundColor: hex }} />
              {hex}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function VideoAnimationArtifact({ artifact }: { artifact: any }) {
  const scenes: any[] = Array.isArray(artifact.scenes) && artifact.scenes.length > 0
    ? artifact.scenes
    : [
        {
          title: 'Scene 1',
          duration: 5,
          headline: artifact.title || 'GonkaRouter Motion Sequence',
          subtext: artifact.concept || 'Dynamic keyframe animation & talking character synthesis',
          narration: artifact.concept || artifact.title || 'Welcome to Bwenge AI Motion Studio.',
          motionType: artifact.motionType || 'talking_character',
          accentColor: '#10B981',
        },
      ];
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const activeScene = scenes[activeSceneIdx] || scenes[0];

  React.useEffect(() => {
    if (!isPlaying) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && activeScene?.narration) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(String(activeScene.narration));
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    }
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 80);
    const sceneTimer = setTimeout(() => {
      if (activeSceneIdx + 1 < scenes.length) {
        setActiveSceneIdx((idx) => idx + 1);
      } else {
        setIsPlaying(false);
      }
    }, (Number(activeScene?.duration) || 5) * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(sceneTimer);
    };
  }, [isPlaying, activeSceneIdx, scenes.length, activeScene]);

  const togglePlay = () => {
    if (isPlaying) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  const accent = activeScene?.accentColor || '#10B981';
  const mouthOpen = isPlaying ? 4 + Math.abs(Math.sin(tick * 0.6)) * 14 : 3;
  const waveOffset = tick * 6;

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#1B1B19]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-[#FAF9F5]">{artifact.title || 'Animated Video Studio'}</span>
          <span className="text-xs text-[#9C9A92]">· {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {artifact.model || 'GonkaRouter Flow Engine'}</span>
        </div>
        <button
          type="button"
          onClick={togglePlay}
          className="flex items-center gap-1.5 rounded-lg bg-[#D97757] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#c66849]"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isPlaying ? 'Pause clip' : 'Play animation & voice'}
        </button>
      </div>

      <div className="relative bg-[#0E1015] p-4">
        <svg viewBox="0 0 800 420" className="mx-auto h-auto max-h-[380px] w-full rounded-lg border border-white/5 bg-[#12151E]">
          <defs>
            <radialGradient id="stageGlow" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0E1015" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="800" height="420" fill="url(#stageGlow)" />
          {/* Animated orbital rings / waves */}
          <circle
            cx="400"
            cy="175"
            r={95 + Math.sin(tick * 0.2) * 8}
            fill="none"
            stroke={accent}
            strokeOpacity="0.3"
            strokeWidth="1.5"
            strokeDasharray="8 6"
          />
          {/* Talking Character / Animated Avatar */}
          <g transform={`translate(400, ${165 + Math.sin(tick * 0.25) * 4})`}>
            <circle cx="0" cy="0" r="56" fill="#1E2433" stroke={accent} strokeWidth="2.5" />
            <circle cx="-18" cy="-10" r="5" fill="#FAF9F5" />
            <circle cx="18" cy="-10" r="5" fill="#FAF9F5" />
            <rect x="-16" y={14 - mouthOpen / 2} width="32" height={mouthOpen} rx={mouthOpen / 2} fill={accent} />
          </g>
          {/* Animated Equalizer / Motion Wave */}
          <path
            d={`M 120 275 Q ${260 + Math.sin(waveOffset * 0.05) * 30} ${250 - (isPlaying ? 22 : 4)} 400 275 T 680 275`}
            fill="none"
            stroke={accent}
            strokeWidth="2.5"
            strokeOpacity="0.7"
          />
          <text x="400" y="325" fill="#FAF9F5" fontSize="24" fontWeight="600" textAnchor="middle">
            {String(activeScene?.headline || activeScene?.title || artifact.title || '').slice(0, 56)}
          </text>
          <text x="400" y="356" fill="#9C9A92" fontSize="14" textAnchor="middle">
            {String(activeScene?.subtext || activeScene?.narration || '').slice(0, 85)}
          </text>
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {scenes.map((sc, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveSceneIdx(idx)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                idx === activeSceneIdx ? 'bg-white/15 text-[#FAF9F5]' : 'text-[#9C9A92] hover:bg-white/5 hover:text-[#FAF9F5]'
              }`}
            >
              {sc.title || `Scene ${idx + 1}`}
            </button>
          ))}
        </div>
        {activeScene?.narration && (
          <p className="w-full text-xs text-[#C2C0B6] mt-1">
            Voiceover: “{activeScene.narration}”
          </p>
        )}
      </div>
    </div>
  );
}

function AudioSpeechArtifact({ artifact }: { artifact: any }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(0);
  const segments: Array<{ speaker?: string; voiceTone?: string; text: string }> = Array.isArray(artifact.segments) && artifact.segments.length > 0
    ? artifact.segments
    : [{ speaker: 'Narrator', voiceTone: 'Natural Studio', text: artifact.script || artifact.title || 'Audio track ready for playback.' }];
  const notes: Array<{ pitch: number; duration: number; wave?: OscillatorType }> = Array.isArray(artifact.notes) ? artifact.notes : [];

  const playMusicalNotes = async () => {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    let startTime = ctx.currentTime + 0.05;
    const sequence = notes.length > 0
      ? notes
      : [
          { pitch: 261.63, duration: 0.25, wave: 'sine' as OscillatorType },
          { pitch: 329.63, duration: 0.25, wave: 'sine' as OscillatorType },
          { pitch: 392.0, duration: 0.25, wave: 'triangle' as OscillatorType },
          { pitch: 523.25, duration: 0.45, wave: 'sine' as OscillatorType },
        ];
    for (const n of sequence) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.wave || 'sine';
      osc.frequency.setValueAtTime(Number(n.pitch) || 440, startTime);
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + (Number(n.duration) || 0.3));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + (Number(n.duration) || 0.3));
      startTime += Number(n.duration) || 0.3;
    }
  };

  const handleToggleAudio = async () => {
    if (isPlaying) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);
    await playMusicalNotes();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window && artifact.audioType !== 'music') {
      window.speechSynthesis.cancel();
      segments.forEach((seg, idx) => {
        const utter = new SpeechSynthesisUtterance(seg.text);
        utter.pitch = idx % 2 === 0 ? 1.0 : 1.12;
        utter.rate = 1.02;
        utter.onstart = () => setActiveSegmentIdx(idx);
        if (idx === segments.length - 1) {
          utter.onend = () => setIsPlaying(false);
        }
        window.speechSynthesis.speak(utter);
      });
    } else {
      setTimeout(() => setIsPlaying(false), 2000);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#1B1B19]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-[#FAF9F5]">{artifact.title || 'Audio & Podcast Studio'}</span>
          <span className="text-xs text-[#9C9A92]">
            · {artifact.audioType || 'podcast'}
            {artifact.tempoBpm ? ` · ${artifact.tempoBpm} BPM` : ''}
            {artifact.musicalKey ? ` · ${artifact.musicalKey}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggleAudio}
          className="flex items-center gap-1.5 rounded-lg bg-[#D97757] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#c66849]"
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isPlaying ? 'Stop audio' : 'Synthesize & Play'}
        </button>
      </div>

      <div className="space-y-2.5 p-4">
        {segments.map((seg, idx) => (
          <div
            key={idx}
            className={`rounded-lg border px-3.5 py-2.5 transition ${
              isPlaying && idx === activeSegmentIdx
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : 'border-white/[0.06] bg-white/[0.02]'
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-[#9C9A92]">
              <span className="font-semibold text-[#FAF9F5]">{seg.speaker || `Speaker ${idx + 1}`}</span>
              {seg.voiceTone && <span>· {seg.voiceTone}</span>}
            </div>
            <p className="text-sm leading-relaxed text-[#E5E4DF]">{seg.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DatasetWorkflowArtifact({ artifact }: { artifact: any }) {
  const isDataset = artifact.type === 'dataset';
  const patterns: Array<{ name: string; confidence?: string; insight: string }> = Array.isArray(artifact.patterns) ? artifact.patterns : [];
  const steps: Array<{ id?: string; name: string; role?: string; detail: string; metric?: string }> = Array.isArray(artifact.steps) ? artifact.steps : [];
  const sequence: Array<{ step?: number; channel?: string; subject: string; schedule?: string; body?: string }> = Array.isArray(artifact.sequence) ? artifact.sequence : [];
  const columns: string[] = Array.isArray(artifact.columns)
    ? artifact.columns
    : Array.isArray(artifact.spreadsheet?.columns)
    ? artifact.spreadsheet.columns
    : [];
  const rows: any[][] = Array.isArray(artifact.rows)
    ? artifact.rows
    : Array.isArray(artifact.spreadsheet?.rows)
    ? artifact.spreadsheet.rows
    : [];

  const handleExportCsv = () => {
    if (!columns.length && !rows.length) return;
    const csvLines = [
      columns.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
      ...rows.map((r) => (Array.isArray(r) ? r : Object.values(r)).map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(artifact.title || 'dataset-workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#1B1B19]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2">
          {isDataset ? <Database className="h-4 w-4 text-emerald-400" /> : <Workflow className="h-4 w-4 text-amber-400" />}
          <span className="text-sm font-semibold text-[#FAF9F5]">{artifact.title || (isDataset ? 'Dataset Pattern Analysis' : 'Automated Workflow & Data Studio')}</span>
          <span className="text-xs text-[#9C9A92]">· GonkaRouter Intelligence</span>
        </div>
        {(columns.length > 0 || rows.length > 0) && (
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#c66849]"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {artifact.summary && <p className="text-sm text-[#C2C0B6]">{artifact.summary}</p>}

        {patterns.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#9C9A92]">Discovered Training & Dataset Patterns</div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {patterns.map((p, i) => (
                <div key={i} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#FAF9F5]">
                    <span>{p.name}</span>
                    {p.confidence && <span className="font-mono text-emerald-400">{p.confidence}</span>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#C2C0B6]">{p.insight}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {artifact.promptOptimization && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-xs space-y-1.5">
            <div className="font-semibold text-emerald-300">Prompt Pattern Optimization</div>
            {artifact.promptOptimization.original && (
              <div className="text-[#9C9A92]">Original: “{artifact.promptOptimization.original}”</div>
            )}
            {artifact.promptOptimization.upgraded && (
              <div className="text-[#FAF9F5]">Upgraded: “{artifact.promptOptimization.upgraded}”</div>
            )}
          </div>
        )}

        {steps.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#9C9A92]">Autonomous Process DAG</div>
            <div className="space-y-2">
              {steps.map((s, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-xs">
                  <div>
                    <div className="font-semibold text-[#FAF9F5]">
                      {idx + 1}. {s.name} {s.role ? <span className="font-normal text-[#9C9A92]">· {s.role}</span> : null}
                    </div>
                    <div className="mt-0.5 text-[#C2C0B6]">{s.detail}</div>
                  </div>
                  {s.metric && <span className="shrink-0 font-mono text-emerald-400">{s.metric}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {(columns.length > 0 || rows.length > 0) && (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="min-w-full border-collapse text-xs tabular-nums">
              {columns.length > 0 && (
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.04]">
                    {columns.map((col, idx) => (
                      <th key={idx} className="px-3 py-2 text-left font-semibold text-[#FAF9F5]">{col}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-white/[0.04]">
                    {(Array.isArray(row) ? row : Object.values(row)).map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-2 text-[#C2C0B6]">{String(cell ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sequence.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#9C9A92]">Automated Communication & Scheduling Sequence</div>
            {sequence.map((item, idx) => (
              <div key={idx} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
                <div className="flex items-center justify-between font-semibold text-[#FAF9F5]">
                  <span>{item.channel || 'Email'} · {item.subject}</span>
                  {item.schedule && <span className="font-mono text-[#9C9A92]">{item.schedule}</span>}
                </div>
                {item.body && <p className="mt-1 text-[#C2C0B6]">{item.body}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChartArtifact({ title, chartType, xKey, yKey, data }: { title: string; chartType: string; xKey: string; yKey: string; data: ChartPoint[] }) {
  const points = data.map((row) => ({ label: String(row[xKey] ?? ''), value: Number(row[yKey]) })).filter((p) => p.label && Number.isFinite(p.value));
  if (!points.length || points.length > 80) return null;
  const width = 640;
  const height = 260;
  const pad = { top: 24, right: 20, bottom: 52, left: 48 };
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + (max - v) / span * plotH;
  const x = (i: number) => pad.left + (chartType === 'bar' ? (i + 0.5) * plotW / points.length : (points.length === 1 ? plotW / 2 : i * plotW / (points.length - 1)));
  const zeroY = y(0);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70 p-3">
      <div className="mb-2 text-sm font-semibold text-neutral-200">{title}</div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chartType} chart: ${title}`} className="h-auto min-w-[480px] w-full">
          <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} stroke="#64748b" strokeWidth="1" />
          {chartType === 'bar' ? points.map((p, i) => {
            const barW = Math.max(2, plotW / points.length * 0.66);
            const valY = y(p.value);
            return <g key={`${p.label}-${i}`}>
              <rect x={x(i) - barW / 2} y={Math.min(valY, zeroY)} width={barW} height={Math.max(1, Math.abs(zeroY - valY))} rx="3" fill="#34d399" />
              <text x={x(i)} y={height - pad.bottom + 17} fill="#cbd5e1" textAnchor="middle" fontSize="11">{p.label.slice(0, 16)}</text>
            </g>;
          }) : <>
            {chartType === 'line' && <polyline points={line} fill="none" stroke="#34d399" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
            {points.map((p, i) => <g key={`${p.label}-${i}`}>
              <circle cx={x(i)} cy={y(p.value)} r={chartType === 'scatter' ? 5 : 3.5} fill="#34d399" />
              <text x={x(i)} y={height - pad.bottom + 17} fill="#cbd5e1" textAnchor="middle" fontSize="11">{p.label.slice(0, 16)}</text>
            </g>)}
          </>}
          <text x="8" y={pad.top + 4} fill="#94a3b8" fontSize="11">{yKey}</text>
          <text x={width / 2} y={height - 8} fill="#94a3b8" textAnchor="middle" fontSize="11">{xKey}</text>
        </svg>
      </div>
    </div>
  );
}

function renderArtifactJson(source: string): React.ReactNode | null {
  try {
    const artifact = JSON.parse(source);
    if (!artifact || typeof artifact !== 'object') return null;
    if (artifact.type === 'image') return <ImageGraphicArtifact artifact={artifact} />;
    if (artifact.type === 'video') return <VideoAnimationArtifact artifact={artifact} />;
    if (artifact.type === 'audio') return <AudioSpeechArtifact artifact={artifact} />;
    if (artifact.type === 'dataset' || artifact.type === 'workflow') return <DatasetWorkflowArtifact artifact={artifact} />;
    if (artifact.type === 'chart' && ['bar', 'line', 'scatter'].includes(artifact.chartType) && typeof artifact.title === 'string' && typeof artifact.xKey === 'string' && typeof artifact.yKey === 'string' && Array.isArray(artifact.data)) {
      return <ChartArtifact title={artifact.title} chartType={artifact.chartType} xKey={artifact.xKey} yKey={artifact.yKey} data={artifact.data} />;
    }
    return null;
  } catch {
    return null;
  }
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function ArtifactCard({ title, type, children }: { title: string; type?: string; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const textContent = typeof children === 'string' ? children : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.03] shadow-lg">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.05] px-4 py-2.5">
        <div className="flex items-center gap-2">
          {type === 'code' ? <FileCode className="h-4 w-4 text-emerald-400" /> : <FileText className="h-4 w-4 text-amber-400" />}
          <span className="text-[13px] font-semibold text-neutral-200">{title || 'Artifact'}</span>
          {type && (
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-neutral-400">
              {type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-white/10 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="rounded-md bg-white/5 p-1 text-neutral-400 hover:bg-white/10 transition-colors"
          >
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {isOpen && <div className="p-4 text-[13px] leading-relaxed text-neutral-200">{children}</div>}
    </div>
  );
}

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const processedContent = React.useMemo(() => {
    if (!content) return '';
    let res = content
      .replace(/(#{1,6})([^\s#])/g, '$1 $2')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>');
    res = res.replace(/<artifact\s+title="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/artifact>/g, '<div data-artifact="true" data-title="$1" data-type="$2">$3</div>');
    return res;
  }, [content]);

  return (
    <div className={`prose prose-invert max-w-none text-[15px] leading-relaxed text-neutral-100 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }: any) {
            const inline = 'inline' in props && Boolean(props.inline);
            const match = /language-(\w+)/.exec(className || '');
            const language = match?.[1] || '';
            const codeContent = String(children).replace(/\n$/, '');

            if (!inline && language === 'mermaid') return <MermaidDiagram source={codeContent} />;
            if (!inline && (language === 'artifact-json' || language === 'json')) {
              const renderedArtifact = renderArtifactJson(codeContent);
              if (renderedArtifact) return renderedArtifact;
            }

            return !inline ? (
              <div className="my-3.5 overflow-hidden rounded-xl border border-white/[0.08] bg-black/50 shadow-sm">
                <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-neutral-400">
                  <span>{language || 'code'}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(codeContent)}
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-neutral-300 transition hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                </div>
                <SyntaxHighlighter
                  PreTag="div"
                  language={language || 'text'}
                  style={atomDark as never}
                  customStyle={{ margin: 0, background: 'transparent', padding: '1rem', fontSize: '13px' }}
                  {...props}
                >
                  {codeContent}
                </SyntaxHighlighter>
              </div>
            ) : (
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-amber-300" {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <div className="my-0">{children}</div>;
          },
          table({ children }) {
            return (
              <div className="my-4 overflow-x-auto rounded-xl border border-white/[0.1] bg-black/30 shadow-md">
                <table className="min-w-full border-collapse text-[13px]">{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-b border-white/[0.1] bg-white/[0.06] px-4 py-2.5 text-left font-semibold text-neutral-200">
                {children}
              </th>
            );
          },
          td({ children }) {
            return <td className="border-b border-white/[0.06] px-4 py-2.5 text-neutral-300">{children}</td>;
          },
          mark({ children }) {
            return (
              <mark className="bg-amber-500/25 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium no-underline">
                {children}
              </mark>
            );
          },
          blockquote({ children, node, ...props }: any) {
            const textContent = node?.children?.map((child: any) => child?.children?.map((part: any) => part?.value || '').join('') || '').join(' ') || '';
            let alertType = '';
            if (textContent.includes('[!NOTE]')) alertType = 'note';
            else if (textContent.includes('[!IMPORTANT]')) alertType = 'important';
            else if (textContent.includes('[!TIP]')) alertType = 'tip';
            else if (textContent.includes('[!WARNING]')) alertType = 'warning';
            else if (textContent.includes('[!CAUTION]')) alertType = 'caution';

            if (alertType) {
              const config: Record<string, { icon: any; title: string; border: string; bg: string; text: string }> = {
                note: { icon: Info, title: 'Note', border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-300' },
                important: { icon: AlertCircle, title: 'Important', border: 'border-purple-500/30', bg: 'bg-purple-500/10', text: 'text-purple-300' },
                tip: { icon: CheckCircle2, title: 'Tip', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-300' },
                warning: { icon: AlertTriangle, title: 'Warning', border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300' },
                caution: { icon: XOctagon, title: 'Caution', border: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-300' },
              };
              const cfg = config[alertType];
              const Icon = cfg.icon;

              return (
                <div className={`my-3.5 rounded-xl border ${cfg.border} ${cfg.bg} p-3.5 shadow-sm`}>
                  <div className={`flex items-center gap-2 font-semibold ${cfg.text} mb-1 text-[13.5px]`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{cfg.title}</span>
                  </div>
                  <div className="text-[13px] text-neutral-300 leading-relaxed pl-6">{children}</div>
                </div>
              );
            }

            return (
              <blockquote className="my-3 border-l border-white/20 pl-3 py-0.5 text-neutral-300 [&_em]:not-italic">
                {children}
              </blockquote>
            );
          },
          a({ children, href }) {
            const formMatch = href ? /(?:\/forms\/|\/apply\/|[?&]form=)([a-zA-Z0-9_-]+)/.exec(href) : null;
            if (formMatch) {
              return (
                <a
                  className="inline-flex items-center gap-1 rounded-md border border-[#D97757]/40 bg-[#D97757]/15 px-2 py-0.5 text-xs font-semibold text-[#F4B39D] no-underline hover:bg-[#D97757]/25 transition-colors cursor-pointer"
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('bwenge:open-public-form', { detail: { formId: formMatch[1] } }));
                  }}
                >
                  <FileText className="h-3 w-3" />
                  {children}
                </a>
              );
            }
            return (
              <a
                className="text-amber-400 underline decoration-amber-500/40 underline-offset-2 hover:decoration-amber-500 transition-colors"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {children}
              </a>
            );
          },
          div({ children, className, ...props }: any) {
            if (props['data-artifact']) {
              return <ArtifactCard title={props['data-title'] || 'Artifact'} type={props['data-type']}>{children}</ArtifactCard>;
            }
            return <div className={className} {...props}>{children}</div>;
          },
          p({ children }) {
            return <div className="mb-3 leading-relaxed [&_em]:not-italic">{children}</div>;
          },
          em({ children }) {
            return <em className="not-italic">{children}</em>;
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
