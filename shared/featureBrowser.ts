export type BrowserAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'scroll'; direction: 'up' | 'down' };

export type BrowserViewport = 'phone' | 'desktop';
export const browserActionLimit = 12;

export function chatBrowserProject(text: string) {
  return text.match(/^\[Open app\]\(\/builder\?workspace=custom&project=(session-[a-z0-9-]{1,70})\)$/im)?.[1];
}
