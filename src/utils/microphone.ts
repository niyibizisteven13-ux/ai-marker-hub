/**
 * Microphone checks with plain-language answers. Browsers report "no microphone" for several different problems
 * (blocked by the site, blocked by the computer's privacy settings, busy in another app, not plugged in), so we ask
 * the browser what it actually sees and say what to do.
 */

export type MicResult = { ok: boolean; message?: string };

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.userAgent);
const isWindows = () => /Windows/i.test(navigator.userAgent);
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|Telegram|WhatsApp|wv\)/i.test(navigator.userAgent);

function systemHint(): string {
  if (isWindows()) return 'In Windows Settings → Privacy & security → Microphone, turn on microphone access for your browser.';
  if (isMac()) return 'On a Mac: System Settings → Privacy & Security → Microphone, and turn on your browser.';
  return "Check that your phone or computer lets the browser use the microphone.";
}

/** Plain-language message for a getUserMedia failure. */
export function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (!window.isSecureContext) return 'The microphone only works on the secure (https) address of this site.';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'The microphone is blocked for this site. Click the lock icon in the address bar, set Microphone to Allow, then try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return `No microphone was detected. Plug in a headset or check the sound input. ${systemHint()}`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The microphone is busy or switched off by the computer. Close other apps using it (calls, recorders, other tabs), then try again. ' + systemHint();
  }
  if (inAppBrowser()) return 'This in-app browser cannot use the microphone. Open the page in Chrome or Safari.';
  return 'The microphone could not be started. ' + systemHint();
}

/** Asks for the microphone once (this also shows the browser's permission prompt), then releases it straight away. */
export async function checkMicrophone(): Promise<MicResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: !window.isSecureContext ? 'The microphone only works on the secure (https) address of this site.' : inAppBrowser() ? 'This in-app browser cannot use the microphone. Open the page in Chrome or Safari.' : 'This browser cannot use the microphone. Use Chrome, Edge or Safari.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (err) {
    // Some browsers give a vague error when the site is blocked; the permission list says it plainly.
    const state = await navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((s) => s.state).catch(() => null);
    if (state === 'denied') return { ok: false, message: micErrorMessage({ name: 'NotAllowedError' }) };
    return { ok: false, message: micErrorMessage(err) };
  }
}

/** After speech recognition reports "audio-capture": work out why, in words. */
export async function explainCaptureFailure(): Promise<string> {
  const check = await checkMicrophone();
  if (!check.ok) return check.message ?? '';
  // The microphone works for recording, so voice typing itself could not reach it (often another tab or app holds it).
  return 'Voice typing could not use the microphone. Close other tabs or apps that are using it, then try again.';
}
