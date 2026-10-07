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
} from 'lucide-react';
import 'katex/dist/katex.min.css';

type ChartPoint = Record<string, string | number>;

function MermaidDiagram({ source }: { source: string }) {
  return <div className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/70 p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Diagram source</div><pre className="text-xs text-neutral-300">{source}</pre></div>;
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
    if (artifact?.type !== 'chart' || !['bar', 'line', 'scatter'].includes(artifact.chartType) || typeof artifact.title !== 'string' || typeof artifact.xKey !== 'string' || typeof artifact.yKey !== 'string' || !Array.isArray(artifact.data) || !artifact.data.every((row: unknown) => row && typeof row === 'object' && !Array.isArray(row))) return null;
    return <ChartArtifact title={artifact.title} chartType={artifact.chartType} xKey={artifact.xKey} yKey={artifact.yKey} data={artifact.data} />;
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
            if (!inline && language === 'artifact-json') {
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
