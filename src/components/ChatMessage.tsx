import React, { Suspense, lazy, useState } from 'react';

const ChatMarkingCard = lazy(() => import('./ChatMarkingCard'));
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
import ActivityLine from './ActivityLine';
import Spark from './Spark';
import DynamicForm from './DynamicForm';
import AnalyticsDashboard from './AnalyticsDashboard';
import { lazy as lazyLoad, Suspense as LazyBoundary } from 'react';
const MarkdownRendererLazy = lazyLoad(() => import('./MarkdownRenderer'));
const MarkdownRenderer = (props: any) => <LazyBoundary fallback={null}><MarkdownRendererLazy {...props} /></LazyBoundary>;
import { AttachmentCards } from './AttachmentCards';
import { copyToClipboard } from '../utils/copyToClipboard';
import type { ResponseFeedbackDetails } from '../types';

interface ChatMessageProps {
  message: any;
  onPreviewDoc?: (doc: any) => void;
  onShare?: (messageId: string, text: string) => void;
  onFeedback?: (messageId: string, rating: 'up' | 'down', details: ResponseFeedbackDetails) => void | Promise<void>;
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
  const isServiceError = Boolean(message.errorKind || message.stopped);

  const isAuthAlert = rawText.includes('Authentication Required');

  const toolCallMatch = rawText.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  const toolOutputMatch = rawText.match(/<tool_output>([\s\S]*?)<\/tool_output>/);
  const formSchemaMatch = rawText.match(/<form_schema>([\s\S]*?)<\/form_schema>/);
  const analyticsReportMatch = rawText.match(/<analytics_report>([\s\S]*?)<\/analytics_report>/);

  const cleanText = rawText
    .replace(/<(tool_call|tool_output|form_schema|analytics_report|thinking|think)>[\s\S]*?<\/\1>/gi, '')
    .trim();

