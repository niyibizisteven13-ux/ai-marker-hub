import React, { useEffect, useRef, useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { Check, Copy, MoreHorizontal, RefreshCw, Share2, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { AttachmentCards } from './AttachmentCards';
import { SourceList } from './SourceList';
import type { AttachmentRef, SourcePassage } from './types';

interface AiResponseViewProps {
  content: string;
  messageId: string;
  /** Files the AI created for this message (documents, drawings, charts, ...). */
  attachments?: AttachmentRef[];
  /** Knowledge-base passages the answer used. */
  sources?: SourcePassage[];
  /** Typewriter reveal. Pass false for messages loaded from history. Default true. */
  animate?: boolean;
  /** Language for "Read aloud". Browsers rarely have a Kinyarwanda voice, so it falls back to the default voice. */
  locale?: 'en' | 'rw' | 'fr';
  onCopy?: (messageId: string, text: string) => void;
  onRegenerate?: (messageId: string, text: string) => void;
  onFeedback?: (messageId: string, feedback: 'positive' | 'negative') => void;
  onShare?: (messageId: string, text: string) => void;
}

const SPEECH_LANG = { en: 'en-US', fr: 'fr-FR', rw: 'rw-RW' } as const;

/** Small, muted icon button used for the action row beneath a response. */
function ActionButton({ active, activeClass, hoverClass, label, onClick, children }: {
  active?: boolean; activeClass: string; hoverClass: string; label: string; onClick: () => void; children: React.ReactNode;
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

export function AiResponseView({ content, messageId, attachments, sources, animate = true, locale = 'en', onCopy, onRegenerate, onFeedback, onShare }: AiResponseViewProps) {
  const [displayText, setDisplayText] = useState(animate ? '' : content);
  const [isStreaming, setIsStreaming] = useState(animate && !!content);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const shown = useRef(animate ? 0 : content.length);

  useEffect(() => {
    if (!animate || !content) {
      shown.current = content.length;
      setDisplayText(content);
      setIsStreaming(false);
      return;
    }
    // If the text only grew (live streaming), continue from where we were instead of restarting.
    const start = displayText && content.startsWith(displayText) ? displayText.length : 0;
    shown.current = start;
    setIsStreaming(true);
    // Reveal in chunks so even long answers finish in about two seconds.
    const step = Math.max(1, Math.ceil((content.length - start) / 160));
    const interval = window.setInterval(() => {
      shown.current = Math.min(content.length, shown.current + step);
      setDisplayText(content.slice(0, shown.current));
      if (shown.current >= content.length) {
        window.clearInterval(interval);
        setIsStreaming(false);
      }
    }, 12);
    return () => window.clearInterval(interval);
    // displayText is intentionally read once per content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, animate]);

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.(messageId, content);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; nothing to do */
    }
  };

  const handleFeedback = (value: 'positive' | 'negative') => {
    setFeedback((prev) => (prev === value ? null : value));
    onFeedback?.(messageId, value);
  };

  const handleReadAloud = () => {
    setShowMoreMenu(false);
    if (!('speechSynthesis' in window) || !content) return;
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = SPEECH_LANG[locale];
    utterance.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleShare = async () => {
    if (!content) return;
    try {
      if (typeof navigator.share === 'function') await navigator.share({ text: content });
      else await navigator.clipboard.writeText(content);
      setShared(true);
      onShare?.(messageId, content);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      /* the person cancelled the share sheet */
    }
  };

  return (
    <div className="space-y-2.5">
      <div>
        <MarkdownRenderer content={isStreaming ? displayText : content} />
        {isStreaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-0.5 animate-pulse rounded-sm bg-stone-500 motion-reduce:animate-none" />}
      </div>

      {!isStreaming && (
        <>
          <AttachmentCards attachments={attachments} />
          <SourceList sources={sources} />
          <div className="flex items-center gap-0.5">
            <ActionButton label={copied ? 'Copied' : 'Copy response'} onClick={handleCopy} active={copied} activeClass="text-emerald-400" hoverClass="hover:text-stone-200">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </ActionButton>
            <ActionButton label="Regenerate" onClick={() => onRegenerate?.(messageId, content)} activeClass="" hoverClass="hover:text-[#E38B67]">
              <RefreshCw className="h-3.5 w-3.5" />
            </ActionButton>
            <span className="mx-1 h-4 w-px bg-stone-800" aria-hidden="true" />
            <ActionButton label="Good response" onClick={() => handleFeedback('positive')} active={feedback === 'positive'} activeClass="text-emerald-400 bg-emerald-500/10" hoverClass="hover:text-emerald-300">
              <ThumbsUp className="h-3.5 w-3.5" />
            </ActionButton>
            <ActionButton label="Needs work" onClick={() => handleFeedback('negative')} active={feedback === 'negative'} activeClass="text-rose-400 bg-rose-500/10" hoverClass="hover:text-rose-300">
              <ThumbsDown className="h-3.5 w-3.5" />
            </ActionButton>
            <span className="mx-1 h-4 w-px bg-stone-800" aria-hidden="true" />
            <ActionButton label={shared ? 'Shared' : 'Share response'} onClick={handleShare} active={shared} activeClass="text-[#E38B67]" hoverClass="hover:text-stone-200">
              {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            </ActionButton>
            <div className="relative">
              <ActionButton label="More actions" onClick={() => setShowMoreMenu((v) => !v)} active={showMoreMenu} activeClass="text-stone-200 bg-stone-800/70" hoverClass="hover:text-stone-200">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </ActionButton>
              {showMoreMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                  <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-stone-800 bg-stone-900 py-1 text-[12.5px] text-stone-200 shadow-2xl">
                    <button type="button" role="menuitem" onClick={handleReadAloud} className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-stone-800/80">
                      <Volume2 className="h-3.5 w-3.5 text-stone-400" /> Read aloud
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
