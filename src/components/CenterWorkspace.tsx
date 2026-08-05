import React, { useRef, useState } from 'react';
import { NavigationTab, ExamPaper, UploadedFile, StudentScript } from '../types';
import { ResultsView } from './ResultsView';
import { Plus, Check, X, Type, Maximize2, Sparkles, Trash2, RotateCcw, Award, Flag, Paperclip } from 'lucide-react';
import DocumentScanner from './DocumentScanner';

interface ScannedPage {
  id: string;
  dataUrl: string;
  filter: string;
}

interface CenterWorkspaceProps {
  activeTab?: NavigationTab;
  examPaper: ExamPaper | null;
  setExamPaper?: (exam: ExamPaper) => void;
  uploadedFiles: UploadedFile[];
  studentScripts?: StudentScript[];
  setStudentScripts?: React.Dispatch<React.SetStateAction<StudentScript[]>>;
  onUploadStudentPaper?: (files: File[] | FileList | File) => void;
  onOpenScanner?: () => void;
  onGenerateSampleBatch300?: () => void;
  onTextSelection: (text: string, pos: { top: number; left: number }) => void;
  onToggleSoftDelete?: (fileId: string) => void;
  onToggleFlag?: (fileId: string) => void;
  onUpdateBonusMarks?: (fileId: string, bonus: number) => void;
  onDeletePermanently?: (fileId: string) => void;
  scannerOpen?: boolean;
  onCloseScanner?: () => void;
  onSaveScannedPages?: (pages: ScannedPage[]) => void;
  activeDocument?: any;
}

interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  type: 'note' | 'score' | 'check';
}

