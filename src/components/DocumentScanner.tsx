import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { autoDetectQuad, applyFilter } from './DocumentScanner/imageProcessing';
import { warpQuadToRect, quadWidthHeight, clamp } from './DocumentScanner/geometry';
import { authFetch } from '../utils/authFetch';
import { LABEL_PRESETS, DEFAULT_LABEL_PRESET, type LabelPresetKey, type LabelSet } from './scannerLabels';
import './BwengeScan.css';
import { scanQualityWarnings } from '../services/scanQuality';
import { DEFAULT_MARKING_LIMITS, type MarkingLimits } from '../../shared/markingLimits';

/* ───────────── Types ───────────── */
const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerKey = typeof CORNER_KEYS[number];
type Point = { x: number; y: number };
type Quad = Record<CornerKey, Point>;
type FilterId = 'color' | 'gray' | 'bw' | 'auto';
type Mode = 'home' | 'camera' | 'edit' | 'review';
type AgentMode = 'ocr' | 'grade' | 'extract_form';

/** Field names (studentName, aiScore...) are unchanged so existing consumers keep working. */
export type PageItem = {
  id: string;
  dataUrl: string;
  sourceDataUrl?: string;
  filter: FilterId;
  studentName?: string;
  candidateId?: string;
  extractedText?: string;
  aiSummary?: string;
  aiScore?: number;
  aiMaxScore?: number;
  aiFeedback?: string;
  qualityScore?: number;
  /** AI output is a SUGGESTION until a person confirms it. */
  reviewStatus?: 'unreviewed' | 'confirmed';
  isSample?: boolean;
};

type QuestionReport = { number: number; question: string; studentAnswer: string; score: number; maxScore: number; feedback: string };
type GradeReport = {
  totalAwarded?: number;
  totalMax?: number;
  overallFeedback?: string;
  extractedText?: string;
  confidence?: number;
  questions?: QuestionReport[];
  notes?: string[];
};
type Candidate = { id: string; name: string; pages: PageItem[]; aiGradeReport?: GradeReport };
type ReviewDraft = { id: string; texts: string[]; score: string; max: string };



const MAX_IMAGE_PIXELS = 16_000_000;
const LEGACY_DRAFT_KEY = 'bwenge.document-scanner.draft.v1';
const DEFAULT_CRITERIA = 'Score each question accurately on clarity, completeness and correctness (total 100 marks).';

/* ───────────── Draft storage (IndexedDB: large, async, off the typing path) ───────────── */
const DB_NAME = 'bwenge-scan';
const STORE = 'drafts';
const DRAFT_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const isDraft = (value: unknown): value is Candidate[] =>
  Array.isArray(value) && value.every((c) => c && Array.isArray((c as Candidate).pages));

