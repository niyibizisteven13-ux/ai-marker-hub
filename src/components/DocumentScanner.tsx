import { useCallback, useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { autoDetectQuad, applyFilter } from './DocumentScanner/imageProcessing';
import { warpQuadToRect, quadWidthHeight, clamp } from './DocumentScanner/geometry';
import './DocumentScanner.css';

const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'] as const;

type CornerKey = typeof CORNER_KEYS[number];

type PageItem = {
  id: string;
  dataUrl: string;
  filter: 'color' | 'gray' | 'bw';
};

interface DocumentScannerProps {
  onClose: () => void;
  onSavePages: (pages: PageItem[]) => void;
  onScanPage?: (dataUrl: string, name: string, mimeType: string) => void;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function imageDims(dataUrl: string) {
  return new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataUrl;
  });
}

export default function DocumentScanner({ onClose, onSavePages }: DocumentScannerProps) {
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
  const [mode, setMode] = useState<'camera' | 'editing'>('camera');
  const [quad, setQuad] = useState<Record<CornerKey, { x: number; y: number }> | null>(null);
  const [filter, setFilter] = useState<'color' | 'gray' | 'bw'>('color');
  const [pages, setPages] = useState<PageItem[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [autoCaptureStatus, setAutoCaptureStatus] = useState<'searching' | 'aligned' | 'hold' | 'capturing'>('searching');
  const [handleLayout, setHandleLayout] = useState<Record<CornerKey, { x: number; y: number }> | null>(null);
  const [sweepKey, setSweepKey] = useState(0);
  const toastTimer = useRef<number | null>(null);
  const stabilityRef = useRef(0);
  const autoCaptureLoopRef = useRef<number | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200);
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
        showToast('Could not access that camera — check permissions and device connection.');
      }
    },
    [refreshDevices, showToast, stopCamera]
  );

  useEffect(() => {
    refreshDevices().then(() => startCamera(undefined));
    const onDeviceChange = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', onDeviceChange);
      stopCamera();
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [refreshDevices, startCamera, stopCamera]);

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    startCamera(id);
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      showToast('Camera not ready yet.');
      return;
    }
    setSweepKey((k) => k + 1);

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
    const detected = autoDetectQuad(raw);
    setQuad(detected);
    setMode('editing');

    const shutter = new Audio();
    shutter.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YaQAAAAA';
    shutter.play().catch(() => {});
  };

  const getQuadArea = (quad: Record<CornerKey, { x: number; y: number }>) => {
    const { tl, tr, br, bl } = quad;
    return Math.abs(
      tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    );
  };

  const isPaperFullyVisible = (
    quad: Record<CornerKey, { x: number; y: number }>,
    width: number,
    height: number,
  ) => {
    const margin = 0.08;
    const area = getQuadArea(quad);
    const minArea = width * height * 0.22;
    const inBounds = Object.values(quad).every((pt) => pt.x > width * margin && pt.x < width * (1 - margin) && pt.y > height * margin && pt.y < height * (1 - margin));
    return inBounds && area >= minArea;
  };

  const processAutoCaptureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || mode !== 'camera' || !cameraReady) {
      autoCaptureLoopRef.current = requestAnimationFrame(processAutoCaptureFrame);
      return;
    }

    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? canvas.width : 0, 0);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const quadCandidate = autoDetectQuad(canvas);
    const isVisible = isPaperFullyVisible(quadCandidate, canvas.width, canvas.height);
    const changedStatus = () => {
      if (stabilityRef.current >= 8) {
        setAutoCaptureStatus('capturing');
      } else if (stabilityRef.current >= 4) {
        setAutoCaptureStatus('hold');
      } else {
        setAutoCaptureStatus('aligned');
      }
    };

    if (isVisible) {
      stabilityRef.current += 1;
      if (stabilityRef.current >= 10) {
        setAutoCaptureStatus('capturing');
        capture();
        stabilityRef.current = 0;
      } else {
        changedStatus();
      }
    } else {
      stabilityRef.current = 0;
      setAutoCaptureStatus('searching');
    }

    autoCaptureLoopRef.current = window.setTimeout(() => requestAnimationFrame(processAutoCaptureFrame), 120);
  }, [cameraReady, mirrored, mode]);

  useEffect(() => {
    if (mode === 'camera' && cameraReady) {
      if (autoCaptureLoopRef.current) {
        window.clearTimeout(autoCaptureLoopRef.current);
      }
      setAutoCaptureStatus('searching');
      stabilityRef.current = 0;
      autoCaptureLoopRef.current = window.setTimeout(() => requestAnimationFrame(processAutoCaptureFrame), 180);
      return () => {
        if (autoCaptureLoopRef.current) window.clearTimeout(autoCaptureLoopRef.current);
      };
    }
    return () => {
      if (autoCaptureLoopRef.current) window.clearTimeout(autoCaptureLoopRef.current);
    };
  }, [cameraReady, mode, processAutoCaptureFrame]);

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
    if (mode === 'editing') {
      fitAndDrawEditCanvas();
    }
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
    const toDisplay = (pt: { x: number; y: number }) => ({
      x: rect.left - vfRect.left + pt.x * sx,
      y: rect.top - vfRect.top + pt.y * sy,
    });
    const layout: Record<CornerKey, { x: number; y: number }> = {
      tl: toDisplay(quad.tl),
      tr: toDisplay(quad.tr),
      br: toDisplay(quad.br),
      bl: toDisplay(quad.bl),
    };
    setHandleLayout(layout);
  }, [quad]);

  useEffect(() => {
    recomputeHandleLayout();
  }, [recomputeHandleLayout, mode]);

  useEffect(() => {
    const onResize = () => {
      if (mode === 'editing') {
        fitAndDrawEditCanvas();
        recomputeHandleLayout();
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode, fitAndDrawEditCanvas, recomputeHandleLayout]);

  const onHandlePointerDown = (key: CornerKey) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragKeyRef.current = key;
    e.currentTarget.setPointerCapture(e.pointerId);
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
    setQuad((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: { x, y } };
    });
  };

  useEffect(() => {
    if (quad) recomputeHandleLayout();
  }, [quad, recomputeHandleLayout]);

  useEffect(() => {
    const onUp = () => {
      dragKeyRef.current = null;
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  const resetQuad = () => {
    if (capturedRef.current) setQuad(autoDetectQuad(capturedRef.current));
  };

  const retake = () => {
    setMode('camera');
    setQuad(null);
    capturedRef.current = null;
  };

  const confirmPage = async () => {
    if (!capturedRef.current || !quad) return;
    setProcessing('Flattening page…');
    await nextFrame();
    try {
      let { w, h } = quadWidthHeight(quad);
      const maxLong = 2000;
      const scale = Math.min(1, maxLong / Math.max(w, h));
      w = Math.max(40, Math.round(w * scale));
      h = Math.max(40, Math.round(h * scale));

      const warped = warpQuadToRect(capturedRef.current, quad, w, h);
      setProcessing('Applying filter…');
      await nextFrame();

      const wctx = warped.getContext('2d');
      if (!wctx) throw new Error('Canvas context unavailable');
      let imgData = wctx.getImageData(0, 0, w, h);
      imgData = applyFilter(imgData, filter);
      wctx.putImageData(imgData, 0, 0);

      const dataUrl = warped.toDataURL('image/jpeg', 0.92);
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `page-${Date.now()}`;
      setPages((prev) => [...prev, { id, dataUrl, filter }]);
      showToast('Page added and queued for AI review.');
      retake();
    } catch (err) {
      console.error(err);
      showToast('Could not process that page — try adjusting the corners.');
    } finally {
      setProcessing(null);
    }
  };

  const deletePage = (id: string) => setPages((prev) => prev.filter((p) => p.id !== id));
  const clearAll = () => {
    if (pages.length && window.confirm('Remove all scanned pages?')) setPages([]);
  };

  const dragIndexRef = useRef<number | null>(null);
  const onThumbDragStart = (idx: number) => () => {
    dragIndexRef.current = idx;
  };
  const onThumbDragOver = (idx: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === idx) return;
    setPages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      dragIndexRef.current = idx;
      return next;
    });
  };
  const onThumbDragEnd = () => {
    dragIndexRef.current = null;
  };

  const exportPdf = async () => {
    if (!pages.length) return;
    setProcessing('Building PDF…');
    await nextFrame();
    try {
      let pdf: jsPDF | null = null;
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const dims = await imageDims(pg.dataUrl);
        const orientation = dims.w > dims.h ? 'l' : 'p';
        const pageSizePt = orientation === 'l' ? [841.89, 595.28] : [595.28, 841.89];
        if (!pdf) {
          pdf = new jsPDF({ orientation, unit: 'pt', format: pageSizePt });
        } else {
          pdf.addPage(pageSizePt, orientation);
        }
        const margin = 24;
        const maxW = pageSizePt[0] - margin * 2;
        const maxH = pageSizePt[1] - margin * 2;
        const ratio = Math.min(maxW / dims.w, maxH / dims.h);
        const w = dims.w * ratio;
        const h = dims.h * ratio;
        const x = (pageSizePt[0] - w) / 2;
        const y = (pageSizePt[1] - h) / 2;
        pdf.addImage(pg.dataUrl, 'JPEG', x, y, w, h);
      }
      pdf.save(`scan-${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast('PDF downloaded.');
    } catch (err) {
      console.error(err);
      showToast('Export failed — see console for details.');
    } finally {
      setProcessing(null);
    }
  };

  const saveScans = () => {
    if (!pages.length) {
      showToast('No scanned pages to save.');
      return;
    }
    onSavePages(pages);
    setPages([]);
    onClose();
  };

  const quadPathD =
    quad && handleLayout
      ? `M ${handleLayout.tl.x} ${handleLayout.tl.y} L ${handleLayout.tr.x} ${handleLayout.tr.y} L ${handleLayout.br.x} ${handleLayout.br.y} L ${handleLayout.bl.x} ${handleLayout.bl.y} Z`
      : '';

  return (
    <div className="ds-app">
      <div className="ds-topbar">
        <div className="ds-brand">
          <div className="ds-mark">Bwenge<span>Scan</span></div>
          <div className="ds-tag">USB / Webcam Document Capture</div>
        </div>
        <div className="ds-device-wrap">
          <select className="ds-select" value={currentDeviceId} onChange={handleDeviceChange}>
            {devices.length === 0 && <option>No camera found</option>}
            {devices.map((d, i) => (
              <option key={d.deviceId || `${d.label}-${i}`} value={d.deviceId || ''}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
          <button className="ds-icon-btn" title="Mirror preview" onClick={() => setMirrored((m) => !m)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4" />
            </svg>
          </button>
          <button className="ds-icon-btn" title="Close scanner" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="ds-main">
        <div className="ds-stage-col">
          <div
            className={`ds-viewfinder ${mode === 'editing' ? 'editing' : ''}`}
            ref={viewfinderRef}
            onPointerMove={onViewfinderPointerMove}
            onClick={() => videoRef.current?.focus()}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              tabIndex={-1}
              style={{ transform: mirrored ? 'scaleX(-1)' : 'scaleX(1)', display: mode === 'editing' ? 'none' : 'block' }}
            />
            <canvas ref={editCanvasRef} className="ds-edit-canvas" style={{ display: mode === 'editing' ? 'block' : 'none' }} />

            {mode === 'editing' && quad && handleLayout && (
              <svg className="ds-quad-lines">
                <path d={quadPathD} fill="rgba(232,163,61,0.12)" stroke="var(--ds-accent)" strokeWidth="2" />
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

            <div className="ds-readout">
              <span className={`ds-dot ${autoCaptureStatus}`} />
              {cameraReady
                ? autoCaptureStatus === 'searching'
                  ? `ALIGN PAPER · ${pages.length} PAGE${pages.length === 1 ? '' : 'S'}`
                  : autoCaptureStatus === 'aligned'
                  ? `HOLD STILL · ${pages.length} PAGE${pages.length === 1 ? '' : 'S'}`
                  : autoCaptureStatus === 'hold'
                  ? `CAPTURE READY · ${pages.length} PAGE${pages.length === 1 ? '' : 'S'}`
                  : `CAPTURING · ${pages.length} PAGE${pages.length === 1 ? '' : 'S'}`
                : 'LOOKING FOR SOURCE'}
            </div>

            <div key={sweepKey} className="ds-sweep" />

            {!cameraReady && (
              <div className="ds-empty show">
                <h2>No camera yet</h2>
                <p>
                  Grant camera access to start. On desktop you can use your laptop webcam, a USB webcam, or a phone camera bridge app —
                  the browser will treat it like any other video source.
                </p>
                <button className="ds-btn primary" onClick={() => startCamera(currentDeviceId)}>
                  Enable camera
                </button>
              </div>
            )}

            {processing && (
              <div className="ds-veil show">
                <div className="ds-spinner" />
                <div className="ds-veil-msg">{processing}</div>
              </div>
            )}
          </div>

          <div className="ds-controls">
            {mode === 'camera' && (
              <button className="ds-shutter" onClick={capture} title="Capture page">
                <div className="ds-shutter-inner" />
              </button>
            )}

            {mode === 'editing' && (
              <div className="ds-edit-controls">
                <div className="ds-filter-row">
                  {['color', 'gray', 'bw'].map((f) => (
                    <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f as 'color' | 'gray' | 'bw')}>
                      {f === 'bw' ? 'B&W' : f === 'gray' ? 'Gray' : 'Color'}
                    </button>
                  ))}
                </div>
                <button className="ds-btn ghost" onClick={resetQuad}>
                  Reset corners
                </button>
                <button className="ds-btn ghost" onClick={retake}>
                  Retake
                </button>
                <button className="ds-btn primary" onClick={confirmPage}>
                  Add page
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ds-rail">
          <div className="ds-rail-header">
            <span className="label">Pages</span>
            <span className="count">{pages.length}</span>
          </div>
          <div className="ds-page-list">
            {pages.map((pg, idx) => (
              <div
                key={pg.id}
                className="ds-page-thumb"
                draggable
                onDragStart={onThumbDragStart(idx)}
                onDragOver={onThumbDragOver(idx)}
                onDragEnd={onThumbDragEnd}
              >
                <span className="num">{idx + 1}</span>
                <button className="del" title="Delete page" onClick={() => deletePage(pg.id)}>
                  ✕
                </button>
                <img src={pg.dataUrl} alt={`Page ${idx + 1}`} />
              </div>
            ))}
          </div>
          <div className="ds-export-row">
            <button className="ds-btn ghost" disabled={!pages.length} onClick={clearAll}>
              Clear
            </button>
            <button className="ds-btn ghost" disabled={!pages.length} onClick={exportPdf}>
              Export PDF
            </button>
            <button className="ds-btn primary" disabled={!pages.length} onClick={saveScans}>
              Save scans
            </button>
          </div>
        </div>
      </div>

      {toastMsg && <div className="ds-toast show">{toastMsg}</div>}
    </div>
  );
}
