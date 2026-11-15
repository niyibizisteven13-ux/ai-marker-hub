/** Plain-language reason for a camera (getUserMedia) failure, for students. Says what to do, including inside the MySEB desktop app. */
export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  const inApp = typeof navigator !== 'undefined' && /MySEB\//.test(navigator.userAgent);
  const win = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  const mac = typeof navigator !== 'undefined' && /Mac OS/i.test(navigator.userAgent);
  const android = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const system = android ? ' On your phone: Settings → Apps → MySEB → Permissions → Camera → Allow, then open MySEB again.'
    : win ? ' On Windows: Settings → Privacy & security → Camera → turn on "Camera access" and "Let desktop apps access your camera".'
    : mac ? ' On a Mac: System Settings → Privacy & Security → Camera → turn on MySEB (or your browser).' : '';
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'The camera only works on the secure (https) address of this site.';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'Another program is using your camera (a call, a screen recorder, another browser tab). Close it, then try again.' + system;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Plug one in or check it is switched on, then try again.' + system;
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return (inApp ? (android ? 'Your phone is not letting MySEB use the camera.' : 'Your computer is not letting MySEB use the camera.') : 'The camera is blocked for this page. Click the lock icon in the address bar and allow the camera.') + system;
  }
  return 'The camera could not be started.' + system;
}
