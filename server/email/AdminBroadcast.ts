import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { broadcastSenderIds, formatBroadcast, isBroadcastLink } from '../../shared/bwengeBroadcast.js';

export const broadcastDraftSchema = z.object({
  sender: z.enum(broadcastSenderIds).optional(),
  subject: z.string().trim().min(1).max(180).regex(/^[^\r\n]+$/),
  text: z.string().trim().max(10_000),
  linkLabel: z.string().trim().max(80).optional(),
  linkUrl: z.string().trim().max(2048).optional(),
  expectedRecipients: z.number().int().positive().optional(),
  htmlSource: z.string().trim().max(20_000).optional(),
  videoUrl: z.string().trim().max(2048).refine((value) => !value || isBroadcastLink(value)).optional(),
  recipients: z.array(z.string().trim().email().max(254)).min(1).max(25).optional(),
}).refine(({ text, htmlSource }) => Boolean(text || htmlSource))
  .refine(({ linkLabel, linkUrl }) => !linkLabel && !linkUrl || Boolean(linkLabel && linkUrl && isBroadcastLink(linkUrl)));

export function formatAdminBroadcast(draft: z.infer<typeof broadcastDraftSchema>) {
  const body = draft.htmlSource && sanitizeHtml(draft.htmlSource, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor'],
      table: ['role', 'cellpadding', 'cellspacing', 'border'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      a: ['href'],
      img: ['src', 'alt'],
    },
    allowedStyles: {
      '*': Object.fromEntries([
        'background', 'background-color', 'border', 'border-color', 'border-radius',
        'box-sizing', 'color', 'display', 'font', 'font-family', 'font-size', 'font-weight',
        'height', 'letter-spacing', 'line-height', 'margin', 'max-height', 'max-width',
        'min-height', 'opacity', 'overflow', 'padding', 'text-align', 'text-decoration',
        'vertical-align', 'width', ...['top', 'right', 'bottom', 'left'].flatMap(
          (side) => [`margin-${side}`, `padding-${side}`, `border-${side}`],
        ),
      ].map((property) => [property, [/^[a-z0-9#%.,\s'"-]+$/i]])),
    },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    nonTextTags: ['style', 'script', 'textarea', 'option', 'title'],
    transformTags: { a: (tagName, attributes) => ({
      tagName,
      attribs: attributes.href && (isBroadcastLink(attributes.href) || attributes.href.startsWith('mailto:'))
        ? attributes : {},
    }) },
  }).trim();
  const text = draft.text || (body ? sanitizeHtml(body.replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?>/gi, '$&\n'), {
    allowedTags: [],
    allowedAttributes: {},
  }).replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  }[entity] ?? entity)).trim().slice(0, 10_000) : '');
  return formatBroadcast({ ...draft, text }, body || undefined);
}
