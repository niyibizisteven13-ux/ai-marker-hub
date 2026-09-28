import React, { useCallback, useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { autoDetectQuad, applyFilter } from './DocumentScanner/imageProcessing';
import { warpQuadToRect, quadWidthHeight, clamp } from './DocumentScanner/geometry';
import './DocumentScanner.css';

const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerKey = typeof CORNER_KEYS[number];

type PageItem = {
  id: string;
  dataUrl: string;
  filter: 'color' | 'gray' | 'bw' | 'auto';
};

type Student = {
  id: string;
  name: string;
  pages: PageItem[];
};

interface DocumentScannerProps {
  onClose: () => void;
  onSavePages: (pages: PageItem[]) => void;
  onScanPage?: (dataUrl: string, name: string, mimeType: string) => void;
}

export default function DocumentScanner({ onClose, onSavePages }: DocumentScannerProps) {
  const [students, setStudents] = useState<Student[]>([
    { id: 's1', name: 'Student 1', pages: [] },
  ]);
  const [activeStudentId, setActiveStudentId] = useState<string>('s1');

  // Scanner modes: 'grid' (student list overview) | 'camera' | 'editing' | 'preview'
  const [mode, setMode] = useState<'grid' | 'camera' | 'editing' | 'preview'>('grid');
  const [showSourceSheet, setShowSourceSheet] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef<HTMLCanvasElement | null>(null);
  const dragKeyRef = useRef<CornerKey | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [mirrored, setMirrored] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
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

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera();
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings() || {};
        setCurrentDeviceId(deviceId || (settings.deviceId as string) || '');
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraReady(true);
        await refreshDevices();
      } catch (e) {
        console.warn('getUserMedia failed', e);
        setCameraReady(false);
        showToast('Camera access unavailable — select gallery upload instead.');
      }
    },
    [refreshDevices, showToast, stopCamera]
  );

  useEffect(() => {
    refreshDevices();
    return () => {
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  const addStudent = () => {
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

  const handleLaunchCamera = () => {
    setShowSourceSheet(false);
    setMode('camera');
    startCamera(undefined);
  };

  const handleLaunchGallery = () => {
    setShowSourceSheet(false);
    fileInputGalleryRef.current?.click();
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.onload = () => {
          const raw = document.createElement('canvas');
          raw.width = img.naturalWidth;
          raw.height = img.naturalHeight;
          const ctx = raw.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            capturedRef.current = raw;
            setQuad(autoDetectQuad(raw));
            setMode('editing');
          }
        };
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
    raw.width = video.videoWidth;
    raw.height = video.videoHeight;
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
    const scale = Math.min(vw / raw.width, vh / raw.height, 1);
    canvas.style.width = `${raw.width * scale}px`;
    canvas.style.height = `${raw.height * scale}px`;
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(raw, 0, 0);
  }, []);

  useEffect(() => {
    if (mode === 'editing') fitAndDrawEditCanvas();
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
    setTimeout(() => {
      let { w, h } = quadWidthHeight(quad);
      const maxLong = 1800;
      const scale = Math.min(1, maxLong / Math.max(w, h));
      w = Math.max(40, Math.round(w * scale));
      h = Math.max(40, Math.round(h * scale));

      const warped = warpQuadToRect(capturedRef.current!, quad, w, h);
      capturedRef.current = warped;
      setProcessing(null);
      setMode('preview');
    }, 50);
  };

  const savePageToActiveStudent = () => {
    if (!capturedRef.current) return;
    let imgData = capturedRef.current.getContext('2d')!.getImageData(0, 0, capturedRef.current.width, capturedRef.current.height);
    if (filter !== 'color') {
      imgData = applyFilter(imgData, filter === 'auto' ? 'color' : filter);
      capturedRef.current.getContext('2d')!.putImageData(imgData, 0, 0);
    }
    const dataUrl = capturedRef.current.toDataURL('image/jpeg', 0.90);
    const pageId = `p-${Date.now()}`;

    setStudents((prev) =>
      prev.map((s) =>
        s.id === activeStudentId
          ? { ...s, pages: [...s.pages, { id: pageId, dataUrl, filter }] }
          : s
      )
    );

    showToast('Page saved to student script');
    setMode('grid');
    capturedRef.current = null;
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

  const handleSaveScansToWorkspace = () => {
    const allPages: PageItem[] = [];
    students.forEach((s) => allPages.push(...s.pages));
    if (allPages.length === 0) {
      showToast('Please add at least one scanned page before saving.');
      return;
    }
    onSavePages(allPages);
    onClose();
  };

  const totalPagesCount = students.reduce((sum, s) => sum + s.pages.length, 0);

  const quadPathD =
    quad && handleLayout
      ? `M ${handleLayout.tl.x} ${handleLayout.tl.y} L ${handleLayout.tr.x} ${handleLayout.tr.y} L ${handleLayout.br.x} ${handleLayout.br.y} L ${handleLayout.bl.x} ${handleLayout.bl.y} Z`
      : '';

  return (
    <div className="ds-app" onPointerUp={onPointerUp}>
      {/* Top Bar */}
      <div className="ds-topbar">
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
      </div>

      {/* Main Content Area */}
      {mode === 'grid' ? (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl mx-auto w-full">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Batch Student Exam Scripts</h2>
              <p className="text-xs text-slate-400">Organize scanned answer pages student-by-student before submission.</p>
            </div>
            <button
              onClick={addStudent}
              className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold transition-all"
            >
              + Add Student
            </button>
          </div>

          <div className="space-y-4">
            {students.map((student) => (
              <div key={student.id} className="bg-[#1e1f24] border border-[#2c2d33] rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
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
                    className="bg-transparent text-white font-bold text-sm outline-none border-b border-transparent focus:border-amber-400 px-1 py-0.5 flex-1"
                    placeholder="Student Name"
                  />
                  <span className="text-xs text-slate-400 font-mono">{student.pages.length} pg</span>
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
              </div>
            ))}
          </div>

          <div className="pt-4 flex items-center justify-between border-t border-[#2c2d33]">
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
              Save Scans to Workspace
            </button>
          </div>
        </div>
      ) : (
        <div className="ds-main">
          <div className="ds-stage-col">
            <div
              className={`ds-viewfinder ${mode === 'editing' || mode === 'preview' ? 'editing' : ''}`}
              ref={viewfinderRef}
              onPointerMove={onViewfinderPointerMove}
            >
              {mode === 'camera' && (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
                />
              )}

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
                <button className="ds-shutter" onClick={captureCameraPhoto} title="Capture Photo">
                  <div className="ds-shutter-inner" />
                </button>
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
                <div className="ds-edit-controls">
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
                  <button className="ds-btn primary" onClick={savePageToActiveStudent}>
                    Save Page
                  </button>
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
