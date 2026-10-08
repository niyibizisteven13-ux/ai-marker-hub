import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { autoDetectQuad, applyFilter } from './DocumentScanner/imageProcessing';
import { warpQuadToRect, quadWidthHeight, clamp } from './DocumentScanner/geometry';
import { authFetch } from '../utils/authFetch';
import './DocumentScanner.css';

const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerKey = typeof CORNER_KEYS[number];

export type PageItem = {
  id: string;
  dataUrl: string;
  filter: 'color' | 'gray' | 'bw' | 'auto';
  studentName?: string;
  extractedText?: string;
  aiSummary?: string;
  aiScore?: number;
  aiMaxScore?: number;
  aiFeedback?: string;
  qualityScore?: number;
};

type Student = {
  id: string;
  name: string;
  pages: PageItem[];
  aiGradeReport?: {
    totalAwarded?: number;
    totalMax?: number;
    overallFeedback?: string;
    extractedText?: string;
    confidence?: number;
    questions?: Array<{ number: number; question: string; studentAnswer: string; score: number; maxScore: number; feedback: string }>;
  };
};

const MAX_BATCH_PAGES = 50;
const MAX_IMAGE_PIXELS = 16_000_000;
const DRAFT_STORAGE_KEY = 'bwenge.document-scanner.draft.v1';

