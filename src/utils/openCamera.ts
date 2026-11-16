/**
 * Opens the student's camera in a way that copes with the usual phone problems.
 *
 * A phone camera can be held by only one app at a time. When another app has it (a call, the camera app, a screen recorder, another
 * tab) the browser says "NotReadableError" even though everything is allowed. That is not final: the other app may let go in a moment,
 * and the same camera can often be opened with simpler settings or by choosing the camera from the list. So this tries, in order:
 *   1. the front camera with the settings we want,
 *   2. the front camera with no other wishes (some phones refuse a size or frame rate while another app is using the camera),
 *   3. any camera,
 *   4. each camera on the device by name,
 * and then does the whole round again after a short pause. A refusal by the student or the phone ("not allowed") stops at once: trying
 * again would only ask again. If the microphone is the part that is busy, the picture is still opened without it.
 */
export type CameraTry = { attempt: number; total: number };
export interface OpenCameraOptions {
  video?: MediaTrackConstraints;
  audio?: MediaStreamConstraints['audio'];
  /** How many full rounds before giving up (default 2). */
  rounds?: number;
  /** Pause between rounds in ms (default 800). */
  pauseMs?: number;
  onTry?: (t: CameraTry) => void;
  /** For tests. */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;
}

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? '';
/** Another app (or tab) holds the camera, or it could not start: worth trying again. */
export const isBusyCameraError = (e: unknown) => ['NotReadableError', 'TrackStartError', 'AbortError'].includes(errName(e));
/** The student or the phone said no: do not keep asking. */
export const isPermissionCameraError = (e: unknown) => ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(errName(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function openCamera(o: OpenCameraOptions = {}): Promise<MediaStream> {
  const md = o.mediaDevices ?? navigator.mediaDevices;
  const rounds = Math.max(1, o.rounds ?? 2);
  const wantAudio = !!o.audio;
  let last: unknown = new Error('The camera could not be started.');
  let n = 0;
  for (let round = 0; round < rounds; round++) {
    const list: MediaStreamConstraints[] = [
      { video: { facingMode: 'user', ...(o.video ?? {}) }, audio: o.audio ?? false },
      ...(wantAudio ? [{ video: { facingMode: 'user', ...(o.video ?? {}) }, audio: false } as MediaStreamConstraints] : []),   // the microphone is busy: the picture matters more
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    // Each camera by name. Names are only given once the camera was allowed, so this is skipped when permission is the problem.
    if (!isPermissionCameraError(last)) {
      try {
        const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
        for (const c of cams) list.push({ video: { deviceId: { exact: c.deviceId } }, audio: false });
      } catch { /* no list: the tries above are enough */ }
    }
    for (const c of list) {
      o.onTry?.({ attempt: ++n, total: rounds * list.length });
      try { return await md.getUserMedia(c); }
      catch (e) {
        last = e;
        if (isPermissionCameraError(e) && !c.audio) throw e;     // asking again will not change the answer (a refused microphone does not stop the picture)
        if (isBusyCameraError(e)) await sleep(200);              // give the other app a moment
      }
    }
    if (round < rounds - 1) await sleep(o.pauseMs ?? 800);
  }
  throw last;
}
