import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy, MoreHorizontal, RefreshCw, Share2, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';

interface AiResponseViewProps {
  content: string;
  messageId: string;
  onCopy?: (messageId: string, text: string) => void;
  onRegenerate?: (messageId: string, text: string) => void;
  onFeedback?: (messageId: string, feedback: 'positive' | 'negative') => void;
  onShare?: (messageId: string, text: string) => void;
}

/** Small, muted icon button used for the action row beneath a response. */
function ActionButton({
  active,
  activeClass,
  hoverClass,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  activeClass: string;
  hoverClass: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D97757]/50 ${
        active ? activeClass : `hover:bg-stone-800/70 ${hoverClass}`
      }`}
    >
      {children}
    </button>
  );
}

export function AiResponseView({ content, messageId, onCopy, onRegenerate, onFeedback, onShare }: AiResponseViewProps) {
  const [displayText, setDisplayText] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  useEffect(() => {
    setDisplayText('');
    setIsStreaming(true);

    if (!content) {
      setIsStreaming(false);
      return;
    }

    const characters = content.split('');
    let index = 0;

    const interval = window.setInterval(() => {
      setDisplayText((prev) => prev + characters[index]);
      index += 1;

      if (index >= characters.length) {
        window.clearInterval(interval);
        setIsStreaming(false);
      }
    }, 12);

    return () => window.clearInterval(interval);
  }, [content]);

  const visibleText = useMemo(() => (isStreaming ? displayText : content), [content, displayText, isStreaming]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    onCopy?.(messageId, content);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleFeedback = (value: 'positive' | 'negative') => {
    setFeedback((prev) => (prev === value ? null : value));
    onFeedback?.(messageId, value);
  };

  const handleReadAloud = () => {
    setShowMoreMenu(false);
    if (!('speechSynthesis' in window) || !content) return;
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleShare = async () => {
    if (!content) return;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: content });
      } else {
        await navigator.clipboard.writeText(content);
      }
      setShared(true);
      onShare?.(messageId, content);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // Person cancelled the native share sheet — nothing to do.
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="prose prose-invert max-w-none text-[13.5px] leading-relaxed text-stone-200 prose-p:my-2.5 prose-headings:font-semibold prose-headings:text-stone-100 prose-strong:text-stone-100 prose-li:my-0.5 prose-hr:border-stone-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            code({ className, children, ...props }: any) {
              const inline = 'inline' in props && Boolean(props.inline);
              const match = /language-(\w+)/.exec(className || '');
              const language = match?.[1] || '';
              const codeContent = String(children).replace(/\n$/, '');

              return !inline ? (
                <div className="my-3.5 overflow-hidden rounded-xl border border-stone-800 bg-stone-900 shadow-sm">
                  <div className="flex items-center justify-between border-b border-stone-800 bg-stone-950/60 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-[0.15em] text-stone-500">
                    <span>{language || 'code'}</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(codeContent)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </button>
                  </div>
                  <SyntaxHighlighter
                    PreTag="div"
                    language={language || 'text'}
                    style={atomDark as never}
                    customStyle={{ margin: 0, background: 'transparent', padding: '0.85rem 1rem', fontSize: '12.5px' }}
                    {...props}
                  >
                    {codeContent}
                  </SyntaxHighlighter>
                </div>
              ) : (
                <code className="rounded bg-stone-800/80 px-1.5 py-0.5 font-mono text-[12.5px] text-[#E38B67]" {...props}>
                  {children}
                </code>
              );
            },
            pre({ children }) {
              return <div className="my-0">{children}</div>;
            },
            table({ children }) {
              return (
                <div className="my-3.5 overflow-x-auto rounded-xl border border-stone-800">
                  <table className="min-w-full border-collapse text-[12.5px]">{children}</table>
                </div>
              );
            },
            th({ children }) {
              return (
                <th className="border-b border-stone-800 bg-stone-900/80 px-3 py-2 text-left font-semibold text-stone-200">
                  {children}
                </th>
              );
            },
            td({ children }) {
              return <td className="border-b border-stone-800/70 px-3 py-2 text-stone-300">{children}</td>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="my-3 border-l-2 border-[#D97757]/60 pl-3 text-stone-400">{children}</blockquote>
              );
            },
            a({ children, href }) {
              return (
                <a
                  className="text-[#E38B67] underline decoration-[#D97757]/40 underline-offset-2 hover:decoration-[#D97757]"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {visibleText}
        </ReactMarkdown>
        {isStreaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-0.5 animate-pulse rounded-sm bg-stone-500 motion-reduce:animate-none" />
        )}
      </div>

      {!isStreaming && (
        <div className="flex items-center gap-0.5 animate-in fade-in duration-200">
          <ActionButton
            label={copied ? 'Copied' : 'Copy response'}
            onClick={handleCopy}
            active={copied}
            activeClass="text-emerald-400"
            hoverClass="hover:text-stone-200"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </ActionButton>

          <ActionButton
            label="Regenerate"
            onClick={() => onRegenerate?.(messageId, content)}
            activeClass=""
            hoverClass="hover:text-[#E38B67]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </ActionButton>

          <span className="mx-1 h-4 w-px bg-stone-800" aria-hidden="true" />

          <ActionButton
            label="Good response"
            onClick={() => handleFeedback('positive')}
            active={feedback === 'positive'}
            activeClass="text-emerald-400 bg-emerald-500/10"
            hoverClass="hover:text-emerald-300"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </ActionButton>

          <ActionButton
            label="Needs work"
            onClick={() => handleFeedback('negative')}
            active={feedback === 'negative'}
            activeClass="text-rose-400 bg-rose-500/10"
            hoverClass="hover:text-rose-300"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </ActionButton>

          <span className="mx-1 h-4 w-px bg-stone-800" aria-hidden="true" />

          <ActionButton
            label={shared ? 'Shared' : 'Share response'}
            onClick={handleShare}
            active={shared}
            activeClass="text-[#E38B67]"
            hoverClass="hover:text-stone-200"
          >
            {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          </ActionButton>

          <div className="relative">
            <ActionButton
              label="More actions"
              onClick={() => setShowMoreMenu((v) => !v)}
              active={showMoreMenu}
              activeClass="text-stone-200 bg-stone-800/70"
              hoverClass="hover:text-stone-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </ActionButton>

            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-stone-800 bg-stone-900 py-1 text-[12.5px] text-stone-200 shadow-2xl">
                  <button
                    type="button"
                    onClick={handleReadAloud}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-stone-800/80"
                  >
                    <Volume2 className="h-3.5 w-3.5 text-stone-400" />
                    Read aloud
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}