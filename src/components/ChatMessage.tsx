import React, { useState } from 'react';
import {
  Check,
  Copy,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  ChevronDown,
  Terminal,
  Sparkles,
  Zap,
  Lock,
  FileText,
} from 'lucide-react';
import BwengeLoader from './BwengeLoader';
import DynamicForm from './DynamicForm';
import AnalyticsDashboard from './AnalyticsDashboard';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatMessageProps {
  message: any;
  onPreviewDoc?: (doc: any) => void;
  onShare?: (messageId: string, text: string) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down') => void;
  onRetry?: (messageId: string) => void;
  onUpgradeClick?: (jobId: string, service: string) => void;
}

const CollapsibleBlock = ({
  title,
  icon: Icon = Terminal,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.09]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-3 py-2 text-[12px] text-neutral-400 transition-colors hover:text-neutral-200"
      >
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 opacity-70" />
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/[0.06] px-3 py-2.5 text-[12.5px] leading-relaxed text-neutral-400">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

const ActionButton = ({
  onClick,
  active,
  activeClass,
  title,
  children,
}: {
  onClick?: () => void;
  active?: boolean;
  activeClass?: string;
  title: string;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    className={`rounded-lg p-2.5 lg:p-1.5 text-[#9C9A92] transition-all duration-150 hover:scale-105 hover:bg-white/5 hover:text-[#FAF9F5] active:scale-95 ${
      active ? activeClass : ''
    }`}
  >
    {children}
  </button>
);

export default function ChatMessage({
  message,
  onPreviewDoc,
  onShare,
  onFeedback,
  onRetry,
  onUpgradeClick,
}: ChatMessageProps) {
  const isUser = message.sender === 'user' || message.role === 'user';
  const messageId: string = message.id ?? '';
  const rawText: string = message.text || message.content || '';
  const thinkingText: string = message.thinkingText || '';
  const isThinking: boolean = message.isThinking === true;
  const isGated = message.gated === true;
  const isServiceError = Boolean(message.errorKind);

  const isAuthAlert = rawText.includes('Authentication Required');

  const toolCallMatch = rawText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  const toolOutputMatch = rawText.match(/<tool_output>([\s\S]*?)<\/tool_output>/);
  const formSchemaMatch = rawText.match(/<form_schema>([\s\S]*?)<\/form_schema>/);
  const analyticsReportMatch = rawText.match(/<analytics_report>([\s\S]*?)<\/analytics_report>/);

  const cleanText = rawText
    .replace(/<(tool_call|tool_output|form_schema|analytics_report|thinking|think)>[\s\S]*?<\/\1>/gi, '')
    .trim();

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const attachments = message.attachments ?? (message.attachment ? [message.attachment] : []);

  if (isAuthAlert && !isUser) {
    return (
      <div className="flex w-full animate-in fade-in slide-in-from-bottom-1 justify-start duration-200">
        <div className="flex max-w-[90%] items-center gap-2.5 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] px-3.5 py-2.5 text-[13px] text-amber-400/90">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <Lock className="h-3.5 w-3.5" />
          </span>
          <span className="leading-relaxed">{cleanText.replace('🔒', '').trim()}</span>
        </div>
      </div>
    );
  }

  if (isServiceError && !isUser) {
    return (
      <div className="flex w-full justify-start animate-in fade-in slide-in-from-bottom-1 duration-200">
        <div className="max-w-full rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-[#FAF9F5] sm:max-w-[min(90%,42rem)]">
          <p className="text-sm font-semibold text-amber-200">
            {message.errorKind === 'service_unavailable' ? 'Bwenge is experiencing high demand' : 'Bwenge could not reach the AI service'}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#C2C0B6]">{cleanText}</p>
          {onRetry && (
            <button type="button" onClick={() => onRetry(messageId)} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200">
              <RotateCcw className="h-4 w-4" /> Retry generation
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex w-full animate-in fade-in slide-in-from-bottom-1 duration-200 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      <div className={`group flex flex-col ${isUser ? 'max-w-[85%] items-end' : 'w-full max-w-full items-start'}`}>
        {/* User attachments rendered above the bubble */}
        {isUser && attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 justify-end">
            {attachments.map((att: any, idx: number) => (
              <button
                key={idx}
                type="button"
                onClick={() => onPreviewDoc?.(att)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#30302E] px-3 py-2 text-xs text-[#FAF9F5] hover:bg-white/10 transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-[#5DCAA5]" />
                <span className="max-w-[140px] truncate">{att.name || att.fileName || 'Attachment'}</span>
              </button>
            ))}
          </div>
        )}

        {isUser ? (
          <div className="rounded-3xl bg-[#141413] px-4 py-2.5 text-base leading-[1.6] text-[#FAF9F5] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
            {toolCallMatch && !toolOutputMatch ? null : cleanText}
          </div>
        ) : (
          <div className="w-full text-base leading-[1.7] text-[#FAF9F5]">
            {toolCallMatch && !toolOutputMatch && (
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <BwengeLoader />
                <span className="text-[12.5px] text-[#C2C0B6]">Running tool…</span>
              </div>
            )}

            {toolOutputMatch && (
              <CollapsibleBlock title="Tool output">
                <pre className="overflow-x-auto rounded-md bg-black/30 p-2.5 font-mono text-[11.5px] text-emerald-400/80">
                  {toolOutputMatch[1]}
                </pre>
              </CollapsibleBlock>
            )}

            {thinkingText && thinkingText.length > 20 && (
              <CollapsibleBlock title={isThinking ? 'Thinking…' : 'Thought process'} icon={Sparkles}>
                <div className="whitespace-pre-wrap font-mono italic text-[#9C9A92]">
                  {thinkingText.replace(/<\/?thinking>/g, '').trim()}
                  {isThinking && (
                    <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />
                  )}
                </div>
              </CollapsibleBlock>
            )}

            {formSchemaMatch && (
              <div className="my-3">
                <DynamicForm
                  schema={formSchemaMatch[1]}
                  onSubmit={(data) => {
                    console.log('Form submitted:', data);
                  }}
                />
              </div>
            )}

            {analyticsReportMatch && (
              <div className="my-3">
                <AnalyticsDashboard data={analyticsReportMatch[1]} />
              </div>
            )}

            {(cleanText || message.isStreaming) && (
              <div>
                {cleanText ? (
                  <MarkdownRenderer content={cleanText} />
                ) : (
                  <span className="flex items-center gap-2 py-1 italic text-[#9C9A92]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Thinking…
                  </span>
                )}
                {message.isStreaming && cleanText && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 -translate-y-0.5 animate-pulse rounded-sm bg-emerald-400/80" />
                )}
              </div>
            )}

            {isGated && onUpgradeClick && (
              <div className="mt-4">
                <button
                  onClick={() => {
                    const url = new URL(rawText.match(/\((.*?)\)/)?.[1] || '', window.location.origin);
                    const jobId = url.searchParams.get('jobId') || '';
                    const service = url.searchParams.get('service') || '';
                    onUpgradeClick(jobId, service);
                  }}
                  className="group/upgrade flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-[13.5px] font-medium text-amber-400 transition-all duration-150 hover:border-amber-500/30 hover:bg-amber-500/15"
                >
                  <Zap
                    className="h-4 w-4 transition-transform duration-150 group-hover/upgrade:scale-110"
                    fill="currentColor"
                  />
                  Unlock full result
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action row: opacity-100 on mobile, lg:opacity-0 lg:group-hover:opacity-100 on desktop */}
        {!isUser && cleanText && !message.isStreaming && (
          <div className="mt-2 flex items-center gap-1 opacity-100 lg:opacity-0 lg:transition-opacity lg:duration-150 lg:group-hover:opacity-100">
            {message.provider && (
              <span className="hidden lg:inline-block mr-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#9C9A92]">
                {message.provider}
              </span>
            )}
            <ActionButton title="Copy" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </ActionButton>
            {onRetry && (
              <ActionButton title="Try again" onClick={() => onRetry(messageId)}>
                <RotateCcw className="h-4 w-4" />
              </ActionButton>
            )}
            <ActionButton
              title="Good response"
              active={message.rating === 'up'}
              activeClass="text-emerald-400 bg-emerald-400/10"
              onClick={() => onFeedback?.(messageId, 'up')}
            >
              <ThumbsUp className="h-4 w-4" />
            </ActionButton>
            <ActionButton
              title="Bad response"
              active={message.rating === 'down'}
              activeClass="text-rose-400 bg-rose-400/10"
              onClick={() => onFeedback?.(messageId, 'down')}
            >
              <ThumbsDown className="h-4 w-4" />
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
