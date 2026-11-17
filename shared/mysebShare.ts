/**
 * The message a lecturer shares with students when a live test opens (WhatsApp, copy, the chat, the autopilot's message to the lecturer).
 * It carries the join link and code AND where to get the MySEB app, so a student who does not have it yet knows where to download it.
 * /myseb/download picks the right installer for the device that opens it (Windows, Android, Linux, Mac).
 */
export const DEFAULT_SITE = 'https://www.bwenge.space';
export const mysebDownloadUrl = (site: string) => `${String(site || DEFAULT_SITE).replace(/\/$/, '')}/myseb/download`;

export function studentInvite(o: { title?: string; joinUrl: string; code?: string; site?: string }): string {
  return [
    `Join ${o.title?.trim() || 'the test'}: ${o.joinUrl}`,
    o.code ? `Code: ${o.code}` : '',
    `Get the MySEB app (Windows, Android, Linux, Mac): ${mysebDownloadUrl(o.site || DEFAULT_SITE)}`,
    'On a laptop or an Android phone the link above opens MySEB. On an iPhone it starts in the browser.',
  ].filter(Boolean).join('\n');
}
