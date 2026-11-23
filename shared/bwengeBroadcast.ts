import { escapeEmailHtml } from '../server/email/BwengeEmailLayout.js';

export const broadcastSenderIds = ['notifications', 'billing', 'support', 'hello', 'partners'] as const;
export type BroadcastSender = typeof broadcastSenderIds[number];

export interface BroadcastDraft {
  sender?: BroadcastSender;
  subject: string;
  text: string;
  htmlSource?: string;
  videoUrl?: string;
  recipients?: string[];
  linkLabel?: string;
  linkUrl?: string;
}

export function isBroadcastLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function formatBroadcast(draft: BroadcastDraft, sanitizedBody?: string) {
  const subject = draft.subject.trim();
  const text = draft.text.trim();
  const linkLabel = draft.linkLabel?.trim();
  const linkUrl = draft.linkUrl?.trim();
  const link = linkLabel && linkUrl && isBroadcastLink(linkUrl) ? { label: linkLabel, url: linkUrl } : null;
  const videoUrl = draft.videoUrl?.trim();
  const video = videoUrl && isBroadcastLink(videoUrl) ? {
    text: `Watch video: ${videoUrl}`,
    html: `<div style="margin:20px 0;">
        <video controls preload="none" width="520" style="display:block;width:100%;max-width:520px;height:auto;">
          <source src="${escapeEmailHtml(videoUrl)}" type="video/mp4">
        </video>
        <p style="margin:12px 0 0;"><a href="${escapeEmailHtml(videoUrl)}" style="color:#4CE5D6;font-weight:bold;">Watch video</a></p>
      </div>`,
  } : null;
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) =>
    `<p style="margin:0 0 16px;overflow-wrap:anywhere;">${escapeEmailHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`,
  ).join('');

  return {
    subject,
    text: [text, video?.text, link && `${link.label}: ${link.url}`].filter(Boolean).join('\n\n'),
    html: `<h1 style="margin:0 0 20px;font-size:25px;line-height:1.3;overflow-wrap:anywhere;">${escapeEmailHtml(subject)}</h1>
      ${sanitizedBody ?? paragraphs}
      ${video?.html ?? ''}
      ${link ? `<p style="margin:20px 0 0;"><a href="${escapeEmailHtml(link.url)}" style="display:inline-block;border-radius:8px;background:#F6B94A;color:#0B1420;padding:10px 18px;font-weight:bold;text-decoration:none;">${escapeEmailHtml(link.label)}</a></p>` : ''}`,
  };
}
