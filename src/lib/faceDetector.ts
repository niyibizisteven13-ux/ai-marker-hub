import type { FaceBox } from '../../shared/examRules';

/**
 * Finds faces in the camera picture, on the student's device. Nothing is uploaded: the picture is read, the boxes
 * (0..1 of the picture) are returned, and the picture is dropped. The model and its WebAssembly files are served
 * by our own server (see vite.config.ts), so no outside host sees the test.
 */
export interface FaceDetector { detect(video: HTMLVideoElement, nowMs: number): FaceBox[]; close(): void }

const BASE = '/vendor/mediapipe';

export async function createFaceDetector(): Promise<FaceDetector> {
  const { FilesetResolver, FaceDetector: MpFaceDetector } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
  const det = await MpFaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${BASE}/blaze_face_short_range.tflite`, delegate: 'CPU' },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  });
  let last = -1;
  return {
    detect(video, nowMs) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h || video.readyState < 2) return [];
      // The detector wants strictly increasing timestamps.
      const ts = Math.max(nowMs, last + 1); last = ts;
      const out = det.detectForVideo(video, ts);
      return out.detections.flatMap((d) => {
        const b = d.boundingBox;
        if (!b) return [];
        // BlazeFace landmarks: right eye, left eye, nose, mouth, ears. How far the nose sits from the middle of the eyes, in eye-distances, says how far the face is turned.
        const k = d.keypoints;
        const yaw = k && k.length >= 3 && Math.abs(k[1].x - k[0].x) > 0.005 ? (k[2].x - (k[0].x + k[1].x) / 2) / Math.abs(k[1].x - k[0].x) : undefined;
        return [{ x: b.originX / w, y: b.originY / h, w: b.width / w, h: b.height / h, ...(yaw !== undefined ? { yaw } : {}) }];
      });
    },
    close() { try { det.close(); } catch { /* already closed */ } },
  };
}