  const [copied, setCopied] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [feedbackConsent, setFeedbackConsent] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackThankYou, setFeedbackThankYou] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [chatFormId, setChatFormId] = useState<string | null>(() => {
    if (!formSchemaMatch) return null;
    try {
      const p = JSON.parse(formSchemaMatch[1]);
      return p?.id || null;
    } catch {
      return null;
    }
  });
  const [chatFormLinkCopied, setChatFormLinkCopied] = useState(false);
  const [chatFormLinkError, setChatFormLinkError] = useState(false);

  const ensureChatFormSaved = async (): Promise<string | null> => {
    if (chatFormId) return chatFormId;
    if (!formSchemaMatch) return null;
    const { authFetch } = await import('../utils/authFetch');
    let parsed: any = {};
    try { parsed = JSON.parse(formSchemaMatch[1]); } catch { parsed = {}; }
    if (parsed?.id) {
      setChatFormId(parsed.id);
      return parsed.id;
    }
    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : Array.isArray(parsed.fields) ? parsed.fields : [];
    const saveRes = await authFetch('/api/forms', {
      method: 'POST',
      body: JSON.stringify({
        title: parsed.title || 'AI Agent Form',
        description: parsed.description || '',
        questions: rawQuestions.map((q: any, idx: number) => ({
          id: String(q.id ?? q.number ?? idx + 1),
          type: String(q.type || 'SHORT_TEXT').toUpperCase(),
          title: String(q.title || q.label || q.text || `Question ${idx + 1}`),
          required: Boolean(q.required ?? false),
          points: q.points !== undefined ? Number(q.points) : undefined,
          correctAnswer: q.correctAnswer,
          options: Array.isArray(q.options) ? q.options.map((o: any, oi: number) => typeof o === 'string' ? { id: `opt_${oi}`, label: o } : o) : undefined,
        })),
        rubric: parsed.rubric || null,
      }),
    });
    const savedData = await saveRes.json().catch(() => ({}));
    const newId = savedData?.form?.id || null;
    if (newId) setChatFormId(newId);
    return newId;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sendFeedback = async (rating: 'up' | 'down', reasons: string[] = [], details = '', consentForImprovement?: boolean) => {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackError('');
    try {
      if (!onFeedback) {
        throw new Error('Feedback could not be sent from this conversation.');
      }
      await onFeedback(messageId, rating, {
        question: '',
        response: cleanText.slice(0, 20_000),
        reasons,
        details,
        consentForImprovement,
      });
      setFeedbackThankYou(true);
      setFeedbackOpen(false);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : 'Feedback could not be sent. Please try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
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
            {message.stopped
              ? 'Stopped'
              : message.errorKind === 'service_unavailable'
                ? 'Bwenge is experiencing high demand'
                : 'Bwenge could not reach the AI service'}
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
            <ActivityLine
              busy={Boolean(message.isStreaming || isThinking || (toolCallMatch && !toolOutputMatch) || message.isBusy || message.phase === 'thinking' || message.phase === 'streaming' || message.isWaiting || (!cleanText && message.isStreaming))}
              current={message.currentStatus || (isThinking ? 'Thinking...' : toolCallMatch && !toolOutputMatch ? 'Running tool...' : message.isWaiting ? 'Thinking...' : '')}
              steps={message.steps || []}
              startedAt={message.startedAt || Date.now()}
              endedAt={message.endedAt}
            />

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
              <div className="my-3 space-y-2">
                <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#1B1B19] px-4 py-2.5">
                  <div className="flex items-center gap-2 text-xs text-[#C2C0B6] min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-[#D97757]" />
                    <span className="truncate font-mono">
                      {chatFormId ? `${window.location.origin}/forms/${chatFormId}` : 'Interactive Google-style Form ready'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setChatFormLinkError(false);
                        try {
                          const fId = await ensureChatFormSaved();
                          if (fId) {
                            await copyToClipboard(new URL(`/forms/${encodeURIComponent(fId)}`, window.location.origin).toString());
                            setChatFormLinkCopied(true);
                            window.setTimeout(() => setChatFormLinkCopied(false), 1800);
                          }
                        } catch { setChatFormLinkError(true); }
                      }}
                      className="rounded-lg bg-[#D97757] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#c66849]"
                    >
                      {chatFormLinkCopied ? 'Link Copied!' : chatFormLinkError ? 'Copy failed' : chatFormId ? 'Copy Form Link' : 'Create & Copy Link'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const fId = await ensureChatFormSaved();
                        if (fId) {
                          window.dispatchEvent(new CustomEvent('bwenge:open-public-form', { detail: { formId: fId } }));
                        }
                      }}
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#FAF9F5] transition hover:bg-white/10"
                    >
                      Open Form
                    </button>
                  </div>
                </div>
                <DynamicForm
                  schema={formSchemaMatch[1]}
                  onSubmit={async (answers) => {
                    const { authFetch } = await import('../utils/authFetch');
                    const formId = await ensureChatFormSaved();
                    if (formId) {
                      const subRes = await authFetch(`/api/forms/${formId}/submit`, {
                        method: 'POST',
                        body: JSON.stringify({ answers }),
                      });
                      const subData = await subRes.json().catch(() => ({}));
                      if (!subRes.ok) {
                        throw new Error(subData.error || 'Could not submit form response.');
                      }
                      return subData;
                    }
                    return 'Form response recorded.';
                  }}
                />
              </div>
            )}

            {analyticsReportMatch && (
              <div className="my-3">
                <AnalyticsDashboard data={analyticsReportMatch[1]} />
              </div>
            )}

            {(cleanText || (message.isStreaming && !message.isWaiting)) && (
              <div className={message.isStreaming && !(!cleanText) ? "bw-caret" : undefined}>
                {cleanText && <MarkdownRenderer content={cleanText} />}
              </div>
            )}

            <AttachmentCards attachments={message.generatedAttachments} />

            {typeof message.examId === 'string' && message.sender === 'assistant' && (
              <Suspense fallback={null}><ChatMarkingCard examId={message.examId} /></Suspense>
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
          <div className="mt-3 space-y-2">
            {/* Trust Source Chips (Rendered only when message has actual sources/citations) */}
            {((message.sources && message.sources.length > 0) || (message.citations && message.citations.length > 0) || (message.sourcesUsed && message.sourcesUsed.length > 0)) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider">Sources:</span>
                {(message.sources || message.citations || message.sourcesUsed || []).map((src: any, idx: number) => {
                  const title = src.filename || src.sourceFilename || src.title || `Source ${idx + 1}`;
                  const page = src.pageNumber ? ` • p.${src.pageNumber}` : '';
                  const table = src.tableNumber ? ` • Tab ${src.tableNumber}` : '';
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => alert(`Opening Document: ${title}${page}${table}`)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-emerald-400 hover:bg-white/10 transition-colors"
                    >
                      <FileText size={12} />
                      <span>{title}{page}{table}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-1">
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
                onClick={() => void sendFeedback('up')}
              >
                <ThumbsUp className="h-4 w-4" />
              </ActionButton>
              <ActionButton
                title="Bad response"
                active={message.rating === 'down' || feedbackOpen}
                activeClass="text-rose-400 bg-rose-400/10"
                onClick={() => {
                  setFeedbackOpen((open) => !open);
                  setFeedbackError('');
                }}
              >
                <ThumbsDown className="h-4 w-4" />
              </ActionButton>
              <button
                type="button"
                onClick={() => {
                  setFeedbackOpen(true);
                  setFeedbackReason('Other');
                  setFeedbackError('');
                }}
                className="ml-2 px-2.5 py-1 rounded-lg text-[11px] text-neutral-400 hover:text-amber-400 hover:bg-white/5 transition-colors"
              >
                Report or correct
              </button>
            </div>
            {feedbackThankYou && (
              <p role="status" className="text-xs text-emerald-400">Thanks for helping us improve Bwenge.</p>
            )}
            {feedbackError && !feedbackOpen && <p role="alert" className="text-xs text-rose-300">{feedbackError}</p>}
            {feedbackOpen && (
              <form
                className="max-w-lg space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!feedbackReason) {
                    setFeedbackError('Choose what needs improvement so we can route your feedback.');
                    return;
                  }
                  void sendFeedback('down', [feedbackReason], feedbackDetails, feedbackConsent);
                }}
              >
                <div>
                  <p className="text-sm font-medium text-[#FAF9F5]">What could be better?</p>
                  <p className="mt-0.5 text-xs text-neutral-400">Your feedback goes to our support and AI quality team.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['Incorrect', 'Incomplete', 'Unclear', 'Not relevant', 'Other'].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={feedbackReason === reason}
                      onClick={() => setFeedbackReason(reason)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        feedbackReason === reason
                          ? 'border-[#D97757] bg-[#D97757]/15 text-[#F4A185]'
                          : 'border-white/10 text-neutral-300 hover:bg-white/5'
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <textarea
                  value={feedbackDetails}
                  onChange={(event) => setFeedbackDetails(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Anything else you’d like us to know? (optional)"
                  className="w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#D97757] focus:outline-none"
                />
                <label className="flex items-start gap-2 text-xs leading-relaxed text-neutral-400">
                  <input
                    type="checkbox"
                    checked={feedbackConsent}
                    onChange={(event) => setFeedbackConsent(event.target.checked)}
                    className="mt-0.5 accent-[#D97757]"
                  />
                  Allow this response and my feedback to be considered for AI improvement after human review.
                </label>
                {feedbackError && <p role="alert" className="text-xs text-rose-300">{feedbackError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackOpen(false)}
                    className="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={feedbackSubmitting}
                    className="rounded-lg bg-[#D97757] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#c66849] disabled:opacity-50"
                  >
                    {feedbackSubmitting ? 'Sending…' : 'Send feedback'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