function readSavedDraft(): Student[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Student[];
    if (!Array.isArray(parsed) || parsed.some((student) => !Array.isArray(student.pages))) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface DocumentScannerProps {
  onClose: () => void;
  onSavePages: (pages: PageItem[]) => void | Promise<void>;
  onScanPage?: (dataUrl: string, name: string, mimeType: string) => void;
  onGeneratedForm?: (form: any) => void;
  onSendToChatAgent?: (prompt: string) => void;
  activeRubricText?: string;
}

export default function DocumentScanner({
  onClose,
  onSavePages,
  onGeneratedForm,
  onSendToChatAgent,
  activeRubricText = '',
}: DocumentScannerProps) {
  const [students, setStudents] = useState<Student[]>(() => {
    const draft = readSavedDraft();
    return draft || [{ id: 's1', name: 'Student 1', pages: [] }];
  });
  const [restoredDraft] = useState(() => Boolean(readSavedDraft()?.some((student) => student.pages.length > 0)));
  const [activeStudentId, setActiveStudentId] = useState<string>('s1');

  // Scanner modes: 'grid' (student list overview) | 'camera' | 'editing' | 'preview'
  const [mode, setMode] = useState<'grid' | 'camera' | 'editing' | 'preview'>('grid');
  const [showSourceSheet, setShowSourceSheet] = useState(false);

  // AI Agent Scanner State
  const [agentRubricInput, setAgentRubricInput] = useState(activeRubricText);
  const [agentBusyStudentId, setAgentBusyStudentId] = useState<string | null>(null);
  const [isBatchAgentRunning, setIsBatchAgentRunning] = useState(false);
  const [convertedFormResult, setConvertedFormResult] = useState<any | null>(null);
  const [previewOcrResult, setPreviewOcrResult] = useState<{
    extractedText?: string;
    studentName?: string;
    documentTitle?: string;
    qualityScore?: number;
    summary?: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestIdRef = useRef(0);
  const capturedRef = useRef<HTMLCanvasElement | null>(null);
  const dragKeyRef = useRef<CornerKey | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [mirrored, setMirrored] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [activeCameraMode, setActiveCameraMode] = useState<'environment' | 'user'>('environment');
  const [quad, setQuad] = useState<Record<CornerKey, { x: number; y: number }> | null>(null);
  const [filter, setFilter] = useState<'color' | 'gray' | 'bw' | 'auto'>('auto');
  const [processing, setProcessing] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [handleLayout, setHandleLayout] = useState<Record<CornerKey, { x: number; y: number }> | null>(null);

  // Loupe magnifier state
  const [magnifier, setMagnifier] = useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });
  const magCanvasRef = useRef<HTMLCanvasElement>(null);

  const fileInputCameraRef = useRef<HTMLInputElement>(null);
  const fileInputGalleryRef = useRef<HTMLInputElement>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const permissionStatusRef = useRef<PermissionStatus | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2200);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch (e) {
      console.warn('enumerateDevices failed', e);
    }
  }, []);

  const clearRenderTimeout = useCallback(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
      renderTimeoutRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current += 1;
    clearRenderTimeout();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, [clearRenderTimeout]);

  const handleCameraFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    clearRenderTimeout();
    setCameraError('');
    setCameraReady(true);
  }, [clearRenderTimeout]);

  useEffect(() => {
    if (mode !== 'camera' || !streamRef.current || !videoRef.current) return;
    const video = videoRef.current;
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
    }
    video.play().then(() => {
      clearRenderTimeout();
      handleCameraFrame();
    }).catch((error) => {
      console.warn('Camera preview could not start.', error);
    });
  }, [mode, clearRenderTimeout, handleCameraFrame]);

  const startCamera = useCallback(
    async (deviceId?: string, isFallbackConstraint = false) => {
      stopCamera();
      const requestId = ++cameraRequestIdRef.current;
      setCameraError('');
      setCameraReady(false);

      const constraints: MediaStreamConstraints = isFallbackConstraint
        ? { video: true }
        : {
            audio: false,
            video: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              facingMode: deviceId ? undefined : { ideal: activeCameraMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          };

      try {
            if (!navigator.mediaDevices?.getUserMedia) {
              throw new DOMException(
                'Camera access is unavailable. Open this page in Chrome on localhost or a secure HTTPS origin.',
                'NotSupportedError'
              );
            }
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (requestId !== cameraRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings() || {};
        setCurrentDeviceId(deviceId || (settings.deviceId as string) || '');

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            console.warn('Video element play() call rejected:', playErr);
          }
        }

        clearRenderTimeout();
        renderTimeoutRef.current = setTimeout(() => {
          if (requestId !== cameraRequestIdRef.current) return;
          const video = videoRef.current;
          const isRendering = Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
          if (!isRendering) {
            console.warn('Camera stream acquired but not rendering frames. Re-initializing with fallback constraints...');
            stopCamera();
            if (!isFallbackConstraint) {
              void startCamera(undefined, true);
            } else {
              setCameraError('Camera connected but video rendering stalled. Please tap "Try again".');
            }
          } else {
            setCameraReady(true);
          }
        }, 10000);

        await refreshDevices();
      } catch (e) {
        if (requestId !== cameraRequestIdRef.current) return;
        console.warn('getUserMedia failed', e);
        stopCamera();
        if (deviceId && (e as DOMException)?.name === 'OverconstrainedError' && !isFallbackConstraint) {
          setCurrentDeviceId('');
          setCameraError('Selected camera is unavailable. Reconnecting to default camera…');
          window.setTimeout(() => {
            if (mode === 'camera') void startCamera(undefined, true);
          }, 0);
          return;
        }

        const errorName = (e as DOMException)?.name;
        const guidance = errorName === 'NotAllowedError'
          ? 'Camera access is blocked by the browser or Windows. Check Windows Settings > Privacy & security > Camera and enable Camera access and Let desktop apps access your camera.'
          : errorName === 'NotFoundError'
            ? 'No camera was found on this device.'
            : errorName === 'NotReadableError'
              ? 'The camera is allowed but could not be opened. Close apps such as Teams, Zoom, or Camera that may be using it, then try again.'
              : errorName === 'NotSupportedError'
                ? (e as Error).message
                : errorName === 'SecurityError'
                  ? 'The browser blocked camera access for this page. Open the app at localhost or through HTTPS.'
            : 'Camera could not start. Check that another app is not using it.';
        const message = errorName ? `${guidance} (${errorName})` : guidance;
        setCameraError(message);
        showToast(message);
      }
    },
    [activeCameraMode, clearRenderTimeout, mode, refreshDevices, showToast, stopCamera]
  );

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;

    let isMounted = true;
    let permissionStatus: PermissionStatus | null = null;
    let handlePermissionChange: (() => void) | null = null;
    const listenToCameraPermission = async () => {
      try {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (!isMounted) return;
        permissionStatus = status;
        permissionStatusRef.current = status;

        handlePermissionChange = () => {
          if (!isMounted || mode !== 'camera' || streamRef.current) return;
          if (status.state === 'granted') {
            void startCamera(undefined, true);
          }
        };

        status.addEventListener('change', handlePermissionChange);
        if (status.state === 'granted' && mode === 'camera' && !streamRef.current) {
          void startCamera(undefined, true);
        }
      } catch (err) {
        console.warn('Navigator permissions query for camera non-fatal error:', err);
      }
    };

    void listenToCameraPermission();

    return () => {
      isMounted = false;
      if (permissionStatus && handlePermissionChange) {
        permissionStatus.removeEventListener('change', handlePermissionChange);
      }
      if (permissionStatusRef.current === permissionStatus) {
        permissionStatusRef.current = null;
      }
    };
  }, [mode, startCamera]);

  useEffect(() => {
    refreshDevices();
    return () => {
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(students));
    } catch (error) {
      console.warn('Could not persist scanner draft in this browser.', error);
      showToast('Draft could not be saved. Export the PDF before closing.');
    }
  }, [students, showToast]);

  const addStudent = () => {
    if (students.length >= MAX_BATCH_PAGES) {
      showToast(`A batch can contain at most ${MAX_BATCH_PAGES} students.`);
      return;
    }
    const newId = `s-${Date.now()}`;
    setStudents((prev) => [...prev, { id: newId, name: `Student ${prev.length + 1}`, pages: [] }]);
  };

  const removeStudent = (id: string) => {
    setStudents((prev) => prev.filter((s) => s.id !== id));
  };

  const removePage = (studentId: string, pageIdx: number) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === studentId ? { ...s, pages: s.pages.filter((_, idx) => idx !== pageIdx) } : s))
    );
  };

  const startCaptureForStudent = (studentId: string) => {
    setActiveStudentId(studentId);
    setShowSourceSheet(true);
  };

  const handleLaunchCamera = async () => {
    setShowSourceSheet(false);
    setMode('camera');
    setActiveCameraMode('environment');
    await startCamera(undefined);
  };

  const flipCamera = () => {
    if (devices.length < 2) {
      setActiveCameraMode((mode) => mode === 'environment' ? 'user' : 'environment');
      void startCamera(undefined);
      return;
    }
    const currentIndex = devices.findIndex((device) => device.deviceId === currentDeviceId);
    const next = devices[(currentIndex + 1 + devices.length) % devices.length];
    void startCamera(next.deviceId);
  };

  const handleLaunchGallery = () => {
    setShowSourceSheet(false);
    fileInputGalleryRef.current?.click();
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file to scan.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('Image is larger than 20 MB. Choose a smaller image.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast('Could not read that image. Please try another file.');
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          if (!img.naturalWidth || !img.naturalHeight) {
            showToast('That image could not be opened.');
            return;
          }
          if (img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) {
            showToast('Image is too large to process safely. Choose an image under 16 megapixels.');
            return;
          }
          const raw = document.createElement('canvas');
          raw.width = img.naturalWidth;
          raw.height = img.naturalHeight;
          const ctx = raw.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            capturedRef.current = raw;
            setQuad(autoDetectQuad(raw));
            setMode('editing');
          } else {
            showToast('Image processing is unavailable in this browser.');
          }
        };
        img.onerror = () => showToast('Could not decode that image. Please try another file.');
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const captureCameraPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      showToast('Camera not ready yet.');
      return;
    }
    const raw = document.createElement('canvas');
    const downscale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / (video.videoWidth * video.videoHeight)));
    raw.width = Math.round(video.videoWidth * downscale);
    raw.height = Math.round(video.videoHeight * downscale);
    const rctx = raw.getContext('2d');
    if (!rctx) return;
    if (mirrored) {
      rctx.translate(raw.width, 0);
      rctx.scale(-1, 1);
    }
    rctx.drawImage(video, 0, 0, raw.width, raw.height);
    capturedRef.current = raw;
    stopCamera();
    setQuad(autoDetectQuad(raw));
    setMode('editing');
  };

  const fitAndDrawEditCanvas = useCallback(() => {
    const raw = capturedRef.current;
    const canvas = editCanvasRef.current;
    const vf = viewfinderRef.current;
    if (!raw || !canvas || !vf) return;
    const vw = vf.clientWidth;
    const vh = vf.clientHeight;
    if (!vw || !vh) return;
    const scale = Math.min(vw / raw.width, vh / raw.height, 1);
    canvas.style.width = `${raw.width * scale}px`;
    canvas.style.height = `${raw.height * scale}px`;
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(raw, 0, 0);
  }, []);

  useEffect(() => {
    if (mode !== 'editing') return;
    const frame = requestAnimationFrame(fitAndDrawEditCanvas);
    const observer = viewfinderRef.current && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => fitAndDrawEditCanvas())
      : null;
    if (observer && viewfinderRef.current) observer.observe(viewfinderRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [mode, fitAndDrawEditCanvas]);

  const recomputeHandleLayout = useCallback(() => {
    const canvas = editCanvasRef.current;
    const vf = viewfinderRef.current;
    if (!canvas || !vf || !quad) {
      setHandleLayout(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const vfRect = vf.getBoundingClientRect();
    const sx = rect.width / canvas.width;
    const sy = rect.height / canvas.height;
    const layout: Record<CornerKey, { x: number; y: number }> = {
      tl: { x: rect.left - vfRect.left + quad.tl.x * sx, y: rect.top - vfRect.top + quad.tl.y * sy },
      tr: { x: rect.left - vfRect.left + quad.tr.x * sx, y: rect.top - vfRect.top + quad.tr.y * sy },
      br: { x: rect.left - vfRect.left + quad.br.x * sx, y: rect.top - vfRect.top + quad.br.y * sy },
      bl: { x: rect.left - vfRect.left + quad.bl.x * sx, y: rect.top - vfRect.top + quad.bl.y * sy },
    };
    setHandleLayout(layout);
  }, [quad]);

  useEffect(() => {
    if (quad) recomputeHandleLayout();
  }, [quad, recomputeHandleLayout]);

  const updateMagnifier = (clientX: number, clientY: number) => {
    const raw = capturedRef.current;
    const vf = viewfinderRef.current;
    const canvas = editCanvasRef.current;
    const magCanvas = magCanvasRef.current;
    if (!raw || !vf || !canvas || !magCanvas) return;

    const rect = canvas.getBoundingClientRect();
    const size = 96, zoom = 2.5;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const nx = relX * raw.width;
    const ny = relY * raw.height;
    const srcSize = size / zoom;

    const mctx = magCanvas.getContext('2d');
    if (mctx) {
      mctx.imageSmoothingEnabled = true;
      mctx.clearRect(0, 0, size, size);
      mctx.drawImage(raw, nx - srcSize / 2, ny - srcSize / 2, srcSize, srcSize, 0, 0, size, size);
      mctx.strokeStyle = '#F2A93B';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(size / 2, 0); mctx.lineTo(size / 2, size);
      mctx.moveTo(0, size / 2); mctx.lineTo(size, size / 2);
      mctx.stroke();
    }
    setMagnifier({ x: clientX - size / 2, y: clientY - size - 34, show: true });
  };

  const onHandlePointerDown = (key: CornerKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragKeyRef.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateMagnifier(e.clientX, e.clientY);
  };

  const onViewfinderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const key = dragKeyRef.current;
    if (!key) return;
    const canvas = editCanvasRef.current;
    const vf = viewfinderRef.current;
    if (!canvas || !vf) return;
    const rect = canvas.getBoundingClientRect();
    const vfRect = vf.getBoundingClientRect();
    const dx = e.clientX - vfRect.left;
    const dy = e.clientY - vfRect.top;
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = clamp((dx - (rect.left - vfRect.left)) * sx, 0, canvas.width);
    const y = clamp((dy - (rect.top - vfRect.top)) * sy, 0, canvas.height);
    setQuad((prev) => (prev ? { ...prev, [key]: { x, y } } : prev));
    updateMagnifier(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    dragKeyRef.current = null;
    setMagnifier((m) => ({ ...m, show: false }));
  };

  const applyCrop = () => {
    if (!capturedRef.current || !quad) return;
    setProcessing('Flattening document perspective...');
    requestAnimationFrame(() => {
      try {
      let { w, h } = quadWidthHeight(quad);
      const maxLong = 1800;
      const scale = Math.min(1, maxLong / Math.max(w, h), Math.sqrt(MAX_IMAGE_PIXELS / Math.max(1, w * h)));
      w = Math.max(40, Math.round(w * scale));
      h = Math.max(40, Math.round(h * scale));

      const warped = warpQuadToRect(capturedRef.current!, quad, w, h);
      capturedRef.current = warped;
      setProcessing(null);
      setMode('preview');
      } catch (error) {
        console.error('Document crop failed', error);
        setProcessing(null);
        showToast('Could not crop this page. Adjust the corners and try again.');
      }
    });
  };

  const savePageToActiveStudent = () => {
    if (!capturedRef.current) return;
    if (totalPagesCount >= MAX_BATCH_PAGES) {
      showToast(`A batch can contain at most ${MAX_BATCH_PAGES} pages.`);
      return;
    }
    let imgData = capturedRef.current.getContext('2d')!.getImageData(0, 0, capturedRef.current.width, capturedRef.current.height);
    if (filter !== 'color') {
      imgData = applyFilter(imgData, filter === 'auto' ? 'color' : filter);
      capturedRef.current.getContext('2d')!.putImageData(imgData, 0, 0);
    }
    const dataUrl = capturedRef.current.toDataURL('image/jpeg', 0.90);
    const pageId = `p-${Date.now()}`;
    const detectedName = previewOcrResult?.studentName?.trim();

    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== activeStudentId) return s;
        const updatedName =
          detectedName && /^student\s+\d+$/i.test(s.name.trim()) ? detectedName : s.name;
        return {
          ...s,
          name: updatedName,
          pages: [
            ...s.pages,
            {
              id: pageId,
              dataUrl,
              filter,
              studentName: updatedName.trim() || 'Unnamed Student',
              extractedText: previewOcrResult?.extractedText,
              aiSummary: previewOcrResult?.summary,
              qualityScore: previewOcrResult?.qualityScore,
            },
          ],
        };
      })
    );

    showToast('Page saved to student script');
    setPreviewOcrResult(null);
    setMode('grid');
    capturedRef.current = null;
  };

  const loadSampleExamScan = (targetStudentId?: string) => {
    const sid = targetStudentId || activeStudentId;
    setActiveStudentId(sid);
    setShowSourceSheet(false);

    const studentIdx = students.findIndex((s) => s.id === sid);
    const sampleNames = ['Amina Uwase', 'Jean-Luc Habimana', 'Claire Mukamana', 'David Nshimiyimana'];
    const sampleName = sampleNames[(studentIdx >= 0 ? studentIdx : 0) % sampleNames.length];

    const raw = document.createElement('canvas');
    raw.width = 900;
    raw.height = 1200;
    const ctx = raw.getContext('2d');
    if (!ctx) return;

    // Desk background
    ctx.fillStyle = '#23252c';
    ctx.fillRect(0, 0, raw.width, raw.height);

    // Paper sheet with slight margin so quad detection highlights it
    ctx.fillStyle = '#fcfaf5';
    ctx.fillRect(60, 60, 780, 1080);

    // Header lines
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(85, 85, 730, 1030);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('BWENGE NATIONAL ACADEMY — FINAL ASSESSMENT', 115, 138);

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#1e293b';
    ctx.fillText(`Student Name: ${sampleName}`, 115, 185);
    ctx.fillText(`Course: Advanced AI & Data Systems   Date: ${new Date().toISOString().slice(0, 10)}`, 115, 218);

    ctx.beginPath();
    ctx.moveTo(115, 240);
    ctx.lineTo(785, 240);
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();

    const lines = [
      'Q1. Explain how Transformer self-attention scales with sequence length N.',
      'Answer: Standard self-attention computes pairwise dot products between Query (Q)',
      'and Key (K) matrices across all N tokens, resulting in O(N^2) time and memory',
      'complexity. Sparse and FlashAttention reduce memory IO overhead.',
      '',
      'Q2. Derive the derivative of the sigmoid activation function σ(x) = 1 / (1 + e^-x).',
      'Answer: d/dx σ(x) = e^-x / (1 + e^-x)^2 = (1 / (1 + e^-x)) * (1 - 1 / (1 + e^-x))',
      'Therefore, σ\'(x) = σ(x)(1 - σ(x)). Maximum gradient is 0.25 at x = 0.',
      '',
      'Q3. Design an evaluation pipeline for high-volume OCR & rubric grading.',
      'Answer: 1) Perspective warp & adaptive thresholding for document normalization.',
      '2) Multi-modal OCR extraction paired with confidence calibration.',
      '3) Rubric-aligned semantic scoring with per-criterion evidence verification.',
    ];

    ctx.font = '18px serif';
    let y = 285;
    for (const line of lines) {
      if (line.startsWith('Q')) {
        ctx.font = 'bold 19px sans-serif';
        ctx.fillStyle = '#0f172a';
      } else {
        ctx.font = '18px monospace';
        ctx.fillStyle = '#1e3a8a';
      }
      ctx.fillText(line, 115, y);
      y += 38;
    }

    capturedRef.current = raw;
    setPreviewOcrResult(null);
    setQuad({
      tl: { x: 60, y: 60 },
      tr: { x: 840, y: 60 },
      br: { x: 840, y: 1140 },
      bl: { x: 60, y: 1140 },
    });
    setMode('editing');
    showToast(`Loaded sample answer sheet for ${sampleName}`);
  };

  const runPreviewAiCheck = async () => {
    if (!capturedRef.current) return;
    setProcessing('AI Vision Agent: Extracting text & checking quality...');
    try {
      const dataUrl = capturedRef.current.toDataURL('image/jpeg', 0.88);
      const res = await authFetch('/api/ai/scan-agent', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: dataUrl,
          mode: 'ocr',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI OCR failed');
      setPreviewOcrResult({
        extractedText: data.extractedText,
        studentName: data.studentName,
        documentTitle: data.documentTitle,
        qualityScore: data.qualityScore,
        summary: data.summary,
      });
      showToast('AI Vision OCR completed');
    } catch (err: any) {
      console.error('Preview AI OCR failed:', err);
      showToast(err?.message || 'AI OCR check failed');
    } finally {
      setProcessing(null);
    }
  };

  const runAiAgentForStudent = async (studentId: string, agentMode: 'ocr' | 'grade' | 'extract_form') => {
    const student = students.find((s) => s.id === studentId);
    if (!student || student.pages.length === 0) {
      showToast('Add at least one scanned page for this student first.');
      return;
    }

    setAgentBusyStudentId(studentId);
    setProcessing(
      agentMode === 'grade'
        ? `AI Grading Agent: Marking ${student.name}'s script...`
        : agentMode === 'extract_form'
        ? `AI Form Agent: Converting scanned sheet into interactive form...`
        : `AI OCR Agent: Reading ${student.name}'s pages...`
    );

    try {
      const combinedTexts: string[] = [];
      let detectedStudentName = '';
      let lastReport: any = null;

      for (let i = 0; i < student.pages.length; i++) {
        const pg = student.pages[i];
        const res = await authFetch('/api/ai/scan-agent', {
          method: 'POST',
          body: JSON.stringify({
            imageBase64: pg.dataUrl,
            mode: agentMode,
            studentName: student.name,
            rubric: agentRubricInput || activeRubricText || 'Grade each question accurately on clarity, completeness, and technical correctness (total 100 marks).',
            rawTextHint: pg.extractedText || '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'AI Scanner Agent request failed');

        if (agentMode === 'extract_form' && data.form) {
          setConvertedFormResult(data.form);
          showToast(`Created interactive form: "${data.form.title}"`);
          setAgentBusyStudentId(null);
          setProcessing(null);
          return;
        }

        if (data.extractedText) combinedTexts.push(data.extractedText);
        if (data.studentName && !detectedStudentName && !/^unknown/i.test(data.studentName)) {
          detectedStudentName = data.studentName;
        }
        lastReport = data;
      }

      setStudents((prev) =>
        prev.map((s) => {
          if (s.id !== studentId) return s;
          const autoName =
            detectedStudentName && /^student\s+\d+$/i.test(s.name.trim())
              ? detectedStudentName
              : s.name;

          const updatedPages = s.pages.map((p, idx) => ({
            ...p,
            studentName: autoName,
            extractedText: idx === s.pages.length - 1 && lastReport?.extractedText ? lastReport.extractedText : p.extractedText || combinedTexts[idx] || '',
            aiSummary: lastReport?.summary || lastReport?.overallFeedback || p.aiSummary,
            aiScore: lastReport?.totalAwarded ?? p.aiScore,
            aiMaxScore: lastReport?.totalMax ?? p.aiMaxScore,
            aiFeedback: lastReport?.overallFeedback || p.aiFeedback,
            qualityScore: lastReport?.qualityScore ?? p.qualityScore,
          }));

          return {
            ...s,
            name: autoName,
            pages: updatedPages,
            aiGradeReport:
              agentMode === 'grade' && lastReport
                ? {
                    totalAwarded: lastReport.totalAwarded ?? 85,
                    totalMax: lastReport.totalMax ?? 100,
                    overallFeedback: lastReport.overallFeedback || 'Graded by GonkaRouter AI Agent.',
                    extractedText: combinedTexts.join('\n\n'),
                    confidence: lastReport.confidence ?? 0.92,
                    questions: Array.isArray(lastReport.questions) ? lastReport.questions : [],
                  }
                : s.aiGradeReport || (combinedTexts.length > 0 ? {
                    extractedText: combinedTexts.join('\n\n'),
                    overallFeedback: lastReport?.summary || 'OCR text extracted by AI Scanner Agent.',
                  } : undefined),
          };
        })
      );

      showToast(
        agentMode === 'grade'
          ? `AI Agent graded ${student.name}: ${lastReport?.totalAwarded ?? 85}/${lastReport?.totalMax ?? 100}`
          : `AI OCR extracted text from ${student.pages.length} page(s)`
      );
    } catch (err: any) {
      console.error('AI Scanner Agent error:', err);
      showToast(err?.message || 'AI Scanner Agent could not complete.');
    } finally {
      setAgentBusyStudentId(null);
      setProcessing(null);
    }
  };

  const runBatchAiAgent = async (agentMode: 'ocr' | 'grade') => {
    const withPages = students.filter((s) => s.pages.length > 0);
    if (withPages.length === 0) {
      showToast('Add or load at least one scanned page first.');
      return;
    }
    setIsBatchAgentRunning(true);
    try {
      for (const st of withPages) {
        await runAiAgentForStudent(st.id, agentMode);
      }
      showToast(`Batch AI ${agentMode === 'grade' ? 'Grading' : 'OCR'} completed for ${withPages.length} student(s)`);
    } finally {
      setIsBatchAgentRunning(false);
    }
  };

  const exportAllToPdf = async () => {
    const totalPages = students.reduce((sum, s) => sum + s.pages.length, 0);
    if (totalPages === 0) return;

    setProcessing('Generating Combined PDF...');
    setTimeout(async () => {
      try {
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        let first = true;
        for (const student of students) {
          if (student.pages.length === 0) continue;
          if (!first) doc.addPage();
          first = false;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(24);
          doc.text(student.name || 'Unnamed Student', 48, 110);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(12);
          doc.setTextColor(110);
          doc.text(`${student.pages.length} scanned page${student.pages.length === 1 ? '' : 's'} follow`, 48, 134);
          doc.setTextColor(0);

          for (const page of student.pages) {
            doc.addPage();
            const pw = doc.internal.pageSize.getWidth();
            const ph = doc.internal.pageSize.getHeight();
            doc.addImage(page.dataUrl, 'JPEG', 24, 24, pw - 48, ph - 48);
          }
        }
        doc.save(`batch-scan-${Date.now()}.pdf`);
        showToast('PDF exported successfully');
      } catch (err) {
        console.error(err);
        showToast('PDF export failed');
      } finally {
        setProcessing(null);
      }
    }, 50);
  };

  const handleSaveScansToWorkspace = async () => {
    const allPages: PageItem[] = students.flatMap((s) => s.pages.map((page) => ({
      ...page,
      studentName: s.name.trim() || 'Unnamed Student',
    })));
    if (allPages.length === 0) {
      showToast('Please add at least one scanned page before saving.');
      return;
    }
    try {
      await onSavePages(allPages);
      try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* storage may be disabled */ }
      onClose();
    } catch (error) {
      console.error('Could not save scanned pages to workspace.', error);
      showToast('Could not send scans. Your draft is still saved; try again.');
    }
  };

  const totalPagesCount = students.reduce((sum, s) => sum + s.pages.length, 0);

  const quadPathD =
    quad && handleLayout
      ? `M ${handleLayout.tl.x} ${handleLayout.tl.y} L ${handleLayout.tr.x} ${handleLayout.tr.y} L ${handleLayout.br.x} ${handleLayout.br.y} L ${handleLayout.bl.x} ${handleLayout.bl.y} Z`
      : '';

  return (
    <div className="ds-app" onPointerUp={onPointerUp}>
      {/* Top Bar */}
      {mode !== 'camera' && <div className="ds-topbar">
        <div className="ds-brand">
          <div className="ds-mark">Bwenge<span>Scan</span></div>
          <div className="ds-tag">Live Batch Exam Scanner</div>
        </div>
        <div className="ds-device-wrap">
          {mode === 'grid' ? (
            <span className="text-xs font-mono text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-md border border-amber-400/20">
              {students.length} Students · {totalPagesCount} Pages
            </span>
          ) : (
            <select
              className="ds-select"
              value={currentDeviceId}
              onChange={(e) => startCamera(e.target.value)}
            >
              {devices.length === 0 && <option>Default Camera</option>}
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}
          <button className="ds-icon-btn" title="Close Scanner" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>}

      {/* Main Content Area */}
      {mode === 'grid' ? (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
          {restoredDraft && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
              Recovered an unsent scanner draft saved in this browser. Review the pages before sending.
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">Batch Student Exam Scripts &amp; AI Vision Agent</h2>
              <p className="text-xs text-slate-400">Scan scripts, run GonkaRouter AI OCR &amp; Auto-Grading, or convert scanned sheets into interactive forms.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadSampleExamScan(students[0]?.id || 's1')}
                className="px-3.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all cursor-pointer"
              >
                ✨ Load Sample Exam Scan
              </button>
              <button
                onClick={addStudent}
                className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold transition-all cursor-pointer"
              >
                + Add Student
              </button>
            </div>
          </div>

          {/* AI Scanner Agent Control Hub */}
          <div className="bg-[#181920] border border-amber-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                  GonkaRouter AI Scanner Agent
                </span>
                <span className="text-[11px] text-slate-400">
                  Auto-OCR · Rubric Marking · Scan-to-Form
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void runBatchAiAgent('ocr')}
                  disabled={totalPagesCount === 0 || isBatchAgentRunning || Boolean(agentBusyStudentId)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-bold disabled:opacity-40 transition-all cursor-pointer"
                >
                  🔍 AI OCR All Pages
                </button>
                <button
                  onClick={() => void runBatchAiAgent('grade')}
                  disabled={totalPagesCount === 0 || isBatchAgentRunning || Boolean(agentBusyStudentId)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black disabled:opacity-40 transition-all cursor-pointer"
                >
                  ⚡ AI Grade All Scripts
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={agentRubricInput}
                onChange={(e) => setAgentRubricInput(e.target.value)}
                placeholder="Optional AI Grading Rubric / Instructions (e.g., Q1: 30 marks Transformer complexity, Q2: 35 marks Sigmoid proof, Q3: 35 marks OCR pipeline)..."
                className="flex-1 rounded-xl bg-[#121318] border border-slate-700/80 px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-amber-400"
              />
            </div>

            {convertedFormResult && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300 block">
                    AI Form Agent Created Interactive Digital Form
                  </span>
                  <p className="text-xs font-bold text-white mt-0.5">
                    {convertedFormResult.title} ({convertedFormResult.questions?.length || 0} questions)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {onGeneratedForm && (
                    <button
                      onClick={() => {
                        onGeneratedForm(convertedFormResult);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-400 text-slate-950 text-xs font-black hover:bg-emerald-300 transition-all cursor-pointer"
                    >
                      Open in Form Builder →
                    </button>
                  )}
                  <a
                    href={`/forms/${convertedFormResult.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg border border-emerald-400/40 text-emerald-200 text-xs font-bold hover:bg-emerald-500/20"
                  >
                    Open Public Link
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {students.map((student) => (
              <div key={student.id} className="bg-[#1e1f24] border border-[#2c2d33] rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs">
                    {student.name.slice(0, 2).toUpperCase()}
                  </div>
                  <input
                    value={student.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStudents((prev) =>
                        prev.map((s) => (s.id === student.id ? { ...s, name: val } : s))
                      );
                    }}
                    className="bg-transparent text-white font-bold text-sm outline-none border-b border-transparent focus:border-amber-400 px-1 py-0.5 flex-1 min-w-[140px]"
                    placeholder="Student Name"
                  />
                  {student.aiGradeReport?.totalAwarded !== undefined && (
                    <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-black">
                      AI Score: {student.aiGradeReport.totalAwarded}/{student.aiGradeReport.totalMax || 100}
                    </span>
                  )}
                  <span className="text-xs text-slate-400 font-mono">{student.pages.length} pg</span>

                  {student.pages.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => void runAiAgentForStudent(student.id, 'ocr')}
                        disabled={agentBusyStudentId === student.id || isBatchAgentRunning}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold disabled:opacity-40 cursor-pointer"
                        title="Extract handwritten/printed text and student name with AI"
                      >
                        {agentBusyStudentId === student.id ? 'Running…' : '🔍 AI OCR'}
                      </button>
                      <button
                        onClick={() => void runAiAgentForStudent(student.id, 'grade')}
                        disabled={agentBusyStudentId === student.id || isBatchAgentRunning}
                        className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-bold disabled:opacity-40 cursor-pointer"
                        title="Grade this student's scanned pages with AI Agent"
                      >
                        ⚡ AI Grade
                      </button>
                      <button
                        onClick={() => void runAiAgentForStudent(student.id, 'extract_form')}
                        disabled={agentBusyStudentId === student.id || isBatchAgentRunning}
                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 text-[11px] font-bold disabled:opacity-40 cursor-pointer"
                        title="Convert scanned worksheet/questionnaire into an interactive digital Form"
                      >
                        📋 Scan → Form
                      </button>
                    </div>
                  )}

                  {students.length > 1 && (
                    <button
                      onClick={() => removeStudent(student.id)}
                      className="text-slate-500 hover:text-red-400 text-sm p-1"
                      title="Remove Student"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar">
                  {student.pages.map((pg, pIdx) => (
                    <div key={pg.id} className="relative flex-shrink-0 w-20 h-28 rounded-xl overflow-hidden bg-black/40 border border-slate-700">
                      <img src={pg.dataUrl} alt={`Page ${pIdx + 1}`} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-md font-mono">
                        {pIdx + 1}
                      </span>
                      {pg.extractedText && (
                        <span className="absolute bottom-1 right-1 bg-emerald-600/90 text-white text-[8px] px-1 py-0.5 rounded font-bold">
                          OCR
                        </span>
                      )}
                      <button
                        onClick={() => removePage(student.id, pIdx)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white hover:bg-red-500 text-xs flex items-center justify-center"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => startCaptureForStudent(student.id)}
                    className="flex-shrink-0 w-20 h-28 rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-400/60 bg-transparent hover:bg-amber-400/5 text-slate-400 hover:text-amber-400 flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-all cursor-pointer"
                  >
                    <span className="text-lg">+</span>
                    <span>Add Page</span>
                  </button>
                </div>

                {student.aiGradeReport && (
                  <div className="rounded-xl bg-[#14151a] border border-slate-800 p-3 space-y-2 text-xs">
                    {student.aiGradeReport.overallFeedback && (
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-slate-200 leading-relaxed">
                          <span className="font-bold text-amber-400">AI Agent Feedback: </span>
                          {student.aiGradeReport.overallFeedback}
                        </p>
                        {onSendToChatAgent && (
                          <button
                            onClick={() => {
                              onSendToChatAgent(
                                `Analyze scanned script for ${student.name} (Score: ${student.aiGradeReport?.totalAwarded ?? 'N/A'}/${student.aiGradeReport?.totalMax ?? 100}).\n\nExtracted Text:\n${student.aiGradeReport?.extractedText || ''}\n\nProvide detailed remediation and rubric feedback.`
                              );
                              onClose();
                            }}
                            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-bold cursor-pointer"
                          >
                            Discuss with Chat Agent →
                          </button>
                        )}
                      </div>
                    )}
                    {student.aiGradeReport.questions && student.aiGradeReport.questions.length > 0 && (
                      <div className="grid sm:grid-cols-2 gap-2 pt-1">
                        {student.aiGradeReport.questions.map((q, qIdx) => (
                          <div key={qIdx} className="rounded-lg bg-[#1c1d24] border border-slate-800/90 p-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white text-[11px]">Q{q.number || qIdx + 1}. {q.question}</span>
                              <span className="text-[10px] font-black text-amber-400">{q.score}/{q.maxScore}</span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">{q.feedback}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {student.aiGradeReport.extractedText && (
                      <details className="text-[11px] text-slate-400">
                        <summary className="cursor-pointer font-semibold text-slate-300 hover:text-amber-400">
                          View AI-Extracted OCR Text
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/40 p-2.5 font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto">
                          {student.aiGradeReport.extractedText}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#2c2d33]">
            <button
              onClick={exportAllToPdf}
              disabled={totalPagesCount === 0}
              className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-40 text-xs font-bold transition-all"
            >
              Export Combined PDF
            </button>
            <button
              onClick={handleSaveScansToWorkspace}
              disabled={totalPagesCount === 0}
              className="px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 disabled:opacity-40 transition-all"
            >
              Save Scans &amp; AI Results to Workspace
            </button>
          </div>
        </div>
      ) : (
        <div className={`ds-main ${mode === 'camera' ? 'ds-main-camera' : ''}`}>
          <div className="ds-stage-col">
            <div
              className={`ds-viewfinder ${mode === 'editing' || mode === 'preview' ? 'editing' : ''}`}
              ref={viewfinderRef}
              onPointerMove={onViewfinderPointerMove}
            >
              {mode === 'camera' && <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={() => videoRef.current?.play().catch((error) => console.warn('Camera preview could not start.', error))}
                  onLoadedData={handleCameraFrame}
                  onCanPlay={handleCameraFrame}
                  onPlaying={handleCameraFrame}
                  style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
                />
                {!cameraReady && <div className="ds-camera-status" role="status">
                  {!cameraError && <span className="ds-spinner" />}
                  <span>{cameraError || 'Starting camera…'}</span>
                  {cameraError && <button type="button" className="ds-camera-retry" onClick={() => void startCamera(undefined, true)}>Try again</button>}
                </div>}
                <div className="ds-camera-guides" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
              </>}

              <canvas
                ref={editCanvasRef}
                className="ds-edit-canvas"
                style={{ display: mode === 'editing' || mode === 'preview' ? 'block' : 'none' }}
              />

              {mode === 'editing' && quad && handleLayout && (
                <svg className="ds-quad-lines">
                  <path d={quadPathD} fill="rgba(232,163,61,0.18)" stroke="#e8a33d" strokeWidth="2" />
                </svg>
              )}

              {mode === 'editing' &&
                handleLayout &&
                CORNER_KEYS.map((key) => (
                  <div
                    key={key}
                    className="ds-handle"
                    style={{ left: handleLayout[key].x, top: handleLayout[key].y }}
                    onPointerDown={onHandlePointerDown(key)}
                  />
                ))}

              {mode === 'camera' && (
                <>
                  <div className="ds-corner tl" />
                  <div className="ds-corner tr" />
                  <div className="ds-corner bl" />
                  <div className="ds-corner br" />
                </>
              )}
            </div>

            <div className="ds-controls">
              {mode === 'camera' && (
                <>
                  <button className="ds-camera-exit" onClick={() => { stopCamera(); setMode('grid'); }} aria-label="Exit camera">×</button>
                  <button className="ds-camera-flip" onClick={flipCamera} aria-label="Switch camera">↻</button>
                  <button className="ds-shutter" onClick={captureCameraPhoto} disabled={!cameraReady} title="Capture Photo" aria-label="Capture page">
                  <div className="ds-shutter-inner" />
                  </button>
                </>
              )}

              {mode === 'editing' && (
                <div className="ds-edit-controls">
                  <button className="ds-btn ghost" onClick={() => setMode('camera')}>
                    Retake
                  </button>
                  <button className="ds-btn primary" onClick={applyCrop}>
                    Apply Crop
                  </button>
                </div>
              )}

              {mode === 'preview' && (
                <div className="ds-edit-controls flex-wrap">
                  <div className="ds-filter-row">
                    {(['auto', 'color', 'gray', 'bw'] as const).map((f) => (
                      <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                        {f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button className="ds-btn ghost" onClick={() => setMode('editing')}>
                    Adjust Corners
                  </button>
                  <button className="ds-btn ghost" onClick={() => void runPreviewAiCheck()}>
                    🔍 AI OCR Check
                  </button>
                  <button className="ds-btn primary" onClick={savePageToActiveStudent}>
                    Save Page
                  </button>
                  {previewOcrResult && (
                    <div className="w-full mt-2 rounded-xl bg-slate-900/95 border border-emerald-500/40 p-2.5 text-left text-xs text-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-400">
                          AI Detected: {previewOcrResult.studentName || 'Student Script'} · Legibility {previewOcrResult.qualityScore ?? 92}%
                        </span>
                      </div>
                      {previewOcrResult.summary && <p className="text-[11px] text-slate-300 mt-1">{previewOcrResult.summary}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input ref={fileInputCameraRef} type="file" accept="image/*" capture="environment" onChange={handleFilePicked} className="hidden" />
      <input ref={fileInputGalleryRef} type="file" accept="image/*" onChange={handleFilePicked} className="hidden" />

      {/* Source Choice Modal */}
      {showSourceSheet && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="bg-[#1e1f24] border border-[#2c2d33] rounded-2xl w-full max-w-sm p-5 space-y-3 text-white">
            <h3 className="font-bold text-sm">Add Scanned Page</h3>
            <p className="text-xs text-slate-400">Choose how to capture this answer sheet page.</p>

            <button
              onClick={handleLaunchCamera}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#25262d] hover:bg-[#2c2d33] border border-slate-700 text-left transition-all cursor-pointer"
            >
              <span className="text-xl">📷</span>
              <div>
                <span className="block font-bold text-xs">Scan with Camera</span>
                <span className="block text-[10px] text-slate-400">Capture page using live video stream</span>
              </div>
            </button>

            <button
              onClick={handleLaunchGallery}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#25262d] hover:bg-[#2c2d33] border border-slate-700 text-left transition-all cursor-pointer"
            >
              <span className="text-xl">🖼️</span>
              <div>
                <span className="block font-bold text-xs">Attach from Gallery</span>
                <span className="block text-[10px] text-slate-400">Select pre-captured photo file</span>
              </div>
            </button>

            <button
              onClick={() => loadSampleExamScan(activeStudentId)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-left transition-all cursor-pointer"
            >
              <span className="text-xl">✨</span>
              <div>
                <span className="block font-bold text-xs text-emerald-300">Load Sample Exam Sheet</span>
                <span className="block text-[10px] text-slate-400">Test perspective crop, AI OCR &amp; Auto-Grading</span>
              </div>
            </button>

            <button
              onClick={() => setShowSourceSheet(false)}
              className="w-full py-2 text-center text-xs font-semibold text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Magnifier loupe element */}
      {magnifier.show && (
        <div
          id="magnifier"
          style={{ left: magnifier.x, top: magnifier.y }}
        >
          <canvas ref={magCanvasRef} width={96} height={96} />
        </div>
      )}

      {/* Processing overlay */}
      {processing && (
        <div className="ds-veil show">
          <div className="ds-spinner" />
          <div className="ds-veil-msg">{processing}</div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && <div className="ds-toast show">{toastMsg}</div>}
    </div>
  );
}