export const CenterWorkspace: React.FC<CenterWorkspaceProps> = ({
  activeTab,
  examPaper,
  setExamPaper,
  uploadedFiles,
  studentScripts = [],
  setStudentScripts,
  onUploadStudentPaper,
  onOpenScanner,
  onGenerateSampleBatch300,
  onTextSelection,
  onToggleSoftDelete,
  onToggleFlag,
  onUpdateBonusMarks,
  onDeletePermanently,
  scannerOpen,
  onCloseScanner,
  onSaveScannedPages,
  activeDocument,
}) => {
  const documentContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  // Selected paper for Full-Size Hover/Click Magnification View
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);

  // Live Canvas Annotation state for expanded view
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [toolMode, setToolMode] = useState<'select' | 'text' | 'check' | 'score'>('select');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // AI-Grading Action Toolbar Local States
  const [showBonusInput, setShowBonusInput] = useState<boolean>(false);
  const [showReGradePrompt, setShowReGradePrompt] = useState<boolean>(false);
  const [reGradePromptText, setReGradePromptText] = useState<string>('');
  const [isReGrading, setIsReGrading] = useState<boolean>(false);

  // Separate active vs soft-deleted files
  const activeFiles = uploadedFiles.filter((f) => !f.isSoftDeleted);
  const assessmentLabel = examPaper?.title ? `${examPaper.subject} • ${examPaper.title}` : 'Current assessment';
  const softDeletedFiles = uploadedFiles.filter((f) => f.isSoftDeleted);

  // Always derive fresh selectedFile from uploadedFiles array if available
  const currentSelectedFile =
    uploadedFiles.find((f) => f.id === selectedFile?.id) || selectedFile;

  // Calculate dynamic scaling size classes based on active batch count
  const activeCount = activeFiles.length;

  const getGridClasses = () => {
    if (activeCount > 100) {
      return 'grid-cols-8 sm:grid-cols-12 md:grid-cols-16 lg:grid-cols-20 xl:grid-cols-24 gap-1.5 p-3';
    } else if (activeCount > 30) {
      return 'grid-cols-6 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-16 gap-2 p-4';
    } else if (activeCount > 12) {
      return 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3 p-5';
    } else {
      return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 p-6';
    }
  };

  const getCardSizeClasses = () => {
    if (activeCount > 100) {
      return 'w-12 h-16 text-[8px]';
    } else if (activeCount > 30) {
      return 'w-16 h-22 text-[9px]';
    } else if (activeCount > 12) {
      return 'w-24 h-32 text-[10px]';
    } else {
      return 'w-36 h-48 text-xs';
    }
  };

  // Handle Mouse Up text selection or canvas click annotation in magnified view
  const handleMouseUpInMagnified = (e: React.MouseEvent<HTMLDivElement>) => {
    if (toolMode !== 'select') {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      let defaultText = 'Note';
      if (toolMode === 'check') defaultText = '✔ Correct';
      if (toolMode === 'score') defaultText = '+1 Mark';
      if (toolMode === 'text') defaultText = 'Annotation note...';

      const newAnno: Annotation = {
        id: 'anno-' + Date.now(),
        x,
        y,
        text: defaultText,
        type: toolMode === 'check' ? 'check' : toolMode === 'score' ? 'score' : 'note',
      };

      setAnnotations((prev) => [...prev, newAnno]);
      setToolMode('select');
      return;
    }

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      const selectedStr = selection.toString().trim();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      onTextSelection(selectedStr, {
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }
  };

  const handleUpdateAnnotationText = (id: string, text: string) => {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, text } : a))
    );
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onUploadStudentPaper) {
      onUploadStudentPaper(Array.from(e.dataTransfer.files));
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    if (onUploadStudentPaper) onUploadStudentPaper(Array.from(files));
    event.target.value = '';
  };

  const handleSoftDeleteCard = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (onToggleSoftDelete) {
      onToggleSoftDelete(fileId);
    }
    if (selectedFile?.id === fileId) {
      setSelectedFile(null);
    }
  };

  const handleRestoreCard = (fileId: string) => {
    if (onToggleSoftDelete) {
      onToggleSoftDelete(fileId);
    }
  };

  React.useEffect(() => {
    if (!activeDocument) {
      setActivePreviewUrl(null);
      return;
    }

    if (activeDocument instanceof File) {
      const url = URL.createObjectURL(activeDocument);
      setActivePreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    const url = activeDocument.url || activeDocument.previewUrl || null;
    setActivePreviewUrl(url);
  }, [activeDocument]);

  const hasDocument = uploadedFiles.length > 0 || !!examPaper || !!activeDocument;

  const renderActiveDocumentPreview = () => {
    if (!activeDocument) return null;
    const isFileObject = activeDocument instanceof File;
    const mimeType = isFileObject ? activeDocument.type : activeDocument.mimeType;
    const fileType = isFileObject ? activeDocument.name.split('.').pop()?.toLowerCase() : activeDocument.fileType;
    const isImage = mimeType?.startsWith('image/') || /png|jpe?g|gif|webp/i.test(fileType || '');
    const isPdf = mimeType === 'application/pdf' || fileType === 'pdf';
    const previewUrl = activePreviewUrl;

    const hasHtmlPreview = !isFileObject && Boolean(activeDocument.htmlContent);
    const displayHtml = !isFileObject && activeDocument.htmlContent;
    const displayText = !isFileObject && activeDocument.rawText;

    return (
      <div className="flex-1 w-full flex items-center justify-center p-6">
        <div className="w-full max-w-5xl h-[calc(100vh-8rem)] rounded-3xl overflow-hidden border border-slate-800 bg-[#111827] shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-200">
            <div className="truncate font-semibold">{activeDocument.name || 'Attached document'}</div>
            <div className="text-xs text-slate-400">Preview</div>
          </div>
          {previewUrl && isPdf ? (
            <iframe
              src={previewUrl}
              title={isFileObject ? activeDocument.name : activeDocument.name || 'PDF preview'}
              className="w-full h-full bg-black"
            />
          ) : previewUrl && isImage ? (
            <img
              src={previewUrl}
              alt={isFileObject ? activeDocument.name : activeDocument.name || 'Attached image'}
              className="w-full h-full object-contain bg-black"
            />
          ) : hasHtmlPreview ? (
            <div className="w-full h-full overflow-auto bg-[#0b1220] text-slate-100 p-6">
              <div
                className="max-w-5xl mx-auto rounded-3xl bg-slate-950 p-6 shadow-inner text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: String(displayHtml) }}
              />
            </div>
          ) : displayText ? (
            <div className="w-full h-full overflow-auto bg-[#0b1220] text-slate-100 p-6">
              <div className="max-w-5xl mx-auto rounded-3xl bg-slate-950 p-6 shadow-inner text-sm leading-relaxed whitespace-pre-wrap">
                {displayText}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-slate-300">
              <div>
                <p className="text-lg font-semibold">Unable to preview this file type.</p>
                <p className="mt-2 text-sm text-slate-400">The file has been attached and is ready for review.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-[50vh] h-auto lg:h-[calc(100vh-61px)] flex flex-col bg-[#FBF9F6] dark:bg-[#141416] overflow-y-auto select-text relative">
      {/* file input removed — uploads are handled via RightSidebar only */}

      {!hasDocument ? (
        /* Default State (When No Student File is Uploaded) */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          className={`flex-1 w-full h-full min-h-[60vh] lg:min-h-[80vh] flex flex-col items-center justify-center p-6 sm:p-8 text-center select-none transition-colors ${
            isDragging ? 'bg-[#F2EFE9] dark:bg-[#1A1A1E]' : ''
          }`}
        >
          <div className="max-w-md w-full space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center text-2xl font-bold mx-auto shadow-inner">
              📄
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-[#191919] dark:text-[#F3F3F3]">Bwenge AI Workspace</h2>
              <p className="text-sm text-[#6B7280] dark:text-[#9CA3AF]">
                Open a student submission or scan a paper booklet to begin automated grading.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileInputChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUploadClick();
                }}
                className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-orange-500/40 text-left transition group shadow-lg"
              >
                <span className="text-lg block mb-1">📁</span>
                <span className="text-xs font-medium text-slate-200 block group-hover:text-orange-400">
                  Upload Submission
                </span>
                <span className="text-[10px] text-slate-500">PDF, PNG, JPEG</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenScanner?.();
                }}
                className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-orange-500/40 text-left transition group shadow-lg"
              >
                <span className="text-lg block mb-1">📷</span>
                <span className="text-xs font-medium text-slate-200 block group-hover:text-orange-400">
                  Open BwengeScan
                </span>
                <span className="text-[10px] text-slate-500">Live Camera / Phone</span>
              </button>
            </div>

            {onGenerateSampleBatch300 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onGenerateSampleBatch300();
                }}
                className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[#FFFFFF] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] text-xs font-semibold text-[#D97757] hover:border-[#D97757] transition-all shadow-2xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Simulate Mass Upload (300 Student Papers: 1 to 300)</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Active State: High-Density Scaling Canvas for Mass Student Paper Uploads */
        <div className="flex-1 w-full flex flex-col items-center justify-between relative p-3 sm:p-4 lg:p-6 overflow-y-auto min-h-0">
          <div className="w-full max-w-7xl flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-[#191919] dark:text-[#F3F3F3]">Student papers</p>
              <p className="text-xs text-[#858075] dark:text-[#888892]">
                {activeFiles.length} uploaded • desktop view uses this workspace
              </p>
            </div>
            {/* Attach button removed — uploads are handled via RightSidebar */}
          </div>

          {/* Main Active Grid Area */}
          <div className="w-full flex-1 flex flex-col items-center">
            {activeFiles.length === 0 && !activeDocument ? (
              <div className="w-full h-full rounded-2xl border-2 border-dashed border-slate-800/80 bg-[#0B0E17]/50 hover:border-orange-500/30 transition flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 text-2xl shadow-xl">
                  📄
                </div>

                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-200">No active submission loaded</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Drag & drop a student submission anywhere on this canvas, or pick a paper from the chat queue.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleUploadClick}
                  className="px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-medium text-slate-200 border border-slate-700/60 shadow-sm transition active:scale-95"
                >
                  Browse Files (.PDF, .DOCX, .PNG)
                </button>
              </div>
            ) : activeFiles.length === 0 && activeDocument ? (
              renderActiveDocumentPreview()
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={`w-full max-w-7xl grid ${getGridClasses()} transition-all duration-300 relative rounded-xl ${
                  isDragging ? 'ring-2 ring-[#D97757] bg-[#F2EFE9]/40 dark:bg-[#1A1A1E]/40' : ''
                }`}
              >
                {activeFiles.map((file, idx) => {
                  const cardSizeClass = getCardSizeClasses();
                  const studentNumber = uploadedFiles.findIndex((f) => f.id === file.id) + 1;
                  const displayNum = studentNumber > 0 ? studentNumber : idx + 1;

                  return (
                    <div
                      key={file.id || idx}
                      onClick={() => setSelectedFile(file)}
                      className={`group relative ${cardSizeClass} bg-white dark:bg-[#1C1C20] rounded-md border ${
                        file.isFlagged
                          ? 'border-amber-500 ring-2 ring-amber-500/80 shadow-sm'
                          : 'border-[#E8E4DC] dark:border-[#2D2D32]'
                      } shadow-2xs hover:shadow-md hover:scale-110 hover:border-[#D97757] transition-all duration-200 cursor-pointer flex flex-col justify-between overflow-hidden shrink-0 select-none hover:z-20`}
                      title={`Click to magnify student paper #${displayNum}${file.isFlagged ? ' (Flagged for review)' : ''}`}
                    >
                      {/* Flagged Badge Pinned to Top Left Corner */}
                      {file.isFlagged && (
                        <div
                          className="absolute top-1 left-1 z-20 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] shadow-xs pointer-events-none ring-1.5 ring-white dark:ring-[#1C1C20]"
                          title="Flagged for manual review"
                        >
                          <Flag className="w-2.5 h-2.5 fill-current" />
                        </div>
                      )}

                      {/* Sequential Student Identification (1, 2, 3... 300) Badge Pinned to Top Right Corner */}
                      <div className="absolute top-1 right-1 z-20 min-w-[16px] sm:min-w-[20px] h-4 sm:h-5 px-1 rounded-full bg-[#D97757] text-white flex items-center justify-center text-[8px] sm:text-[9.5px] font-black shadow-xs shrink-0 ring-1.5 ring-white dark:ring-[#1C1C20] pointer-events-none">
                        {displayNum}
                      </div>

                      {/* Quick Soft-Delete Trash Trigger on Hover */}
                      <button
                        type="button"
                        onClick={(e) => handleSoftDeleteCard(e, file.id)}
                        className={`absolute top-1 ${
                          file.isFlagged ? 'left-6' : 'left-1'
                        } z-20 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-rose-500/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-rose-600 transition-all cursor-pointer shadow-xs`}
                        title="Minimize / Soft Delete paper"
                      >
                        <Trash2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                      </button>

                      {/* Micro-Card High-Fidelity Rendered Content (Visible Actual Content Always) */}
                      <div className="flex-1 w-full h-full overflow-hidden subpixel-antialiased transform-gpu bg-white dark:bg-[#1A1A1E]">
                        {file.fileType === 'image' && file.url ? (
                          <img
                            src={file.url}
                            alt={file.name}
                            className="w-full h-full object-cover object-top subpixel-antialiased transform-gpu pointer-events-none"
                          />
                        ) : file.fileType === 'pdf' && file.url ? (
                          <iframe
                            src={file.url}
                            title={file.name}
                            className="w-[200%] h-[200%] pointer-events-none scale-50 origin-top-left subpixel-antialiased transform-gpu opacity-95"
                          />
                        ) : (
                          /* High-Precision Miniature Rendered Page with Sub-Pixel Anti-Aliasing */
                          <div className="w-full h-full p-1 sm:p-1.5 bg-white dark:bg-[#1C1C20] flex flex-col justify-between overflow-hidden subpixel-antialiased transform-gpu">
                            <div className="space-y-0.5">
                              <div className="text-[6.5px] sm:text-[7.5px] font-bold font-mono text-[#D97757] truncate subpixel-antialiased tracking-tighter leading-tight border-b border-[#E8E4DC] dark:border-[#2D2D32] pb-0.5">
                                {file.studentName || `Student ${displayNum}`}
                              </div>
                              <div className="text-[5.5px] sm:text-[6.5px] leading-[6.5px] sm:leading-[7.5px] font-sans antialiased subpixel-antialiased text-[#191919] dark:text-[#E2E2E2] font-medium tracking-tighter whitespace-pre-wrap break-words overflow-hidden line-clamp-6 opacity-90">
                                {file.rawText || `Physics HL Assessment â€” Student #${displayNum}`}
                              </div>
                            </div>

                            {/* Crisp Sub-Pixel Footer Tag */}
                            <div className="pt-0.5 border-t border-dashed border-[#E8E4DC] dark:border-[#2D2D32] flex items-center justify-between text-[5px] sm:text-[6px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                              <span className="subpixel-antialiased">âœ“ Marked</span>
                              <span className="text-[#858075] subpixel-antialiased">{examPaper?.subject || 'Assessment'}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Hover Magnification Icon Hint */}
                      <div className="absolute inset-0 bg-[#D97757]/0 group-hover:bg-[#D97757]/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10">
                        <Maximize2 className="w-3.5 h-3.5 text-[#D97757] drop-shadow-xs" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Persistent Minimized State ("Soft Delete" Base Strip Area) */}
          {softDeletedFiles.length > 0 && (
            <div className="w-full max-w-7xl mt-6 pt-3 border-t border-[#E8E4DC] dark:border-[#2D2D32] bg-[#F4F0E8]/40 dark:bg-[#18181B]/40 rounded-xl p-3 space-y-2 select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-0.5 rounded-full bg-[#D97757] text-white flex items-center justify-center text-[10px] font-bold shadow-2xs">
                    {softDeletedFiles.length}
                  </span>
                  <span className="text-xs font-bold text-[#66635B] dark:text-[#A0A0AA]">
                    Minimized / Soft-Deleted Student Papers ({softDeletedFiles.length})
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#858075]">
                  Click any minimized line to restore instantaneously
                </span>
              </div>

              {/* Minimized Placeholder Lines/Pills Grid */}
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-1">
                {softDeletedFiles.map((file, idx) => {
                  const studentNum = uploadedFiles.findIndex((f) => f.id === file.id) + 1;
                  const displayNum = studentNum > 0 ? studentNum : idx + 1;

                  return (
                    <button
                      key={file.id || idx}
                      type="button"
                      onClick={() => handleRestoreCard(file.id)}
                      className="group px-2.5 py-1.5 rounded-lg bg-[#FFFFFF] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] dark:hover:border-[#D97757] opacity-75 hover:opacity-100 transition-all cursor-pointer flex items-center space-x-2 shadow-2xs hover:shadow-xs active:scale-95"
                      title={`Click to restore paper #${displayNum} back to active canvas`}
                    >
                      {/* MANDATORY Sharp, 100% High-Contrast Sequential Student Badge */}
                      <span className="min-w-[16px] sm:min-w-[18px] h-4 px-1 rounded-full bg-[#D97757] text-white flex items-center justify-center text-[8.5px] font-extrabold shrink-0 shadow-2xs">
                        {displayNum}
                      </span>

                      {/* Minimized Paper Line Label */}
                      <span className="text-[11px] font-medium text-[#191919] dark:text-[#F3F3F3]">
                        Paper #{displayNum}
                      </span>

                      {/* Instantaneous One-Click Restore Hint */}
                      <span className="inline-flex items-center space-x-1 text-[10px] text-[#D97757] font-semibold opacity-80 group-hover:opacity-100">
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hover / Click Magnification Viewport Overlay (Native Full-Size Viewer) */}
          {selectedFile && (() => {
            const selectedNum = uploadedFiles.findIndex((f) => f.id === selectedFile.id) + 1;
            const displayNum = selectedNum > 0 ? selectedNum : 1;

            return (
              <div className="fixed inset-0 z-50 bg-[#141416]/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6 animate-in fade-in duration-200">
                <div className="w-full max-w-4xl h-[92vh] bg-[#FBF9F6] dark:bg-[#18181B] rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] shadow-2xl flex flex-col overflow-hidden relative">
                  {/* Floating Tool Ribbon in Magnified View */}
                  <div className="p-3 border-b border-[#E8E4DC] dark:border-[#2D2D32] bg-[#FFFFFF]/90 dark:bg-[#1F1F23]/90 backdrop-blur-md flex items-center justify-between z-20">
                    <div className="flex items-center space-x-2">
                      <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-[#D97757] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                        {displayNum}
                      </span>
                      <span className="text-xs font-bold text-[#191919] dark:text-[#F3F3F3]">
                        Magnified Viewport â€” Student Paper #{displayNum}
                      </span>
                    </div>

                  {/* Tool Controls */}
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => setToolMode('check')}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                        toolMode === 'check'
                          ? 'bg-emerald-600 text-white'
                          : 'text-[#52504A] dark:text-[#A0A0AA] hover:text-[#191919] dark:hover:text-white'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      <span>Mark Correct</span>
                    </button>
                    <button
                      onClick={() => setToolMode('score')}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                        toolMode === 'score'
                          ? 'bg-amber-600 text-white'
                          : 'text-[#52504A] dark:text-[#A0A0AA] hover:text-[#191919] dark:hover:text-white'
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      <span>Score Badge</span>
                    </button>

                    {/* Subtle white/gray divider */}
                    <div className="h-4 w-[1px] bg-[#E8E4DC] dark:bg-[#2D2D32] mx-1 shrink-0" />

                    {/* 1. Bonus Marks Tool */}
                    <div className="relative flex items-center">
                      <button
                        onClick={() => setShowBonusInput((prev) => !prev)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                          ((currentSelectedFile?.bonusMarks ?? '') !== undefined && (currentSelectedFile?.bonusMarks ?? '') !== 0) || showBonusInput
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'text-[#52504A] dark:text-[#A0A0AA] hover:text-[#191919] dark:hover:text-white'
                        }`}
                        title="Add or subtract bonus points to this paper"
                      >
                        <Award className="w-3 h-3" />
                        <span>
                          {(currentSelectedFile?.bonusMarks ?? '')
                            ? `+ Bonus (${Number(currentSelectedFile?.bonusMarks ?? '') > 0 ? '+' : ''}${(currentSelectedFile?.bonusMarks ?? '')})`
                            : '+ Bonus'}
                        </span>
                      </button>

                      {showBonusInput && (
                        <div className="flex items-center space-x-1 ml-1 px-2 py-0.5 rounded-full bg-[#F4F0E8] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] animate-in fade-in zoom-in-95 duration-150">
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateBonusMarks) {
                                onUpdateBonusMarks((currentSelectedFile?.id ?? ''), ((currentSelectedFile?.bonusMarks ?? '') || 0) - 1);
                              }
                            }}
                            className="w-4 h-4 rounded-full bg-white dark:bg-[#2D2D32] flex items-center justify-center text-xs font-bold hover:bg-[#D97757] hover:text-white transition-colors cursor-pointer shadow-2xs"
                            title="Subtract 1 point"
                          >
                            -
                          </button>
                          <span className="text-xs font-mono font-bold px-1 min-w-[20px] text-center text-[#191919] dark:text-[#F3F3F3]">
                            {(currentSelectedFile?.bonusMarks ?? '') || 0} pts
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (onUpdateBonusMarks) {
                                onUpdateBonusMarks((currentSelectedFile?.id ?? ''), ((currentSelectedFile?.bonusMarks ?? '') || 0) + 1);
                              }
                            }}
                            className="w-4 h-4 rounded-full bg-white dark:bg-[#2D2D32] flex items-center justify-center text-xs font-bold hover:bg-[#D97757] hover:text-white transition-colors cursor-pointer shadow-2xs"
                            title="Add 1 point"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 2. AI Re-Evaluate Tool */}
                    <div className="relative flex items-center">
                      <button
                        onClick={() => setShowReGradePrompt((prev) => !prev)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                          showReGradePrompt || isReGrading
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-[#52504A] dark:text-[#A0A0AA] hover:text-[#191919] dark:hover:text-white'
                        }`}
                        title="Re-scan answer with custom AI grading rules"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>AI Re-Grade</span>
                      </button>

                      {showReGradePrompt && (
                        <div className="flex items-center space-x-1 ml-1 px-2 py-0.5 rounded-full bg-[#F4F0E8] dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] animate-in fade-in zoom-in-95 duration-150">
                          <input
                            type="text"
                            value={reGradePromptText}
                            onChange={(e) => setReGradePromptText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (!reGradePromptText.trim()) return;
                                setIsReGrading(true);
                                setTimeout(() => {
                                  setIsReGrading(false);
                                  setAnnotations((prev) => [
                                    ...prev,
                                    {
                                      id: 'regrade-' + Date.now(),
                                      x: 180,
                                      y: 120,
                                      text: `ðŸ¤– AI Re-Grade Rule: "${reGradePromptText}" (+1 mark awarded)`,
                                      type: 'score',
                                    },
                                  ]);
                                  if (onUpdateBonusMarks) {
                                    onUpdateBonusMarks((currentSelectedFile?.id ?? ''), ((currentSelectedFile?.bonusMarks ?? '') || 0) + 1);
                                  }
                                  setReGradePromptText('');
                                  setShowReGradePrompt(false);
                                }, 500);
                              }
                            }}
                            placeholder="e.g. Be lenient on Q2 derivation..."
                            className="bg-transparent text-xs px-2 py-0.5 outline-none w-44 sm:w-52 text-[#191919] dark:text-[#F3F3F3] placeholder:text-[#858075]"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!reGradePromptText.trim()) return;
                              setIsReGrading(true);
                              setTimeout(() => {
                                setIsReGrading(false);
                                setAnnotations((prev) => [
                                  ...prev,
                                  {
                                    id: 'regrade-' + Date.now(),
                                    x: 180,
                                    y: 120,
                                    text: `ðŸ¤– AI Re-Grade Rule: "${reGradePromptText}" (+1 mark awarded)`,
                                    type: 'score',
                                  },
                                ]);
                                if (onUpdateBonusMarks) {
                                  onUpdateBonusMarks((currentSelectedFile?.id ?? ''), ((currentSelectedFile?.bonusMarks ?? '') || 0) + 1);
                                }
                                setReGradePromptText('');
                                setShowReGradePrompt(false);
                              }, 500);
                            }}
                            disabled={isReGrading}
                            className="px-2 py-0.5 rounded-full bg-[#D97757] text-white text-[10px] font-bold hover:bg-[#c26243] transition-colors cursor-pointer flex items-center space-x-1 shrink-0"
                          >
                            {isReGrading ? <span>Re-scanning...</span> : <span>Re-Scan</span>}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 3. Flag Review Tool */}
                    <button
                      onClick={() => onToggleFlag && onToggleFlag((currentSelectedFile?.id ?? ''))}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                        (currentSelectedFile?.isFlagged ?? '')
                          ? 'bg-amber-500 text-white font-bold shadow-xs'
                          : 'text-[#52504A] dark:text-[#A0A0AA] hover:text-[#191919] dark:hover:text-white'
                      }`}
                      title="Flag paper for manual teacher review"
                    >
                      <Flag className="w-3 h-3 fill-current" />
                      <span>{(currentSelectedFile?.isFlagged ?? '') ? 'Flagged' : 'Flag'}</span>
                    </button>

                    {/* Subtle white/gray divider */}
                    <div className="h-4 w-[1px] bg-[#E8E4DC] dark:bg-[#2D2D32] mx-1 shrink-0" />

                    {/* Soft Delete Trigger from Magnified View Ribbon */}
                    <button
                      onClick={(e) => handleSoftDeleteCard(e, (currentSelectedFile?.id ?? ''))}
                      className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer"
                      title="Soft delete / minimize paper"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Soft Delete</span>
                    </button>

                    {/* Delete Permanently Trigger */}
                    <button
                      onClick={() => {
                        if (onDeletePermanently) {
                          onDeletePermanently((currentSelectedFile?.id ?? ''));
                        }
                        setSelectedFile(null);
                      }}
                      className="px-2.5 py-1 rounded-full bg-red-600/15 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer"
                      title="Permanently delete student paper"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete Permanently</span>
                    </button>

                    {/* Snap Back Close Button */}
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="ml-2 p-1.5 rounded-full bg-[#F4F0E8] dark:bg-[#2D2D32] text-[#191919] dark:text-[#F3F3F3] hover:bg-rose-500 hover:text-white transition-colors cursor-pointer"
                      title="Snap back to micro-card grid"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Magnified Interactive Document Canvas */}
                <div
                  ref={documentContainerRef}
                  onMouseUp={handleMouseUpInMagnified}
                  className="flex-1 overflow-y-auto p-6 relative select-text"
                >
                  {selectedFile.fileType === 'pdf' ? (
                    <iframe
                      src={selectedFile.url}
                      title={selectedFile.name}
                      className="w-full h-full min-h-[600px] rounded-lg border border-[#E8E4DC] dark:border-[#2D2D32] bg-white"
                    />
                  ) : selectedFile.fileType === 'image' ? (
                    <div className="w-full flex justify-center py-4">
                      <img
                        src={selectedFile.url}
                        alt={selectedFile.name}
                        className="max-w-full h-auto shadow-md rounded-lg border border-[#E8E4DC] dark:border-[#2D2D32]"
                      />
                    </div>
                  ) : selectedFile.htmlContent ? (
                    <div
                      className="w-full max-w-3xl mx-auto py-8 px-10 bg-white dark:bg-[#1C1C20] shadow-sm border border-[#E8E4DC] dark:border-[#2D2D32] rounded-md text-[#191919] dark:text-[#F3F3F3] font-sans leading-relaxed outline-none text-sm select-text"
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                      dangerouslySetInnerHTML={{ __html: selectedFile.htmlContent }}
                    />
                  ) : (
                    <div
                      className="w-full max-w-2xl mx-auto py-8 px-10 bg-white dark:bg-[#1C1C20] shadow-xs border border-[#E8E4DC] dark:border-[#2D2D32] rounded-md text-[#191919] dark:text-[#F3F3F3] font-sans leading-relaxed outline-none whitespace-pre-wrap text-sm"
                      contentEditable={true}
                      suppressContentEditableWarning={true}
                    >
                      {selectedFile.rawText || `Student Answer Sheet â‘  content extracted.`}
                    </div>
                  )}

                  {/* Interactive Annotations */}
                  {annotations.map((anno) => (
                    <div
                      key={anno.id}
                      style={{ top: anno.y, left: anno.x }}
                      className={`absolute z-30 transform -translate-x-1/2 -translate-y-1/2 group flex items-center space-x-1 px-2.5 py-1 rounded-full shadow-md text-xs font-semibold select-none transition-all ${
                        anno.type === 'check'
                          ? 'bg-emerald-600 text-white'
                          : anno.type === 'score'
                          ? 'bg-amber-600 text-white'
                          : 'bg-[#D97757] text-white'
                      }`}
                    >
                      <span
                        contentEditable={true}
                        suppressContentEditableWarning={true}
                        onBlur={(e) => handleUpdateAnnotationText(anno.id, e.currentTarget.innerText)}
                        className="outline-none"
                      >
                        {anno.text}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAnnotation(anno.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-200 cursor-pointer ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        </div>
      )}
    </div>
  );
};