async function draftGet(): Promise<Candidate[] | null> {
  try {
    const db = await openDb();
    return await new Promise<Candidate[] | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(DRAFT_KEY);
      request.onsuccess = () => resolve(isDraft(request.result) ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}
async function draftSet(value: Candidate[] | null): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (value) tx.objectStore(STORE).put(value, DRAFT_KEY);
      else tx.objectStore(STORE).delete(DRAFT_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}
function readLegacyDraft(): Candidate[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ───────────── Small UI helpers ───────────── */
const ICONS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  flip: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  gallery: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 16l-5-5-9 8',
  plus: 'M12 5v14M5 12h14',
  sparkle: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z',
  back: 'M15 6l-6 6 6 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3',
};
function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const initials = (name: string) => (name.trim().slice(0, 2) || '?').toUpperCase();

/* ───────────── Component ───────────── */
interface DocumentScannerProps {
  onClose: () => void;
  onSavePages: (pages: PageItem[]) => void | Promise<void>;
  onScanPage?: (dataUrl: string, name: string, mimeType: string) => void;
  onGeneratedForm?: (form: any) => void;
  onSendToChatAgent?: (prompt: string) => void;
  activeRubricText?: string;
  /** Wording: a preset key ('candidate' | 'student' | 'scholar' | ...) or a full custom LabelSet. */
  labels?: LabelPresetKey | LabelSet;
  /** Shows the "Load sample paper" button. Sample pages can never be saved. Leave off in production. */
  allowSamples?: boolean;
  /** AI reading/scoring on this page (needs a signed-in web session). Off in the Telegram scanner. */
  aiTools?: boolean;
  /** Label of the main save button. */
  saveLabel?: string;
  /** Shows "Export PDF" (a browser download). */
  allowExport?: boolean;
}

export default function DocumentScanner({
  onClose,
  onSavePages,
  onGeneratedForm,
  onSendToChatAgent,
  activeRubricText = '',
  labels: labelsProp = DEFAULT_LABEL_PRESET,
  allowSamples = false,
  aiTools = true,
  saveLabel = 'Save to workspace',
  allowExport = true,
}: DocumentScannerProps) {
  const [limits, setLimits] = useState<MarkingLimits>(DEFAULT_MARKING_LIMITS);
  useEffect(() => {
    if (!aiTools) return;
    const controller = new AbortController();
    void authFetch('/api/exams/limits', { signal: controller.signal }).then(async res => { if (res.ok) setLimits(await res.json()); }).catch(() => undefined);
    return () => controller.abort();
  }, [aiTools]);
  const MAX_PAGES = limits.maxBatchPages;
  const MAX_CANDIDATES = limits.maxCandidates;
  const L: LabelSet = typeof labelsProp === 'string' ? LABEL_PRESETS[labelsProp] : labelsProp;
  const defaultNamePattern = new RegExp(
    `^(${[...Object.values(LABEL_PRESETS).map((p) => p.person), L.person].map(escapeRegExp).join('|')})\\s+\\d+$`,
    'i',
  );
  const isDefaultName = (name: string) => defaultNamePattern.test(name.trim());

  const [candidates, setCandidates] = useState<Candidate[]>([{ id: 'c1', name: `${L.person} 1`, pages: [] }]);
  const [activeId, setActiveId] = useState('c1');
  const [draftReady, setDraftReady] = useState(false);
  const [restored, setRestored] = useState(false);

  const [mode, setMode] = useState<Mode>('home');
  const [showSource, setShowSource] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  // AI
  const [aiConsent, setAiConsent] = useState(false);
  const [criteria, setCriteria] = useState(activeRubricText);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [formResult, setFormResult] = useState<any | null>(null);
  const [previewOcr, setPreviewOcr] = useState<{ extractedText?: string; studentName?: string; qualityScore?: number; summary?: string } | null>(null);
  const [reviewing, setReviewing] = useState<ReviewDraft | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Camera + stage
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const facingRef = useRef<'environment' | 'user'>('environment');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [savingPages, setSavingPages] = useState(false);
  const [qualityWarnings, setQualityWarnings] = useState<string[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const capturedRef = useRef<HTMLCanvasElement | null>(null);
  const originalRef = useRef<HTMLCanvasElement | null>(null); // uncropped image, kept so "Adjust corners" works
  const sampleRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const magCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragKeyRef = useRef<CornerKey | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [filter, setFilter] = useState<FilterId>('auto');
  const [handleLayout, setHandleLayout] = useState<Quad | null>(null);
  const [magnifier, setMagnifier] = useState({ x: 0, y: 0, show: false });
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const totalPages = candidates.reduce((sum, c) => sum + c.pages.length, 0);

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    window.setTimeout(() => setToastMsg(''), 2600);
  }, []);

  /* ── draft: load once, then save (debounced) ── */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = (await draftGet()) ?? readLegacyDraft();
      if (!alive) return;
      if (stored && stored.length > 0) {
        setCandidates(stored);
        setActiveId(stored[0].id);
        setRestored(stored.some((c) => c.pages.length > 0));
      }
      try { localStorage.removeItem(LEGACY_DRAFT_KEY); } catch { /* storage may be disabled */ }
      setDraftReady(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      void draftSet(candidates).then((ok) => { if (!ok) showToast('Draft could not be saved. Export the PDF before closing.'); });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [candidates, draftReady, showToast]);

  /* ── full-screen helpers (touch devices only; best effort) ── */
  const enterFullscreen = () => {
    const el = document.documentElement;
    if (!window.matchMedia?.('(pointer: coarse)')?.matches) return;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  };
  const exitFullscreen = () => {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => undefined);
  };

  /* ── camera ── */
  const clearWatchdog = () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  };
  const stopCamera = useCallback(() => {
    requestIdRef.current += 1;
    clearWatchdog();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch (error) {
      console.warn('enumerateDevices failed', error);
    }
  }, []);

  const startCamera = useCallback(async (deviceId?: string, isFallback = false): Promise<void> => {
    stopCamera();
    const requestId = ++requestIdRef.current;
    setCameraError('');
    setCameraReady(false);
    const constraints: MediaStreamConstraints = isFallback
      ? { video: true }
      : {
          audio: false,
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            facingMode: deviceId ? undefined : { ideal: facingRef.current },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera access is unavailable. Open this page over HTTPS (or localhost) in a current browser.', 'NotSupportedError');
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== requestIdRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      setCurrentDeviceId(deviceId || (stream.getVideoTracks()[0]?.getSettings().deviceId as string) || '');
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch (playError) { console.warn('Video play() rejected', playError); }
      }
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        if (requestId !== requestIdRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0) { setCameraReady(true); return; }
        stopCamera();
        if (!isFallback) void startCamera(undefined, true);
        else setCameraError('The camera connected but no picture arrived. Tap "Try again".');
      }, 10000);
      await refreshDevices();
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      stopCamera();
      const name = (e as DOMException)?.name;
      if (deviceId && name === 'OverconstrainedError' && !isFallback) {
        setCurrentDeviceId('');
        void startCamera(undefined, true);
        return;
      }
      const guidance =
        name === 'NotAllowedError' ? 'Camera access is blocked. Allow camera access for this site in your browser (and in Windows Settings > Privacy & security > Camera).'
        : name === 'NotFoundError' ? 'No camera was found on this device.'
        : name === 'NotReadableError' ? 'The camera could not be opened. Close other apps that may be using it (Teams, Zoom, Camera), then try again.'
        : name === 'NotSupportedError' ? (e as Error).message
        : name === 'SecurityError' ? 'The browser blocked the camera for this page. Use HTTPS or localhost.'
        : 'The camera could not start. Check that no other app is using it.';
      setCameraError(name ? `${guidance} (${name})` : guidance);
    }
  }, [refreshDevices, stopCamera]);

  const startCameraRef = useRef(startCamera);
  startCameraRef.current = startCamera;
  const stopCameraRef = useRef(stopCamera);
  stopCameraRef.current = stopCamera;

  // The <video> exists only in camera mode, so start the stream after it mounts.
  useEffect(() => {
    if (mode !== 'camera') return;
    void startCameraRef.current();
    return () => { stopCameraRef.current(); exitFullscreen(); };
  }, [mode]);

  useEffect(() => () => { stopCameraRef.current(); abortRef.current?.abort(); }, []);

  const handleCameraFrame = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    clearWatchdog();
    setCameraError('');
    setCameraReady(true);
  };

  const flipCamera = () => {
    if (devices.length >= 2) {
      const index = devices.findIndex((d) => d.deviceId === currentDeviceId);
      void startCamera(devices[(index + 1 + devices.length) % devices.length].deviceId);
    } else {
      facingRef.current = facingRef.current === 'environment' ? 'user' : 'environment';
      void startCamera(undefined);
    }
  };

  /* ── candidates ── */
  const addCandidate = () => {
    if (candidates.length >= MAX_CANDIDATES) { showToast(`A batch can contain at most ${MAX_CANDIDATES} ${L.people.toLowerCase()}.`); return; }
    setCandidates((prev) => [...prev, { id: `c-${Date.now()}`, name: `${L.person} ${prev.length + 1}`, pages: [] }]);
  };
  const removeCandidate = (id: string) => setCandidates((prev) => prev.filter((c) => c.id !== id));
  const removePage = (cid: string, index: number) =>
    setCandidates((prev) => prev.map((c) => (c.id === cid ? { ...c, pages: c.pages.filter((_, i) => i !== index) } : c)));
  const beginCapture = (cid: string) => { setActiveId(cid); setShowSource(true); };

  const launchCamera = () => {
    setShowSource(false);
    sampleRef.current = false;
    facingRef.current = 'environment';
    enterFullscreen(); // must run inside the click handler to be allowed
    setMode('camera');
  };

  const setCaptured = (canvas: HTMLCanvasElement, quadGuess: Quad) => {
    capturedRef.current = canvas;
    originalRef.current = canvas;
    setPreviewOcr(null);
    setQuad(quadGuess);
    setMode('edit');
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Choose an image file to scan.'); return; }
    if (file.size > 20 * 1024 * 1024) { showToast('That image is larger than 20 MB. Choose a smaller one.'); return; }
    const reader = new FileReader();
    reader.onerror = () => showToast('Could not read that image. Try another file.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const img = new Image();
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) { showToast('That image could not be opened.'); return; }
        if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) { showToast('That image is too large to process. Choose one under 16 megapixels.'); return; }
        const raw = document.createElement('canvas');
        raw.width = img.naturalWidth;
        raw.height = img.naturalHeight;
        const ctx = raw.getContext('2d');
        if (!ctx) { showToast('Image processing is unavailable in this browser.'); return; }
        ctx.drawImage(img, 0, 0);
        sampleRef.current = false;
        setCaptured(raw, autoDetectQuad(raw));
      };
      img.onerror = () => showToast('Could not decode that image. Try another file.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const captureCameraPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { showToast('The camera is not ready yet.'); return; }
    const raw = document.createElement('canvas');
    const downscale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (video.videoWidth * video.videoHeight)));
    raw.width = Math.round(video.videoWidth * downscale);
    raw.height = Math.round(video.videoHeight * downscale);
    const ctx = raw.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, raw.width, raw.height);
    stopCamera();
    setCaptured(raw, autoDetectQuad(raw));
  };

  const loadSample = (cid?: string) => {
    setActiveId(cid || activeId);
    setShowSource(false);
    const raw = document.createElement('canvas');
    raw.width = 900;
    raw.height = 1200;
    const ctx = raw.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#23252c'; ctx.fillRect(0, 0, 900, 1200);
    ctx.fillStyle = '#fcfaf5'; ctx.fillRect(60, 60, 780, 1080);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 26px sans-serif';
    ctx.fillText('SAMPLE ASSESSMENT (NOT REAL DATA)', 115, 138);
    ctx.font = '18px monospace'; ctx.fillStyle = '#1e3a8a';
    const lines = [
      'Q1. Explain how self-attention scales with sequence length N.',
      'Answer: Pairwise dot products across all N tokens give O(N^2)',
      'time and memory complexity.', '',
      'Q2. Differentiate the sigmoid function.',
      "Answer: sigma'(x) = sigma(x)(1 - sigma(x)).",
    ];
    lines.forEach((line, i) => ctx.fillText(line, 115, 250 + i * 38));
    sampleRef.current = true;
    capturedRef.current = raw;
    originalRef.current = raw;
    setPreviewOcr(null);
    setQuad({ tl: { x: 60, y: 60 }, tr: { x: 840, y: 60 }, br: { x: 840, y: 1140 }, bl: { x: 60, y: 1140 } });
    setMode('edit');
    showToast('Sample loaded. Sample pages cannot be saved.');
  };

  /* ── stage (edit + review): paint, size, corner handles ── */
  const paintStage = useCallback(() => {
    const raw = capturedRef.current;
    const canvas = stageCanvasRef.current;
    const host = stageRef.current;
    if (!raw || !canvas || !host) return;
    const vw = host.clientWidth;
    const vh = host.clientHeight - 234; // room for top and bottom bars
    if (!vw || vh <= 0) return;
    const scale = Math.min(vw / raw.width, vh / raw.height);
    canvas.style.width = `${raw.width * scale}px`;
    canvas.style.height = `${raw.height * scale}px`;
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(raw, 0, 0);
    if (mode === 'review' && filter !== 'color') {
      const data = ctx.getImageData(0, 0, raw.width, raw.height);
      ctx.putImageData(applyFilter(data, filter === 'auto' ? 'color' : filter), 0, 0);
    }
  }, [mode, filter]);

  const layoutHandles = useCallback(() => {
    const canvas = stageCanvasRef.current;
    const host = stageRef.current;
    if (!canvas || !host || !quad || mode !== 'edit') { setHandleLayout(null); return; }
    const rect = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const at = (p: Point): Point => ({ x: rect.left - hostRect.left + p.x * sx, y: rect.top - hostRect.top + p.y * sy });
    setHandleLayout({ tl: at(quad.tl), tr: at(quad.tr), br: at(quad.br), bl: at(quad.bl) });
  }, [quad, mode]);

  const paintRef = useRef(paintStage); paintRef.current = paintStage;
  const layoutRef = useRef(layoutHandles); layoutRef.current = layoutHandles;

  // Repaint when entering edit/review or changing the filter; relayout on any resize or rotation.
  useEffect(() => {
    if (mode !== 'edit' && mode !== 'review') return;
    const run = () => { paintRef.current(); layoutRef.current(); };
    const frame = requestAnimationFrame(run);
    const observer = stageRef.current && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
    if (observer && stageRef.current) observer.observe(stageRef.current);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [mode, filter]);

  // Quad moved: only the handles need updating.
  useEffect(() => { layoutHandles(); }, [layoutHandles]);

  const updateMagnifier = (clientX: number, clientY: number) => {
    const raw = capturedRef.current;
    const canvas = stageCanvasRef.current;
    const mag = magCanvasRef.current;
    if (!raw || !canvas || !mag) return;
    const rect = canvas.getBoundingClientRect();
    const size = 96;
    const zoom = 2.5;
    const nx = ((clientX - rect.left) / rect.width) * raw.width;
    const ny = ((clientY - rect.top) / rect.height) * raw.height;
    const src = size / zoom;
    const ctx = mag.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(raw, nx - src / 2, ny - src / 2, src, src, 0, 0, size, size);
      ctx.strokeStyle = '#F2A93B';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
      ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
      ctx.stroke();
    }
    setMagnifier({ x: clientX - size / 2, y: Math.max(8, clientY - size - 40), show: true });
  };

  const onHandlePointerDown = (key: CornerKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragKeyRef.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateMagnifier(e.clientX, e.clientY);
  };

  const onStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const key = dragKeyRef.current;
    const canvas = stageCanvasRef.current;
    if (!key || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(((e.clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width);
    const y = clamp(((e.clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height);
    setQuad((prev) => (prev ? { ...prev, [key]: { x, y } } : prev));
    updateMagnifier(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    dragKeyRef.current = null;
    setMagnifier((m) => ({ ...m, show: false }));
  };

  const nudgeCorner = (key: CornerKey) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 4;
    const delta: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const d = delta[e.key];
    const canvas = stageCanvasRef.current;
    if (!d || !canvas) return;
    e.preventDefault();
    setQuad((prev) => prev ? { ...prev, [key]: { x: clamp(prev[key].x + d.x, 0, canvas.width), y: clamp(prev[key].y + d.y, 0, canvas.height) } } : prev);
  };

  const applyCrop = () => {
    const source = capturedRef.current;
    if (!source || !quad) return;
    setProcessing('Flattening the page…');
    requestAnimationFrame(() => {
      try {
        let { w, h } = quadWidthHeight(quad);
        const scale = Math.min(1, limits.originalMaxSide / Math.max(w, h), Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, w * h)));
        w = Math.max(40, Math.round(w * scale));
        h = Math.max(40, Math.round(h * scale));
        originalRef.current = source; // keep the uncropped image for "Adjust corners"
        capturedRef.current = warpQuadToRect(source, quad, w, h);
        setProcessing(null);
        setMode('review');
      } catch (error) {
        console.error('Crop failed', error);
        setProcessing(null);
        showToast('Could not crop this page. Adjust the corners and try again.');
      }
    });
  };

  const adjustCorners = () => {
    if (originalRef.current) capturedRef.current = originalRef.current;
    setMode('edit');
  };

  const savePage = () => {
    const source = capturedRef.current;
    if (!source) return;
    if (totalPages >= MAX_PAGES) { showToast(`A batch can contain at most ${MAX_PAGES} pages.`); return; }
    if ((candidates.find(c => c.id === activeId)?.pages.length || 0) >= limits.maxPagesPerPaper) { showToast(`A paper can contain at most ${limits.maxPagesPerPaper} pages.`); return; }
    const original = document.createElement('canvas');
    const originalScale = Math.min(1, limits.originalMaxSide / Math.max(source.width, source.height));
    original.width = Math.round(source.width * originalScale); original.height = Math.round(source.height * originalScale);
    const originalContext = original.getContext('2d');
    if (originalContext) { originalContext.fillStyle = '#ffffff'; originalContext.fillRect(0, 0, original.width, original.height); originalContext.drawImage(source, 0, 0, original.width, original.height); }
    const sourceDataUrl = original.toDataURL('image/jpeg', 0.96);
    const out = document.createElement('canvas');
    const previewScale = Math.min(1, limits.previewMaxSide / Math.max(source.width, source.height));
    out.width = Math.round(source.width * previewScale);
    out.height = Math.round(source.height * previewScale);
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0, out.width, out.height);
    if (filter !== 'color') {
      ctx.putImageData(applyFilter(ctx.getImageData(0, 0, out.width, out.height), filter === 'auto' ? 'color' : filter), 0, 0);
    }
    const dataUrl = out.toDataURL('image/jpeg', 0.9);
    const detected = previewOcr?.studentName?.trim();
    const isSample = sampleRef.current;
    setCandidates((prev) => prev.map((c) => {
      if (c.id !== activeId) return c;
      const name = detected && isDefaultName(c.name) ? detected : c.name;
      const page: PageItem = {
        id: `p-${Date.now()}`,
        dataUrl,
        sourceDataUrl,
        filter,
        studentName: name.trim() || `Unnamed ${L.person.toLowerCase()}`,
        extractedText: previewOcr?.extractedText,
        aiSummary: previewOcr?.summary,
        qualityScore: previewOcr?.qualityScore,
        reviewStatus: previewOcr?.extractedText ? 'unreviewed' : undefined,
        isSample,
      };
      return { ...c, name, pages: [...c.pages, page] };
    }));
    showToast('Page saved');
    setPreviewOcr(null);
    capturedRef.current = null;
    originalRef.current = null;
    setMode('home');
  };

  /* ── AI ── */
  const callAgent = async (payload: Record<string, unknown>, signal?: AbortSignal) => {
    const init: RequestInit = { method: 'POST', body: JSON.stringify(payload), signal };
    const res = await authFetch('/api/ai/scan-agent', init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error || data?.message || `The AI request failed (${res.status}).`);
    return data;
  };

  const requireConsent = () => {
    if (aiConsent) return true;
    showToast(`Tick the permission box first: pages are sent to an AI service.`);
    return false;
  };

  const runPreviewCheck = async () => {
    const source = capturedRef.current;
    if (!source || !requireConsent()) return;
    setProcessing('AI is reading this page…');
    try {
      const data = await callAgent({ imageBase64: source.toDataURL('image/jpeg', 0.88), mode: 'ocr' });
      setPreviewOcr({ extractedText: data.extractedText, studentName: data.studentName, qualityScore: data.qualityScore, summary: data.summary });
      showToast('The AI has read the page. Check it before relying on it.');
    } catch (err: any) {
      showToast(err?.message || 'The AI check failed.');
    } finally {
      setProcessing(null);
    }
  };

  /** Returns false when it failed or was cancelled. Works on a snapshot so batches never read stale state. */
  const processCandidate = async (cand: Candidate, agentMode: AgentMode, signal?: AbortSignal): Promise<boolean> => {
    if (cand.pages.length === 0) { showToast(`Add at least one page for this ${L.person.toLowerCase()} first.`); return false; }
    setBusyId(cand.id);
    try {
      if (agentMode === 'extract_form') {
        setProcessing('Turning the first page into a form…');
        const data = await callAgent({ imageBase64: cand.pages[0].dataUrl, mode: agentMode, studentName: cand.name, rawTextHint: cand.pages[0].extractedText || '' }, signal);
        if (data.form) { setFormResult(data.form); showToast(`Created form: "${data.form.title}"`); return true; }
        throw new Error('No form came back for that page.');
      }

      const texts: string[] = [];
      const reports: any[] = [];
      let detectedName = '';
      for (let i = 0; i < cand.pages.length; i++) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        setProcessing(`${agentMode === 'grade' ? `${L.score}: ` : 'Reading: '}${cand.name}, page ${i + 1} of ${cand.pages.length}`);
        const data = await callAgent({
          imageBase64: cand.pages[i].dataUrl,
          mode: agentMode,
          studentName: cand.name,
          rubric: criteria || activeRubricText || DEFAULT_CRITERIA,
          rawTextHint: cand.pages[i].extractedText || '',
        }, signal);
        texts.push(data.ocrTranscript || data.extractedText || '');
        reports.push(agentMode === 'grade' ? {
          ...data,
          questions: Array.isArray(data.questions) ? data.questions.map((question: any, index: number) => ({
            number: Number.parseInt(String(question.number || '').replace(/\D/g, ''), 10) || index + 1,
            question: question.questionText || `Question ${index + 1}`,
            studentAnswer: question.studentAnswer || '',
            score: Number(question.awardedMarks) || 0,
            maxScore: Number(question.maxMarks) || 0,
            feedback: question.feedback || '',
          })) : [],
          summary: data.summary || data.overallFeedback,
        } : data);
        const found = data.detectedStudentName || data.studentName;
        if (found && !detectedName && !/^unknown/i.test(found)) detectedName = found;
      }

      // Combine the page results honestly. Totals are summed from per-question scores only;
      // if the AI gave no per-question scores for a multi-page paper, the total is left blank for a person to enter.
      const byNumber = new Map<number, QuestionReport>();
      const notes: string[] = [];
      reports.forEach((r) => (r.questions || []).forEach((q: QuestionReport, k: number) => {
        const key = Number.isFinite(q.number) && q.number > 0 ? q.number : 1000 + byNumber.size + k;
        if (byNumber.has(key)) notes.push(`Question ${key} appears on more than one page; the later page's score was used.`);
        byNumber.set(key, q);
      }));
      const questions = [...byNumber.values()];
      let totalAwarded: number | undefined;
      let totalMax: number | undefined;
      if (questions.length > 0) {
        totalAwarded = questions.reduce((s, q) => s + (Number(q.score) || 0), 0);
        totalMax = questions.reduce((s, q) => s + (Number(q.maxScore) || 0), 0);
      } else if (reports.length === 1) {
        totalAwarded = reports[0].totalAwardedMarks;
        totalMax = reports[0].maxTotalMarks;
      } else if (agentMode === 'grade') {
        notes.push('The AI gave no per-question scores for this multi-page paper, so no total was calculated. Enter it when you review.');
      }
      const feedback = [...new Set(reports.map((r) => r.overallFeedback || r.summary).filter(Boolean))].join(' ');
      const confidences = reports.map((r) => r.confidence).filter((c): c is number => typeof c === 'number');
      const combinedText = texts.join('\n\n');

      setCandidates((prev) => prev.map((c) => {
        if (c.id !== cand.id) return c;
        const name = detectedName && isDefaultName(c.name) ? detectedName : c.name;
        const pages = c.pages.map((p, i) => ({
          ...p,
          studentName: name,
          extractedText: texts[i] || p.extractedText || '',
          aiSummary: reports[i]?.summary || p.aiSummary,
          qualityScore: reports[i]?.qualityScore ?? p.qualityScore,
          reviewStatus: 'unreviewed' as const,
          // one score per paper, kept on the first page so consumers that add pages up do not double count
          ...(agentMode === 'grade' ? {
            aiScore: i === 0 ? totalAwarded : undefined,
            aiMaxScore: i === 0 ? totalMax : undefined,
            aiFeedback: i === 0 ? feedback || undefined : undefined,
          } : {}),
        }));
        const report: GradeReport = agentMode === 'grade'
          ? { totalAwarded, totalMax, overallFeedback: feedback || undefined, extractedText: combinedText, confidence: confidences.length ? Math.min(...confidences) : undefined, questions, notes }
          : { ...(c.aiGradeReport || {}), extractedText: combinedText };
        return { ...c, name, pages, aiGradeReport: report };
      }));

      showToast(agentMode === 'grade'
        ? `Suggested ${L.score.toLowerCase()} for ${cand.name}: ${totalAwarded ?? '–'}/${totalMax ?? '–'}. Please review it.`
        : `Read ${cand.pages.length} page(s). Please check the text.`);
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') showToast('Stopped.');
      else showToast(err?.message || 'The AI could not finish.');
      return false;
    } finally {
      setBusyId(null);
      setProcessing(null);
    }
  };

  const runOne = async (cand: Candidate, agentMode: AgentMode) => {
    if (!requireConsent()) return;
    abortRef.current = new AbortController();
    await processCandidate(cand, agentMode, abortRef.current.signal);
  };

  const runBatch = async (agentMode: 'ocr' | 'grade') => {
    if (!requireConsent()) return;
    const targets = candidates.filter((c) => c.pages.length > 0);
    if (targets.length === 0) { showToast('Add at least one page first.'); return; }
    abortRef.current = new AbortController();
    setBatchRunning(true);
    try {
      for (const cand of targets) {
        if (abortRef.current.signal.aborted) break;
        await processCandidate(cand, agentMode, abortRef.current.signal);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  /* ── human review ── */
  const openReview = (cand: Candidate) =>
    setReviewing({
      id: cand.id,
      texts: cand.pages.map((p) => p.extractedText || ''),
      score: cand.aiGradeReport?.totalAwarded !== undefined ? String(cand.aiGradeReport.totalAwarded) : '',
      max: cand.aiGradeReport?.totalMax !== undefined ? String(cand.aiGradeReport.totalMax) : '',
    });

  const confirmReview = () => {
    if (!reviewing) return;
    const score = reviewing.score.trim() === '' ? undefined : Number(reviewing.score);
    const max = reviewing.max.trim() === '' ? undefined : Number(reviewing.max);
    if ((score !== undefined && !Number.isFinite(score)) || (max !== undefined && !Number.isFinite(max))) {
      showToast('Scores must be numbers.');
      return;
    }
    if (score !== undefined && max !== undefined && score > max) { showToast('The score is higher than the maximum.'); return; }
    setCandidates((prev) => prev.map((c) => c.id !== reviewing.id ? c : {
      ...c,
      pages: c.pages.map((p, i) => ({
        ...p,
        extractedText: reviewing.texts[i] ?? p.extractedText,
        reviewStatus: 'confirmed' as const,
        ...(i === 0 && c.aiGradeReport ? { aiScore: score, aiMaxScore: max } : {}),
      })),
      aiGradeReport: c.aiGradeReport ? { ...c.aiGradeReport, totalAwarded: score, totalMax: max, extractedText: reviewing.texts.join('\n\n') } : c.aiGradeReport,
    }));
    setReviewing(null);
    showToast('Confirmed. These pages can now be used.');
  };

  /* ── export + save ── */
  const exportPdf = () => {
    if (totalPages === 0) return;
    setProcessing('Building the PDF…');
    window.setTimeout(() => {
      try {
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        let first = true;
        for (const cand of candidates) {
          if (cand.pages.length === 0) continue;
          if (!first) doc.addPage();
          first = false;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(24);
          doc.text(cand.name || `Unnamed ${L.person.toLowerCase()}`, 48, 110);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(110);
          doc.text(`${cand.pages.length} scanned page${cand.pages.length === 1 ? '' : 's'} follow`, 48, 134);
          doc.setTextColor(0);
          for (const page of cand.pages) {
            doc.addPage();
            doc.addImage(page.dataUrl, 'JPEG', 24, 24, doc.internal.pageSize.getWidth() - 48, doc.internal.pageSize.getHeight() - 48);
          }
        }
        doc.save(`batch-scan-${Date.now()}.pdf`);
        showToast('PDF exported');
      } catch (error) {
        console.error(error);
        showToast('PDF export failed');
      } finally {
        setProcessing(null);
      }
    }, 50);
  };

  useEffect(() => {
    const source = capturedRef.current;
    if (mode !== 'edit' || !source) { setQualityWarnings([]); return; }
    const sample = document.createElement('canvas'); sample.width = 128; sample.height = 128;
    const ctx = sample.getContext('2d'); if (!ctx) return;
    ctx.drawImage(source, 0, 0, 128, 128);
    setQualityWarnings(scanQualityWarnings(source.width, source.height, ctx.getImageData(0, 0, 128, 128).data));
  }, [mode, filter, quad]);

  const saveToWorkspace = async () => {
    const pages: PageItem[] = candidates.flatMap((c) => c.pages.map((p) => ({ ...p, candidateId: c.id, studentName: c.name.trim() || `Unnamed ${L.person.toLowerCase()}` })));
    if (pages.length === 0) { showToast('Add at least one page before saving.'); return; }
    if (pages.some((p) => p.isSample)) { showToast('Remove the sample pages before saving.'); return; }
    const unconfirmed = pages.filter((p) => p.extractedText && p.reviewStatus !== 'confirmed').length;
    if (unconfirmed > 0 && !window.confirm(`${unconfirmed} page(s) have AI results that nobody has confirmed. They will be saved as "unreviewed". Save anyway?`)) return;
    setSavingPages(true);
    try {
      await onSavePages(pages);
      await draftSet(null);
      onClose();
    } catch (error) {
      console.error('Could not save pages', error);
      showToast(error instanceof Error ? error.message : 'Could not save. Your draft is kept; try again.');
    } finally { setSavingPages(false); }
  };

  const discardDraft = async () => {
    await draftSet(null);
    setCandidates([{ id: 'c1', name: `${L.person} 1`, pages: [] }]);
    setActiveId('c1');
    setRestored(false);
  };

  const quadPath = quad && handleLayout
    ? `M ${handleLayout.tl.x} ${handleLayout.tl.y} L ${handleLayout.tr.x} ${handleLayout.tr.y} L ${handleLayout.br.x} ${handleLayout.br.y} L ${handleLayout.bl.x} ${handleLayout.bl.y} Z`
    : '';
  const aiBusy = batchRunning || busyId !== null;
  const activeName = candidates.find((c) => c.id === activeId)?.name ?? L.person;

  const statusChip = (c: Candidate) => {
    if (c.pages.length === 0) return null;
    const read = c.pages.some((p) => p.extractedText);
    if (!read) return <span className="bsc-chip">Not read yet</span>;
    return c.pages.every((p) => p.reviewStatus === 'confirmed')
      ? <span className="bsc-chip ok">Confirmed</span>
      : <span className="bsc-chip warn">Needs review</span>;
  };

  /* ───────────── Render ───────────── */
  return (
    <div className="bsc-root" onPointerUp={onPointerUp}>
      {/* HOME */}
      <header className="bsc-top">
        <div className="bsc-brand">
          <div className="bsc-logo bsc-d">B</div>
          <div className="bsc-brand-name bsc-d">Bwenge <span>Scan</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="bsc-chip">{candidates.length} {candidates.length === 1 ? L.person.toLowerCase() : L.people.toLowerCase()} · {totalPages} {totalPages === 1 ? 'page' : 'pages'}</span>
          <button className="bsc-iconbtn" aria-label="Close scanner" onClick={onClose}><Icon name="close" /></button>
        </div>
      </header>

      <div className="bsc-scroll">
        <div className="bsc-wrap">
          {restored && (
            <div className="bsc-banner">
              <span>Recovered an unsent draft from this device. Check the pages before sending.</span>
              <button className="bsc-btn bsc-sm" onClick={() => void discardDraft()}><Icon name="trash" size={15} /> Discard</button>
            </div>
          )}

          {aiTools && <section className="bsc-hub" aria-label="AI assistant">
            <div className="bsc-hub-head"><span className="bsc-dot" /><span className="bsc-hub-title bsc-d">AI Scan Assistant</span></div>
            <p className="bsc-hub-sub" style={{ margin: 0 }}>Reads every page, suggests {L.score.toLowerCase()}s and flags what it is unsure about. You confirm before anything counts.</p>
            <label className="bsc-consent">
              <input type="checkbox" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />
              <span>I have permission to send these pages to an AI service to be read.</span>
            </label>
            <div className="bsc-row">
              <button className="bsc-btn bsc-pri" disabled={totalPages === 0 || aiBusy} onClick={() => void runBatch('grade')}><Icon name="sparkle" /> {L.score} all {L.papers.toLowerCase()}</button>
              <button className="bsc-btn" disabled={totalPages === 0 || aiBusy} onClick={() => void runBatch('ocr')}>Read all pages</button>
              {aiBusy && <button className="bsc-btn" onClick={() => abortRef.current?.abort()}>Stop</button>}
            </div>
            <label className="bsc-field">{L.criteria} (optional)
              <input className="bsc-input" value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={`Paste the ${L.criteria.toLowerCase()} or scoring guide`} />
            </label>
            {formResult && (
              <div className="bsc-formcard">
                <div><span className="bsc-chip ok">Form created</span><div style={{ fontWeight: 600, marginTop: 6 }}>{formResult.title} ({formResult.questions?.length || 0} questions)</div></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {onGeneratedForm && <button className="bsc-btn bsc-pri bsc-sm" onClick={() => { onGeneratedForm(formResult); onClose(); }}>Open in Form Builder</button>}
                  <a className="bsc-btn bsc-sm" href={`/forms/${formResult.id}`} target="_blank" rel="noreferrer">Open public link</a>
                </div>
              </div>
            )}
          </section>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="bsc-btn bsc-sm" onClick={addCandidate}><Icon name="plus" size={16} /> Add {L.person.toLowerCase()}</button>
            {allowSamples && <button className="bsc-btn bsc-sm" onClick={() => loadSample(candidates[0]?.id)}>Load sample paper (testing only)</button>}
          </div>

          {candidates.map((cand) => {
            const report = cand.aiGradeReport;
            return (
              <article key={cand.id} className="bsc-card">
                <div className="bsc-card-head">
                  <div className="bsc-avatar">{initials(cand.name)}</div>
                  <input className="bsc-name" value={cand.name} aria-label={`${L.person} name`} placeholder={`${L.person} name`}
                    onChange={(e) => { const v = e.target.value; setCandidates((prev) => prev.map((c) => (c.id === cand.id ? { ...c, name: v } : c))); }} />
                  {report?.totalAwarded !== undefined && (
                    <span className={`bsc-chip ${cand.pages.every((p) => p.reviewStatus === 'confirmed') ? 'ok' : 'warn'}`}>
                      {cand.pages.every((p) => p.reviewStatus === 'confirmed') ? L.score : 'AI suggestion'}: {report.totalAwarded}/{report.totalMax ?? '–'}
                    </span>
                  )}
                  {statusChip(cand)}
                  {candidates.length > 1 && <button className="bsc-iconbtn" style={{ width: 38, height: 38 }} aria-label={`Remove ${cand.name}`} onClick={() => removeCandidate(cand.id)}><Icon name="close" size={15} /></button>}
                </div>

                <div className="bsc-thumbs">
                  {cand.pages.map((p, i) => (
                    <div key={p.id} className="bsc-thumb">
                      <img src={p.dataUrl} alt={`Page ${i + 1} of ${cand.name}`} />
                      <span className="bsc-thumb-n">{i + 1}</span>
                      {p.extractedText && <span className="bsc-thumb-badge">{p.reviewStatus === 'confirmed' ? 'OK' : 'OCR'}</span>}
                      <button className="bsc-thumb-x" aria-label={`Remove page ${i + 1}`} onClick={() => removePage(cand.id, i)}>×</button>
                    </div>
                  ))}
                  <button className="bsc-add" onClick={() => beginCapture(cand.id)}><Icon name="plus" size={20} />Add page</button>
                </div>

                {aiTools && cand.pages.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="bsc-btn bsc-sm" disabled={aiBusy} onClick={() => void runOne(cand, 'ocr')}>{busyId === cand.id ? 'Working…' : 'Read'}</button>
                    <button className="bsc-btn bsc-sm" disabled={aiBusy} onClick={() => void runOne(cand, 'grade')}>{L.score}</button>
                    <button className="bsc-btn bsc-sm" disabled={aiBusy} onClick={() => void runOne(cand, 'extract_form')}>To form</button>
                    {cand.pages.some((p) => p.extractedText) && <button className="bsc-btn bsc-sm bsc-pri" onClick={() => openReview(cand)}>Review &amp; confirm</button>}
                  </div>
                )}

                {report && (
                  <div className="bsc-report">
                    {report.overallFeedback && (
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <p style={{ margin: 0, lineHeight: 1.5 }}><b style={{ color: 'var(--amber)' }}>AI feedback (suggestion): </b>{report.overallFeedback}</p>
                        {onSendToChatAgent && (
                          <button className="bsc-btn bsc-sm" style={{ flexShrink: 0 }} onClick={() => {
                            onSendToChatAgent(`Analyze the scanned paper for ${cand.name} (${L.score}: ${report.totalAwarded ?? 'N/A'}/${report.totalMax ?? 'N/A'}).\n\nExtracted text:\n${report.extractedText || ''}\n\nGive detailed feedback against the ${L.criteria.toLowerCase()}.`);
                            onClose();
                          }}>Discuss with chat</button>
                        )}
                      </div>
                    )}
                    {report.notes?.map((n, i) => <div key={i} className="bsc-chip warn" style={{ whiteSpace: 'normal' }}>{n}</div>)}
                    {report.questions && report.questions.length > 0 && (
                      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
                        {report.questions.map((q, i) => (
                          <div key={i} className="bsc-q">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>Q{q.number || i + 1}. {q.question}</b><b style={{ color: 'var(--amber)' }}>{q.score}/{q.maxScore}</b></div>
                            <p>{q.feedback}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {report.extractedText && (
                      <details><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Text the AI read</summary><pre>{report.extractedText}</pre></details>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <footer className="bsc-bottom">
        {allowExport && <button className="bsc-btn" disabled={totalPages === 0} onClick={exportPdf}>Export PDF</button>}
        <button className="bsc-btn bsc-pri" disabled={totalPages === 0 || savingPages} onClick={() => void saveToWorkspace()}>{savingPages ? 'Saving scanned papers…' : saveLabel}</button>
      </footer>

      {/* CAMERA: fills the whole device screen */}
      {mode === 'camera' && (
        <div className="bsc-camera">
          <video ref={videoRef} className="bsc-video" autoPlay playsInline muted onLoadedData={handleCameraFrame} onCanPlay={handleCameraFrame} onPlaying={handleCameraFrame} />
          {!cameraReady && (
            <div className="bsc-cam-status" role="status">
              {!cameraError && <span className="bsc-spinner" />}
              <span>{cameraError || 'Starting the camera…'}</span>
              {cameraError && <button className="bsc-btn bsc-pri" onClick={() => void startCamera(undefined, true)}>Try again</button>}
            </div>
          )}
          <div className="bsc-guides" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="bsc-cam-top">
            <button className="bsc-iconbtn" aria-label="Close camera" onClick={() => setMode('home')}><Icon name="close" /></button>
            <span className="bsc-chip">{activeName} · Page {(candidates.find((c) => c.id === activeId)?.pages.length ?? 0) + 1}</span>
            <button className="bsc-iconbtn" aria-label="Switch camera" onClick={flipCamera}><Icon name="flip" /></button>
          </div>
          <div className="bsc-hint">Fit the whole page inside the corners</div>
          <div className="bsc-cam-bottom" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <button className="bsc-iconbtn bsc-side" aria-label="Choose from gallery" onClick={() => { galleryInputRef.current?.click(); setMode('home'); }}><Icon name="gallery" size={22} /></button>
            <button className="bsc-shutter" aria-label="Capture page" disabled={!cameraReady} onClick={captureCameraPhoto}><span /></button>
            <span style={{ width: 56 }} aria-hidden="true" />
          </div>
        </div>
      )}

      {/* EDIT + REVIEW: also full screen */}
      {(mode === 'edit' || mode === 'review') && (
        <div className="bsc-stage-wrap">
          <div className="bsc-stage-top">
            <button className="bsc-iconbtn" aria-label={mode === 'edit' ? 'Retake' : 'Back to corners'} onClick={() => (mode === 'edit' ? setMode('camera') : adjustCorners())}><Icon name="back" /></button>
            <span className="bsc-chip">{mode === 'edit' ? 'Drag the corners onto the page edges' : 'Review the page'}</span>
            <button className="bsc-iconbtn" aria-label="Cancel" onClick={() => { setMode('home'); capturedRef.current = null; originalRef.current = null; }}><Icon name="close" /></button>
          </div>

          <div className="bsc-stage" ref={stageRef} onPointerMove={onStagePointerMove}>
            <canvas ref={stageCanvasRef} className="bsc-canvas" />
            {mode === 'edit' && handleLayout && (
              <>
                <svg className="bsc-quad" aria-hidden="true"><path d={quadPath} fill="rgba(242,169,59,0.18)" stroke="#F2A93B" strokeWidth="2" /></svg>
                {CORNER_KEYS.map((key) => (
                  <div key={key} className="bsc-handle" tabIndex={0} role="slider" aria-label={`${{ tl: 'Top left', tr: 'Top right', br: 'Bottom right', bl: 'Bottom left' }[key]} corner. Use arrow keys to move.`}
                    aria-valuenow={Math.round(quad ? quad[key].x : 0)} aria-valuemin={0} aria-valuemax={stageCanvasRef.current?.width ?? 0}
                    style={{ left: handleLayout[key].x, top: handleLayout[key].y }} onPointerDown={onHandlePointerDown(key)} onKeyDown={nudgeCorner(key)} />
                ))}
              </>
            )}
            {mode === 'review' && previewOcr && (
              <div className="bsc-ocr-card">
                <b style={{ color: 'var(--ok)' }}>AI read: {previewOcr.studentName || 'untitled page'}{previewOcr.qualityScore !== undefined ? ` · legibility ${previewOcr.qualityScore}%` : ''}</b>
                {previewOcr.summary && <div style={{ marginTop: 4 }}>{previewOcr.summary}</div>}
                <div style={{ marginTop: 4, color: 'var(--muted)' }}>This is a suggestion. Confirm it later under “Review &amp; confirm”.</div>
              </div>
            )}
          </div>

          <div className="bsc-stage-bottom">
            {mode === 'edit' ? (
              <>
                <button className="bsc-btn" onClick={() => setMode('camera')} style={{ flex: 1 }}>Retake</button>
                <button className="bsc-btn bsc-pri" onClick={applyCrop} style={{ flex: 2 }}>Apply crop</button>
              </>
            ) : (
              <>
                <div className="bsc-filters" role="group" aria-label="Page filter">
                  {(['auto', 'color', 'gray', 'bw'] as const).map((f) => (
                    <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'bw' ? 'B/W' : f.charAt(0).toUpperCase() + f.slice(1)}</button>
                  ))}
                </div>
                <button className="bsc-btn" onClick={adjustCorners}>Adjust corners</button>
                {aiTools && <button className="bsc-btn" disabled={aiBusy} onClick={() => void runPreviewCheck()}><Icon name="sparkle" size={16} /> AI read</button>}
                <button className="bsc-btn bsc-pri" onClick={savePage} style={{ flex: '1 1 100%' }}>Save page</button>
              </>
            )}
          </div>
        </div>
      )}

      {magnifier.show && (
        <div className="bsc-loupe" style={{ left: magnifier.x, top: magnifier.y }}><canvas ref={magCanvasRef} width={96} height={96} /></div>
      )}

      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFilePicked} style={{ display: 'none' }} />

      {/* Source sheet */}
      {showSource && (
        <div className="bsc-modal-back" onClick={() => setShowSource(false)}>
          <div className="bsc-sheet" role="dialog" aria-label="Add a page" onClick={(e) => e.stopPropagation()}>
            <h3 className="bsc-d" style={{ margin: 0 }}>Add a page</h3>
            <button className="bsc-source" onClick={launchCamera}><Icon name="sparkle" size={22} /><span><b>Scan with camera</b><small>Full-screen live camera</small></span></button>
            <button className="bsc-source" onClick={() => { setShowSource(false); galleryInputRef.current?.click(); }}><Icon name="gallery" size={22} /><span><b>Choose from gallery</b><small>Use a photo you already took</small></span></button>
            {allowSamples && <button className="bsc-source" onClick={() => loadSample(activeId)}><Icon name="sparkle" size={22} /><span><b>Load sample paper</b><small>For testing only. It can never be saved.</small></span></button>}
            <button className="bsc-btn" onClick={() => setShowSource(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Review and confirm */}
      {reviewing && (
        <div className="bsc-modal-back" onClick={() => setReviewing(null)}>
          <div className="bsc-sheet" role="dialog" aria-label="Review and confirm" onClick={(e) => e.stopPropagation()}>
            <h3 className="bsc-d" style={{ margin: 0 }}>Review &amp; confirm</h3>
            <p className="bsc-hub-sub" style={{ margin: 0 }}>Fix anything the AI got wrong. Only confirmed pages should be used to teach or improve Bwenge.</p>
            {candidates.find((c) => c.id === reviewing.id)?.pages.map((p, i) => (
              <div key={p.id} className="bsc-rev-page">
                <img src={p.dataUrl} alt={`Page ${i + 1}`} />
                <label className="bsc-field" style={{ flex: 1 }}>Text, page {i + 1}
                  <textarea className="bsc-textarea" value={reviewing.texts[i] ?? ''} onChange={(e) => { const v = e.target.value; setReviewing((r) => r ? { ...r, texts: r.texts.map((t, k) => (k === i ? v : t)) } : r); }} />
                </label>
              </div>
            ))}
            <div className="bsc-row">
              <label className="bsc-field">{L.score}<input className="bsc-input" inputMode="decimal" value={reviewing.score} onChange={(e) => setReviewing((r) => r ? { ...r, score: e.target.value } : r)} placeholder="e.g. 24" /></label>
              <label className="bsc-field">Out of<input className="bsc-input" inputMode="decimal" value={reviewing.max} onChange={(e) => setReviewing((r) => r ? { ...r, max: e.target.value } : r)} placeholder="e.g. 30" /></label>
            </div>
            <div className="bsc-note"><Icon name="shield" size={16} /> Confirming marks these pages as checked by a person.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="bsc-btn" style={{ flex: 1 }} onClick={() => setReviewing(null)}>Cancel</button>
              <button className="bsc-btn bsc-pri" style={{ flex: 2 }} onClick={confirmReview}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {processing && (
        <div className="bsc-veil" role="status"><span className="bsc-spinner" /><span>{processing}</span></div>
      )}
      {toastMsg && <div className="bsc-toast" role="status">{toastMsg}</div>}
    </div>
  );
}
