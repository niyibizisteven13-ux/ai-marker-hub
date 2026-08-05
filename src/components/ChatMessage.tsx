import React, { useState } from 'react';
import { Check, Copy, Eye, FileText, Image as ImageIcon, RotateCcw, Share2, ThumbsDown, ThumbsUp } from 'lucide-react';

interface ChatMessageProps {
  message: any;
  onPreviewDoc?: (doc: any) => void;
  onRegenerate?: (messageId: string) => void;
  onShare?: (messageId: string, text: string) => void;
}

function formatFileSize(size: number | string | undefined) {
  if (typeof size === 'number') {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (typeof size === 'string') return size;
  return undefined;
}

function isImageAttachment(doc: any) {
  const mime: string = doc?.type ?? doc?.mimeType ?? '';
  const name: string = doc?.name ?? '';
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
}

export default function ChatMessage({ message, onPreviewDoc, onRegenerate, onShare }: ChatMessageProps) {
  const isUser = message.sender === 'user' || message.role === 'user';
  const messageId: string = message.id ?? '';
  const text: string = message.text || message.content || '';

  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleShare = async () => {
    if (!text) return;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setShared(true);
      onShare?.(messageId, text);
      window.setTimeout(() => setShared(false), 1500);
    } catch {
      // Person cancelled the native share sheet — nothing to do.
    }
  };

  let sentAt = new Date(message.timestamp || Date.now());
  if (Number.isNaN(sentAt.getTime())) {
    sentAt = new Date();
  }

  const formattedTime = sentAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex gap-2.5 text-xs ${isUser ? 'justify-end' : 'justify-start'} group mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 font-bold text-[10px] shrink-0 mt-0.5">
          ✦
        </div>
      )}

      <div className="max-w-[88%] space-y-1.5">
        <div
          className={`p-3 rounded-2xl leading-relaxed shadow-sm ${
            isUser
              ? 'bg-slate-800 text-slate-100 rounded-tr-xs border border-slate-700/50'
              : 'bg-[#121722]/95 text-slate-200 border border-slate-800 rounded-tl-xs'
          }`}
        >
          {message.attachments?.map((doc: any, i: number) => {
            const isImage = isImageAttachment(doc);
            const previewUrl: string | undefined = doc?.previewUrl ?? doc?.url;
            const sizeLabel = formatFileSize(doc.size);

            return (
              <div
                key={i}
                onClick={() => onPreviewDoc?.(doc)}
                className="mb-2 flex items-center gap-2.5 p-2 rounded-xl bg-slate-900/90 border border-slate-700/60 hover:border-orange-500/50 cursor-pointer transition group/doc"
              >
                {isImage && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="w-8 h-8 rounded-lg object-cover shrink-0 border border-slate-700/60"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0">
                    {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-slate-200 truncate group-hover/doc:text-orange-400 transition">
                    {doc.name || 'Attachment'}
                  </p>
                  <p className="text-[9px] text-slate-500 uppercase tracking-wider">
                    {[sizeLabel, 'Tap to view'].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Eye className="h-3.5 w-3.5 text-slate-500 group-hover/doc:text-white transition shrink-0" />
              </div>
            );
          })}

          {text && <div className="whitespace-pre-wrap">{text}</div>}
        </div>

        {!isUser && (
          <div className="flex items-center gap-2.5 px-1 text-[10px] text-slate-500">
            <span className="tabular-nums">{formattedTime}</span>

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
              {text && (
                <button
                  type="button"
                  onClick={handleCopy}
                  title="Copy text"
                  aria-label="Copy text"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => onRegenerate?.(messageId)}
                title="Regenerate"
                aria-label="Regenerate"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <span className="mx-1 h-3.5 w-px bg-slate-800" aria-hidden="true" />

              <button
                type="button"
                onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
                title="Good response"
                aria-label="Good response"
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-slate-800 ${
                  feedback === 'up' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
                title="Bad response"
                aria-label="Bad response"
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-slate-800 ${
                  feedback === 'down' ? 'text-rose-400' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>

              {text && (
                <>
                  <span className="mx-1 h-3.5 w-px bg-slate-800" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={handleShare}
                    title="Share"
                    aria-label="Share"
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-slate-800 ${
                      shared ? 'text-orange-400' : 'text-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}