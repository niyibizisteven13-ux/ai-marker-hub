import React, { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
import {
  NavigationTab,
  HighlightColor,
  DocumentHighlight,
  StudyDeck,
  Flashcard,
  AICard,
  HardwarePenState,
  ExamPaper,
  StudentScript,
  UploadedFile,
  ChatAttachment,
  Message,
  ChatSession,
  User,
  StudentAnswerInput,
  ResponseFeedbackDetails,
} from './types';
import {
  SAMPLE_EXAMS,
  INITIAL_HIGHLIGHTS,
  INITIAL_DECKS,
  INITIAL_FLASHCARDS,
  INITIAL_AI_CARDS,
  INITIAL_PEN_STATE,
} from './data/sampleExams';
import { TopNavbar } from './components/TopNavbar';
import { LeftSidebar } from './components/LeftSidebar';
import { CenterWorkspace } from './components/CenterWorkspace';
import { registerScannedPapers } from './services/scannedPapers';
import type { ScanBatch, MarkingContext } from './components/ScanMarkWorkspace';
import UpgradeSheet from './components/UpgradeSheet';
import RightChatSidebar from './components/RightChatSidebar';
import { SidebarResultsPanel } from './components/SidebarResultsPanel';
import { FloatingSmartToolbar } from './components/FloatingSmartToolbar';
import { HardwareToast } from './components/HardwareToast';
import { authFetch } from './utils/authFetch';
import { copyToClipboard } from './utils/copyToClipboard';
import { buildExamPaperContext } from './utils/contentAwarePrompt';
import { classifyIntent, localGreetingReply } from './utils/messageIntent';
import CreateStudio from './components/CreateStudio';
import { BwengeLoader } from './components/BwengeLoader';
import { MobileSheet } from './components/MobileSheet';
import { useIsMobile } from './hooks/useIsMobile';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight';
import { Menu, X, Plus, Sparkles } from 'lucide-react';
import LandingPage from './pages/LandingPage';
import { authService } from './auth/authService';
import { submitResponseFeedback } from './api/feedback';
import { applyStatusEvent, applyToolEvent } from './utils/toolSteps';
import type { Step } from './components/ActivityLine';

const AI_SCAN_ENABLED = import.meta.env.VITE_ENABLE_AI_SCAN !== 'false';
/** A page loaded only when it is opened, with a quiet placeholder while it arrives. */
function lazyPage<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>) {
  const Inner = React.lazy(load);
  return function LazyPage(props: P) {
    return <Suspense fallback={<div className="min-h-[100dvh] bg-[#141413]" aria-busy="true" />}><Inner {...(props as any)} /></Suspense>;
  };
}
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'));
const UpgradePage = lazyPage(() => import('./pages/UpgradePage'));
const ExamReviewPage = lazyPage(() => import('./pages/ExamReviewPage'));
const FormStudioPage = lazyPage(() => import('./pages/FormStudioPage'));
const ModelPage = lazyPage(() => import('./pages/ModelPage'));
const LearnPage = lazyPage(() => import('./pages/LearnPage'));
const TermsPage = lazyPage(() => import('./pages/TermsPage'));
const PrivacyPage = lazyPage(() => import('./pages/PrivacyPage'));
const LoginModal = React.lazy(() => import('./components/LoginModal'));
const UpgradeModal = React.lazy(() => import('./components/UpgradeModal'));
const DynamicForm = React.lazy(() => import('./components/DynamicForm'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const CurationViewPage = React.lazy(() => import('./pages/CurationViewPage'));
const OutputsLibrary = React.lazy(() => import('./components/OutputsLibrary'));
const MarkPage = React.lazy(() => import('./components/MarkPage'));
const AssignmentsPage = React.lazy(() => import('./components/AssignmentsPage'));
const AssignmentSubmitPage = React.lazy(() => import('./pages/AssignmentSubmitPage'));
type MarkIncoming = import('./components/MarkPage').MarkIncoming;
type MarkScanTarget = import('./components/MarkPage').MarkScanTarget;
const MarkingDrawer = React.lazy(() => import('./components/ChatMarkingCard').then((m) => ({ default: m.MarkingDrawer })));
const openMarking = (examId: string) => window.dispatchEvent(new CustomEvent('bwenge:open-marking', { detail: { examId } }));

import { Suspense } from 'react';
const DocumentScannerLazy = React.lazy(() => import('./components/DocumentScanner'));
const DocumentScanner = (props: React.ComponentProps<typeof DocumentScannerLazy>) => (
  <Suspense fallback={null}><DocumentScannerLazy {...props} /></Suspense>
);

const CHAT_HISTORY_KEY = 'bwenge_chat_history';
const CHAT_SESSIONS_KEY = 'bwenge_saved_sessions';
// The server streams a heartbeat every 15 s, so this only fires when the connection itself is gone.
const CHAT_TOKEN_TIMEOUT_MS = 120_000;
/** Conversation sent with each message: up to 200 turns, each cut at 20,000 characters (about 4 MB at most). */
const CHAT_HISTORY_MAX_TURNS = 200;
const CHAT_HISTORY_MAX_CHARS = 20_000;
/** Attachment limits per file and per message (the server's CHAT_MAX_FILE_MB defaults to 100). */
const CHAT_MAX_FILE_BYTES = 100 * 1024 * 1024;
const CHAT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** Files above this size (alone or together) are uploaded first and sent with the message by id. */
const CHAT_INLINE_MAX_BYTES = 8 * 1024 * 1024;

async function uploadChatFile(file: File, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await authFetch('/api/files/upload', { method: 'POST', body: form, signal });
  const data = await res.json().catch(() => ({} as { fileId?: string; error?: string }));
  if (!res.ok || !data.fileId) throw new Error(data.error || `Could not upload ${file.name}. Please try again.`);
  return data.fileId;
}

const normalizeLoadedMessages = (loadedMessages: Message[]): Message[] => {
  if (!Array.isArray(loadedMessages)) return [];

  return loadedMessages.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    return !(
      item.sender === 'assistant' &&
      item.text ===
        `👋 Hello! I’m Bwenge AI. I can help you grade student submissions, review rubrics, and turn scanned work into a clean feedback report.

Open a student paper or scanned answer sheet to begin.
Attach a rubric for focused grading.
Tap Scanner below to process handwritten work.

Use one of the quick actions below to get started immediately.`
    );
  }).map((item) => {
    if (!item.isStreaming && !item.isWaiting) return item;
    return {
      ...item,
      text: item.text || 'Generation was interrupted. Please try again.',
      isStreaming: false,
      isWaiting: false,
      stopped: true,
    };
  });
};

export default function App() {
  const isMobile = useIsMobile();
  useVisualViewportHeight();

  const {
    user: authenticatedUser,
    setUser: setAuthenticatedUser,
    authStatus,
    setAuthStatus,
    logout: logoutStore,
    workspaceRestoreFailed,
    setWorkspaceRestoreFailed,
    messages,
    setMessages,
    addMessage,
    sessions: chatSessions,
    setSessions: setChatSessions,
    setActiveSessionId,
    clearChat: clearChatStore,

    examPaper,
    setExamPaper,
    uploadedFiles,
    setUploadedFiles,
    studentScripts,
    setStudentScripts,
    activeTab,
    setActiveTab,
    activeFormId,
    setActiveFormId,
    activeSessionId,
    isAiLoading,

    setIsAiLoading,
    lastInteractionId,
    setLastInteractionId,
    abortController,
    setAbortController,
  } = useStore();

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('darkMode') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('darkMode', String(darkMode)); } catch {}
  }, [darkMode]);
  useEffect(() => {
    if (authenticatedUser?.settings?.theme) setDarkMode(authenticatedUser.settings.theme === 'dark');
  }, [authenticatedUser?.settings?.theme]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  const [highlights, setHighlights] = useState<DocumentHighlight[]>(INITIAL_HIGHLIGHTS);
  const [decks, setDecks] = useState<StudyDeck[]>(INITIAL_DECKS);
  const [flashcards, setFlashcards] = useState<Flashcard[]>(INITIAL_FLASHCARDS);
  const [aiCards, setAiCards] = useState<AICard[]>(INITIAL_AI_CARDS);
  const [penState, setPenState] = useState<HardwarePenState>(INITIAL_PEN_STATE);
  const [showPenToast, setShowPenToast] = useState<boolean>(false);

  const [excelDownloadUrl, setExcelDownloadUrl] = useState<string | null>(null);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);

  const [selectedText, setSelectedText] = useState<string>('');
  const [selectionPos, setSelectionPos] = useState<{ top: number; left: number } | null>(null);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);
  const [aiServiceState, setAiServiceState] = useState<'ready' | 'degraded' | 'offline'>('ready');
  // Deep links the AI can give in chat: /scan opens the scanner, /settings the settings page.
  const [scannerOpen, setScannerOpen] = useState<boolean>(() => AI_SCAN_ENABLED && window.location.pathname === '/scan');
  useEffect(() => {
    if (['/scan', '/settings'].includes(window.location.pathname)) window.history.replaceState({}, '', '/');
  }, []);
  const openScanner = AI_SCAN_ENABLED ? () => setScannerOpen(true) : undefined;
  const [aiStatus, setAiStatus] = useState<{ type: 'info' | 'warning'; message: string } | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(() => window.location.pathname === '/signup');
  const [isSignUpMode, setIsSignUpMode] = useState<boolean>(() => window.location.pathname === '/signup');
  const [upgradeModalOpen, setUpgradeModalOpen] = useState<boolean>(false);
  const [upgradeContext, setUpgradeContext] = useState<{ jobId?: string; service?: string; targetPlan?: 'individual' | 'business' | 'organisation' } | null>(() => {
    if (window.location.pathname !== '/upgrade') return null;
    const params = new URLSearchParams(window.location.search);
    const requestedPlan = params.get('plan');
    const targetPlan = requestedPlan === 'business' || requestedPlan === 'organisation' || requestedPlan === 'individual' ? requestedPlan : undefined;
    const isSubscriptionPlan = targetPlan === 'business' || targetPlan === 'organisation';
    return {
      jobId: isSubscriptionPlan ? undefined : params.get('jobId') || undefined,
      service: isSubscriptionPlan ? undefined : params.get('service') || undefined,
      targetPlan,
    };
  });
  const [upgradePageOpen, setUpgradePageOpen] = useState<boolean>(() => window.location.pathname === '/upgrade');
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => window.location.pathname === '/settings');
  const [libraryOpen, setLibraryOpen] = useState<boolean>(false);
  // Mark page, and a marking request waiting for the fresh chat it is sent in.
  const [markOpen, setMarkOpen] = useState<boolean>(() => window.location.pathname === '/mark');
  // Assignments: /assignments, or /assignments/<id> for one class dashboard (links from the chat).
  const [assignmentsOpen, setAssignmentsOpen] = useState<{ id: string | null; mark?: boolean } | null>(() => {
    const m = /^\/assignments(?:\/([0-9a-f-]{36}))?\/?$/.exec(window.location.pathname);
    // ?mark=1 (the chat's "Mark all" link) goes straight on to the Mark page with the class loaded.
    return m ? { id: m[1] ?? null, mark: !!m[1] && new URLSearchParams(window.location.search).get('mark') === '1' } : null;
  });
  // Camera opened from the Mark page: its pages go back to that page (one folder per student), not to the old hub.
  const [scanForMark, setScanForMark] = useState(false);
  const [markIncoming, setMarkIncoming] = useState<MarkIncoming | null>(null);
  // What the camera is photographing for the Mark page: the students' scripts, or one marking scheme / question paper.
  const [scanTarget, setScanTarget] = useState<MarkScanTarget>('scripts');
  // "Mark an exam" on the home screen (and anything else) opens the Mark page through this event.
  useEffect(() => {
    const open = () => setMarkOpen(true);
    window.addEventListener('bwenge:open-mark', open);
    return () => window.removeEventListener('bwenge:open-mark', open);
  }, []);
  const [pendingMark, setPendingMark] = useState<import('./components/MarkPage').MarkRequest | null>(null);
  const [libraryTab, setLibraryTab] = useState<'mine' | 'library'>('mine');
  const [adminOpen, setAdminOpen] = useState<boolean>(() => window.location.pathname === '/admin');
  // /admin/datasets: Datasets & Curations. Administrators get the full section; everyone else a view-only page.
  const [curationOpen, setCurationOpen] = useState<boolean>(() => /^\/(admin\/)?datasets\/?$/.test(window.location.pathname));
  const [selectedProvider, setSelectedProvider] = useState<string>('gonkarouter');
  const retryPromptRef = React.useRef<{
    text: string;
    attachment?: File | ChatAttachment | Array<File | ChatAttachment>;
    options?: { answerLanguage?: string; learning?: import('./lib/learning/presets').LearningSettings };
  } | null>(null);
  const [publicForm, setPublicForm] = useState<any | null>(null);
  const [publicFormLoading, setPublicFormLoading] = useState(false);
  const [publicFormError, setPublicFormError] = useState('');
  const [publicFormSubmitted, setPublicFormSubmitted] = useState(false);
  const [publicFormSubmitError, setPublicFormSubmitError] = useState('');
  const [publicFormLinkCopied, setPublicFormLinkCopied] = useState(false);
  const [studioProjectId, setStudioProjectId] = useState<string | null>(null);
  const [studioProjectsLoaded, setStudioProjectsLoaded] = useState(false);
  const [studioProjectStatus, setStudioProjectStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedStudioProjects, setSavedStudioProjects] = useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [workspaceHistoryLoaded, setWorkspaceHistoryLoaded] = useState(false);
  const [documentViewMode, setDocumentViewMode] = useState<'grid' | 'list'>('grid');
  const workspaceSnapshotRef = React.useRef('');

  const [activeDocument, setActiveDocument] = useState<UploadedFile | null>(null);
  const [stagedAttachments, setStagedAttachments] = useState<Array<File | ChatAttachment>>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [temporaryChatMode, setTemporaryChatMode] = useState(false);

  const handleStageAttachments = (files: Array<File | ChatAttachment>) => {
    const allowedExtensions = new Set([
      'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'rtf', 'json',
      'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'html', 'css', 'xml', 'yaml', 'yml', 'sql',
      'png', 'jpg', 'jpeg', 'webp', 'gif',
    ]);
    const next = [...stagedAttachments];
    const errors: string[] = [];
    const maxFiles = 10;
    const maxFileBytes = CHAT_MAX_FILE_BYTES;
    const maxTotalBytes = CHAT_MAX_TOTAL_BYTES;
    const sizeOf = (item: File | ChatAttachment) => {
      if (item instanceof File) return item.size;
      if (typeof item.size === 'number') return item.size;
      const sizeMatch = typeof item.size === 'string' ? item.size.match(/^([\d.]+)\s*(B|KB|MB)$/i) : null;
      if (sizeMatch) return Number(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === 'MB' ? 1024 * 1024 : sizeMatch[2].toUpperCase() === 'KB' ? 1024 : 1);
      const data = item.base64Data || item.url || item.previewUrl || '';
      const encoded = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
      return encoded ? Math.floor(encoded.length * 0.75) : 0;
    };
    let totalBytes = next.reduce((sum, item) => sum + sizeOf(item), 0);

    for (const item of files) {
      const itemBytes = sizeOf(item);
      if (item instanceof File) {
        const extension = item.name.split('.').pop()?.toLowerCase() || '';
        if (item.size === 0) { errors.push(`${item.name}: file is empty`); continue; }
        if (!allowedExtensions.has(extension)) { errors.push(`${item.name}: file type is not supported`); continue; }
        if (itemBytes > maxFileBytes) { errors.push(`${item.name}: larger than ${maxFileBytes / 1048576} MB`); continue; }
        if (totalBytes + itemBytes > maxTotalBytes) { errors.push(`Attachments cannot exceed ${maxTotalBytes / 1048576} MB total`); continue; }
        const duplicate = next.some((existing) => existing instanceof File && existing.name === item.name && existing.size === item.size && existing.lastModified === item.lastModified);
        if (duplicate) { errors.push(`${item.name}: already attached`); continue; }
      } else if (itemBytes > maxFileBytes || (itemBytes > 0 && totalBytes + itemBytes > maxTotalBytes)) {
        errors.push(`${item.name || 'Attachment'} exceeds the attachment size limit`);
        continue;
      }
      if (next.length >= maxFiles) { errors.push('You can attach up to 10 files per message'); break; }
      next.push(item);
      totalBytes += itemBytes;
    }

    setStagedAttachments(next);
    setAttachmentError(errors.join('. '));
  };

  const handleRemoveStagedAttachment = (index: number) => {
    setStagedAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentError('');
  };

  const handleClearStagedAttachments = () => {
    setStagedAttachments([]);
    setAttachmentError('');
  };

  useEffect(() => {
    const handleOpenUpgrade = (e: CustomEvent<{ jobId?: string; service?: string }>) => {
      setUpgradeContext(e.detail || {});
      setUpgradeModalOpen(true);
    };
    const handleOpenSignup = () => {
      setIsSignUpMode(true);
      setLoginModalOpen(true);
    };
    const handleOpenLogin = () => {
      setIsSignUpMode(false);
      setLoginModalOpen(true);
    };
    const handlePopState = () => {
      if (window.location.pathname !== '/upgrade') setUpgradePageOpen(false);
      if (window.location.pathname !== '/admin') setAdminOpen(false);
      if (!/^\/(admin\/)?datasets\/?$/.test(window.location.pathname)) setCurationOpen(false);
      if (window.location.pathname === '/signup') {
        setIsSignUpMode(true);
        setLoginModalOpen(true);
      } else if (window.location.pathname === '/') {
        setLoginModalOpen(false);
      }
    };
    window.addEventListener('open-upgrade-modal', handleOpenUpgrade as EventListener);
    window.addEventListener('open-signup-modal', handleOpenSignup);
    window.addEventListener('open-login-modal', handleOpenLogin);
    window.addEventListener('popstate', handlePopState);
    // Upgrade buttons open the plans page directly (Free / Starter / Teacher / Teacher Plus and top-ups, in RWF).
    (window as any).openUpgradeModal = (jobId?: string, service?: string) => {
      setUpgradeContext({ jobId, service });
      window.history.pushState({}, '', '/upgrade');
      setUpgradePageOpen(true);
    };
    return () => {
      window.removeEventListener('open-upgrade-modal', handleOpenUpgrade as EventListener);
      window.removeEventListener('open-signup-modal', handleOpenSignup);
      window.removeEventListener('open-login-modal', handleOpenLogin);
      window.removeEventListener('popstate', handlePopState);
      delete (window as any).openUpgradeModal;
    };
  }, []);

  useEffect(() => {
    const loadPublicFormById = (formId: string) => {
      setActiveFormId(formId);
      setPublicFormLoading(true);
      setPublicFormError('');
      authFetch(`/api/public/forms/${formId}`)
        .then((res) => {
          if (!res.ok) throw new Error('Form not found');
          return res.json();
        })
        .then((data) => {
          setPublicForm(data);
          setPublicFormLoading(false);
        })
        .catch((err) => {
          setPublicFormError(err.message || 'Could not load form');
          setPublicFormLoading(false);
        });
    };

    const params = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/^\/(?:forms|apply)\/([^/?#]+)\/?$/);
    const formId = pathMatch?.[1] || params.get('form');
    if (formId) {
      loadPublicFormById(formId);
    }

    const handleOpenPublicForm = (e: Event) => {
      const custom = e as CustomEvent<{ formId?: string }>;
      if (custom.detail?.formId) {
        window.history.pushState({}, '', `/forms/${custom.detail.formId}`);
        loadPublicFormById(custom.detail.formId);
      }
    };
    window.addEventListener('bwenge:open-public-form', handleOpenPublicForm);
    return () => window.removeEventListener('bwenge:open-public-form', handleOpenPublicForm);
  }, [setActiveFormId]);

  useEffect(() => {
    let cancelled = false;
    authService.me()
      .then((user) => {
        if (!cancelled && user) {
          setAuthenticatedUser(user);
          setAuthStatus('authenticated');
        } else if (!cancelled) {
          setAuthenticatedUser(null);
          setAuthStatus('anonymous');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticatedUser(null);
          setAuthStatus('anonymous');
        }
      });

    const handleSessionExpired = () => {
      logoutStore();
      showAiStatus('warning', 'Your session expired. Sign in to continue.');
      setLoginModalOpen(true);
    };
    window.addEventListener('bwenge:session-expired', handleSessionExpired);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('bwenge-auth');
      channel.onmessage = (event) => {
        if (event.data?.type === 'LOGOUT') {
          logoutStore();
        }
      };
    } catch {}

    return () => {
      cancelled = true;
      window.removeEventListener('bwenge:session-expired', handleSessionExpired);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    if (adminOpen && authStatus !== 'loading' && authenticatedUser?.role !== 'ADMIN') {
      window.history.replaceState({}, '', '/');
      setAdminOpen(false);
    }
  }, [adminOpen, authStatus, authenticatedUser?.role]);

  useEffect(() => {
    setWorkspaceHistoryLoaded(false);
    setWorkspaceRestoreFailed(false);
    workspaceSnapshotRef.current = '';
    if (authStatus !== 'authenticated' || !authenticatedUser) {
      setWorkspaceHistoryLoaded(true);
      return;
    }
    let cancelled = false;
    authFetch('/api/studio/projects/workspace')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load workspace history.');
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const workspace = data.workspace;
        if (workspace && typeof workspace === 'object') {
          const state = useStore.getState();
          if (Array.isArray(workspace.messages)) state.setMessages(normalizeLoadedMessages(workspace.messages));
          if (Array.isArray(workspace.sessions)) {
            state.setSessions(workspace.sessions.map((session: ChatSession) => ({
              ...session,
              messages: normalizeLoadedMessages(session.messages || []),
            })));
          }
          if (Array.isArray(workspace.uploadedFiles)) state.setUploadedFiles(workspace.uploadedFiles);
          if (workspace.documentViewMode === 'grid' || workspace.documentViewMode === 'list') {
            setDocumentViewMode(workspace.documentViewMode);
          }
          if ('activeFormId' in workspace) state.setActiveFormId(workspace.activeFormId || null);
          if ('pinnedSyllabusId' in workspace) state.setPinnedSyllabusId(workspace.pinnedSyllabusId || null);
          if (Array.isArray(workspace.highlights)) setHighlights(workspace.highlights);
          if (Array.isArray(workspace.decks)) setDecks(workspace.decks);
          if (Array.isArray(workspace.flashcards)) setFlashcards(workspace.flashcards);
          if (Array.isArray(workspace.aiCards)) setAiCards(workspace.aiCards);
          if (workspace.examPaper) state.setExamPaper(workspace.examPaper);
          else state.setExamPaper(null);
          if (Array.isArray(workspace.studentScripts)) state.setStudentScripts(workspace.studentScripts);
          workspaceSnapshotRef.current = JSON.stringify(workspace);
        }
        setWorkspaceHistoryLoaded(true);
      })
      .catch((error) => {
        console.error('Workspace history restore failed:', error);
        if (!cancelled) {
          setWorkspaceRestoreFailed(true);
          setWorkspaceHistoryLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [authStatus, authenticatedUser?.id]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !authenticatedUser || !workspaceHistoryLoaded || workspaceRestoreFailed) return;
    const workspace = {
      messages: temporaryChatMode ? [] : messages,
      sessions: chatSessions,
      uploadedFiles,
      documentViewMode,
      activeTab,
      activeFormId,
      pinnedSyllabusId: useStore.getState().pinnedSyllabusId,
      highlights,
      decks,
      flashcards,
      aiCards,
      examPaper,
      studentScripts,
    };
    const snapshot = JSON.stringify(workspace);
    if (snapshot === workspaceSnapshotRef.current) return;

    const timer = setTimeout(() => {
      authFetch('/api/studio/projects/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Workspace history save failed.');
          workspaceSnapshotRef.current = snapshot;
        })
        .catch((err) => console.error('Workspace history save failed:', err));
    }, 1500);

    return () => clearTimeout(timer);
  }, [authStatus, authenticatedUser?.id, workspaceHistoryLoaded, workspaceRestoreFailed, temporaryChatMode, messages, chatSessions, uploadedFiles, documentViewMode, activeTab, activeFormId, examPaper, studentScripts]);

  const showAiStatus = (type: 'info' | 'warning', message: string) => {
    setAiStatus({ type, message });
    setTimeout(() => setAiStatus(null), 3500);
  };

  const handleLogout = async () => {
    try {
      await authFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    logoutStore();
    setTemporaryChatMode(false);
    showAiStatus('info', 'Logged out successfully');
  };

  const handleNewChat = () => {
    clearChatStore();
    setActiveSessionId(null);
    setTemporaryChatMode(false);
    handleClearStagedAttachments();
    setActiveTab('documents');
  };

  // Mark page → a new chat that marks live: the files, their roles and the teacher's instructions.
  const startMarking = (req: import('./components/MarkPage').MarkRequest) => {
    setMarkOpen(false);
    if (window.location.pathname === '/mark') window.history.replaceState({}, '', '/');
    handleNewChat();
    setPendingMark(req);
  };

  const handleLoadChatSession = (sessionId: string) => {
    const session = chatSessions.find((s) => s.id === sessionId);
    if (session) {
      setTemporaryChatMode(false);
      setMessages(normalizeLoadedMessages(session.messages || []));
      setActiveSessionId(session.id);
      setActiveTab('documents');
    }
  };

  const handleDeleteSession = (sessionId: string) => {
    const nextSessions = chatSessions.filter((s) => s.id !== sessionId);
    useStore.getState().setSessions(nextSessions);
  };

  const handleInsightAction = async (action: string, insight: any) => {
    if (action === 'DRAFT REMEDIATION') {
      const prompt = `Based on the critical gap detected: "${insight.content}", please draft a 15-minute remediation lesson plan. Focus on correcting the specific student misconceptions mentioned. Use the active assessment context.`;
      handleSendMessage(prompt);
      if (!isMobile) setActiveTab('marking_hub');
    } else {
      console.log('Unhandled insight action:', action, insight);
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64Clean = result.split(',')[1] || result;
        resolve(base64Clean);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const makeImageThumbnail = (source: File | string, mimeType: string): Promise<string | undefined> => {
    if (!mimeType.startsWith('image/')) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const objectUrl = source instanceof File ? URL.createObjectURL(source) : undefined;
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) { resolve(undefined); return; }
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        } catch {
          resolve(undefined);
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        }
      };
      image.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(undefined);
      };
      image.src = objectUrl || source as string;
    });
  };

  const handleUploadStudentPaper = async (fileOrFiles: File | File[]) => {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    if (files.length === 0) return;

    setIsAiThinking(true);
    setAiStatus({ type: 'info', message: `Processing ${files.length} student submission(s)...` });

    try {
      const parsedFiles: UploadedFile[] = [];
      const parsedScripts: StudentScript[] = [];
      const scannedImageFiles = new Map<string, File>();

      for (const file of files) {
        let textContent = '';
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';

        if (isImage || isPdf) {
          scannedImageFiles.set(file.name, file);
        }

        try {
          const { processFileClientSide } = await import('./utils/fileProcessor');
          const clientResult = await processFileClientSide(file);
          if (clientResult && clientResult.rawText) {
            textContent = clientResult.rawText;
          }
        } catch (e) {
          console.warn('Client-side parse fallback error:', e);
        }

        if (!textContent) {
          textContent = `[Uploaded document: ${file.name}]`;
        }

        const uploadedFileId = 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const uploadedFile: UploadedFile = {
          id: uploadedFileId,
          name: file.name,
          url: URL.createObjectURL(file),
          fileType: isImage ? 'image' : isPdf ? 'pdf' : 'text',
          rawText: textContent,
          studentName: file.name.replace(/\.[^/.]+$/, ''),
          batchBadge: '1',
        };

        parsedFiles.push(uploadedFile);

        const extractedAnswers: Record<string, string> = {};
        const qMatches = textContent.matchAll(/(?:Q|Question)\s*(\d+)[:\)]?\s*([^\n]+)/gi);
        for (const match of qMatches) {
          extractedAnswers[`Q${match[1]}`] = match[2].trim();
        }
        if (Object.keys(extractedAnswers).length === 0) {
          extractedAnswers['Q1'] = textContent.slice(0, 300);
        }

        const answers: StudentAnswerInput[] = Object.entries(extractedAnswers).map(([qNum, text], idx) => ({
          questionId: 'q-' + idx,
          questionNumber: qNum,
          answerText: text,
        }));

        parsedScripts.push({
          id: 'script-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          sourceFileId: uploadedFile.id,
          studentName: uploadedFile.studentName || file.name.replace(/\.[^/.]+$/, ''),
          studentId: 'STU-' + Math.floor(1000 + Math.random() * 9000),
          submittedAt: new Date().toISOString(),
          status: 'pending',
          answers,
          rawText: textContent,
          fileName: uploadedFile.name,
        });
      }

      setUploadedFiles((prev) => [...parsedFiles, ...prev]);
      setStudentScripts((prev) => [...parsedScripts, ...prev]);
      if (!isMobile) setActiveTab('marking_hub');

      for (const script of parsedScripts) {
        if (!scannedImageFiles.has(script.fileName || '')) await handleMarkScript(script);
      }

      if (scannedImageFiles.size > 0) {
        const scanPages: ChatAttachment[] = [];
        let pageIdx = 0;
        for (const file of scannedImageFiles.values()) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read scan PDF'));
            reader.onerror = () => reject(reader.error || new Error('Could not read scan PDF'));
            reader.readAsDataURL(file);
          });
          scanPages.push({
            id: 'att-scan-' + Date.now() + '-' + pageIdx++,
            name: file.name,
            mimeType: file.type || 'image/jpeg',
            previewUrl: dataUrl,
            url: dataUrl,
            fileType: file.type.startsWith('image/') ? 'image' : 'pdf',
          });
        }

        const scanPrompt = `I have attached ${scannedImageFiles.size} scanned answer sheet(s). Please perform optical character recognition (OCR) and grade these submissions against the active exam rubric.`;
        void handleSendMessage(scanPrompt, scanPages);
      }

      showAiStatus('info', `Successfully ingested ${files.length} student paper(s)`);
    } catch (error: any) {
      console.error('Error ingesting student papers:', error);
      showAiStatus('warning', error.message || 'Failed to ingest student papers');
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleMarkScript = async (script: StudentScript) => {
    try {
      const rubricContext = examPaper ? JSON.stringify(examPaper) : 'Standard grading rubric';
      const prompt = `Grade student submission for ${script.studentName} (${script.studentId}).\nRubric:\n${rubricContext}\nAnswers:\n${JSON.stringify(script.answers)}`;
      const res = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: prompt,
          provider: selectedProvider === 'auto' ? undefined : selectedProvider,
        }),
      });
      if (!res.ok) throw new Error('Grading failed');
      if (!res.body) throw new Error('AI service returned an empty stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let reply = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            const event = JSON.parse(payload);
            if (event.type === 'text' && typeof event.text === 'string') reply += event.text;
            if (event.type === 'error') throw new Error(event.error || 'Grading stream failed');
          }
        }
      } finally {
        reader.releaseLock();
      }

      const scoreMatch = reply.match(/(?:score|total|awarded)[:\s]*(\d+(?:\.\d+)?)\s*\/\s*(\d+)/i);
      const awarded = scoreMatch ? parseFloat(scoreMatch[1]) : 80;
      const max = scoreMatch ? parseFloat(scoreMatch[2]) : 100;

      setStudentScripts((prev: StudentScript[]) =>
        prev.map((s) =>
          s.id === script.id
            ? {
                ...s,
                status: 'marked' as const,
                totalAwardedMarks: awarded,
                maxTotalMarks: max,
                percentage: Math.round((awarded / max) * 100),
                overallFeedback: reply.slice(0, 250),
              }
            : s
        )
      );
    } catch (e) {
      console.error('Auto-grading script error:', e);
    }
  };

  const [markingContext, setMarkingContext] = useState<MarkingContext | null>(null);
  const [scanBatch, setScanBatch] = useState<ScanBatch | null>(null);
  // Store only the owner-scoped exam id, never scan images or student names in browser storage.
  useEffect(() => {
    setScanBatch(null);
    if (!authenticatedUser?.id) return;
    try {
      const examId = sessionStorage.getItem(`bwenge.scan.exam:${authenticatedUser.id}`);
      if (examId && /^[0-9a-f-]{36}$/i.test(examId)) { setScanBatch({ id: `resume-${examId}`, examId, pages: [] }); setActiveTab('marking_hub'); }
    } catch { /* browser storage is optional */ }
  }, [authenticatedUser?.id]);
  const [scannerGeneratedForm, setScannerGeneratedForm] = useState<any | null>(null);
  const [openFormRequest, setOpenFormRequest] = useState(0);

  const handleSaveScannedPages = async (
    pages: Array<{
      dataUrl: string;
      sourceDataUrl?: string;
      id?: string;
      filter?: any;
      candidateId?: string;
      name?: string;
      studentName?: string;
      extractedText?: string;
      aiSummary?: string;
      aiScore?: number;
      aiMaxScore?: number;
      aiFeedback?: string;
      file?: File;
    }>
  ) => {
    const saved = await registerScannedPapers(pages.map((p, i) => ({ ...p, id: p.id || `scan-${i}`, filter: p.filter || 'color' })));
    setScannerOpen(false);
    try { if (authenticatedUser?.id) sessionStorage.setItem(`bwenge.scan.exam:${authenticatedUser.id}`, saved.examId); } catch {}
    const now = Date.now();

    const newUploaded: UploadedFile[] = pages.map((p, idx) => ({
      id: `scan-file-${now}-${idx}`,
      name: p.name || `${(p.studentName || `Student_${idx + 1}`).replace(/\s+/g, '_')}_Page_${idx + 1}.jpg`,
      size: '320 KB',
      type: 'student_paper',
      uploadDate: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      url: p.dataUrl,
      fileType: 'image',
      rawText: p.extractedText || p.aiSummary || 'Scanned student answer page',
      studentName: p.studentName || `Student ${idx + 1}`,
      batchBadge: String(idx + 1),
    }));
    setUploadedFiles((prev) => [...newUploaded, ...prev]);

    const grouped = new Map<string, typeof pages>();
    pages.forEach((p, i) => { const id = p.candidateId || p.studentName || `paper-${i}`; grouped.set(id, [...(grouped.get(id) || []), p]); });
    const newScripts: StudentScript[] = Array.from(grouped.values()).map((paper, idx) => ({
      id: `scan-script-${now}-${idx}`, sourceFileId: `scan-file-${now}-${pages.indexOf(paper[0])}`,
      studentName: paper[0].studentName || `Student ${idx + 1}`, studentId: `SCN-${String(idx + 1).padStart(3, '0')}`,
      submittedAt: new Date().toISOString(), status: 'pending', answers: [],
    }));
    setStudentScripts(newScripts);
    setScanBatch({ id: String(now), examId: saved.examId, pages: pages.map((p, i) => ({ ...p, id: p.id || `scan-${now}-${i}`, filter: p.filter || 'color' })) });
    setActiveTab('marking_hub');

    const attachments: ChatAttachment[] = pages.map((p, idx) => ({
      id: 'att-page-' + now + '-' + idx,
      name: p.name || `${p.studentName || 'Scan'}_${idx + 1}.jpg`,
      mimeType: 'image/jpeg',
      previewUrl: p.dataUrl,
      url: p.dataUrl,
      fileType: 'image',
    }));

    // The workspace owns this marking session; do not start a second independent chat grading run.
    setMessages(prev => [...prev, {
      id: `scan-message-${now}`, sender: 'user', text: `Mark these scanned papers: ${grouped.size} students, ${pages.length} JPEG pages.`,
      attachments, timestamp: new Date().toISOString(),
    }, {
      id: `scan-reply-${now}`, sender: 'assistant',
      text: 'Your scanned papers are open in the workspace. Attach a marking scheme there, or choose Use AI draft if the questions are visible. If these pages contain only answers, attach the question paper. Validated red marks will appear as each question is checked.',
      timestamp: new Date().toISOString(),
    }]);
  };

  const handleSendMessage = async (
    text: string,
    attachment?: File | ChatAttachment | Array<File | ChatAttachment>,
    options?: { answerLanguage?: string; learning?: import('./lib/learning/presets').LearningSettings; marking?: import('./components/MarkPage').MarkRequest['marking'] },
  ) => {
    if ((!text.trim() && !attachment) || isAiLoading) return;

    if (!authenticatedUser) {
      setLoginModalOpen(true);
      return;
    }

    const userMsg: Message = {
      id: 'msg-' + Date.now(),
      sender: 'user',
      text,
      timestamp: new Date().toISOString(),
    };

    const assistantId = 'msg-' + (Date.now() + 1);
    const generatedAttachments: import('./components/types').AttachmentRef[] = [];
    // Live tool activity ("Creating chart…", "Building Excel workbook…") shown in the reply's activity line.
    let toolSteps: Step[] = [];
    const startedAt = Date.now();
    const pendingAssistant: Message = {
      id: assistantId,
      sender: 'assistant',
      text: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      isWaiting: true,
    };
    const nextMessages = [...messages, userMsg];
    let requestMessages = nextMessages;
    setMessages([...nextMessages, pendingAssistant]);
    setIsAiThinking(true);
    setIsAiLoading(true);

    const controller = new AbortController();
    setAbortController(controller);
    retryPromptRef.current = { text, attachment, options };
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let firstTokenReceived = false;

    const resetIdleTimeout = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CHAT_TOKEN_TIMEOUT_MS);
    };

    // The examination this reply is marking: the message shows its live marking card.
    let examId: string | undefined;
    const updateAssistant = (assistantText: string, isStreaming: boolean) => {
      const running = isStreaming ? toolSteps.filter((step) => step.status === 'running') : [];
      const assistantMsg: Message = {
        ...pendingAssistant,
        text: assistantText,
        isStreaming,
        isWaiting: !firstTokenReceived && isStreaming,
        ...(generatedAttachments.length ? { generatedAttachments: [...generatedAttachments] } : {}),
        ...(examId ? { examId } : {}),
        ...(toolSteps.length ? {
          steps: toolSteps.map((step) => (isStreaming || step.status !== 'running' ? step : { ...step, status: 'done' as const })),
          isBusy: running.length > 0,
          currentStatus: running.at(-1)?.label,
          startedAt,
          ...(isStreaming ? {} : { endedAt: Date.now() }),
        } : {}),
      };
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? assistantMsg : message
      )));
      setLastInteractionId(assistantId);
    };
    try {
      const newAttachments: ChatAttachment[] = [];
      const attachmentPayloads: Array<{ name: string; mimeType: string; base64: string }> = [];
      const serverAttachmentIds: string[] = [];
      let inlineBytes = 0;
      if (attachment) {
        const attArray = Array.isArray(attachment) ? attachment : [attachment];
        for (const att of attArray) {
          if (att instanceof File) {
            const mimeType = att.type || 'application/octet-stream';
            if (att.size > CHAT_INLINE_MAX_BYTES || inlineBytes + att.size > CHAT_INLINE_MAX_BYTES) {
              // Large files are uploaded on their own first and sent with the message by id.
              serverAttachmentIds.push(await uploadChatFile(att, controller.signal));
            } else {
              const base64 = await convertFileToBase64(att);
              if (!base64) throw new Error(`Could not read ${att.name}. Please choose the file again.`);
              attachmentPayloads.push({ name: att.name, mimeType, base64 });
              inlineBytes += att.size;
            }
            const previewUrl = await makeImageThumbnail(att, mimeType);
            newAttachments.push({
              id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              name: att.name,
              mimeType,
              ...(previewUrl ? { previewUrl, url: previewUrl } : {}),
              fileType: att.type.startsWith('image/') ? 'image' : att.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
            });
          } else {
            const source = att.base64Data || [att.url, att.previewUrl].find((value) => value?.startsWith('data:')) || '';
            const base64 = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source;
            const mimeType = att.mimeType || att.type || 'application/octet-stream';
            const imagePreview = source ? await makeImageThumbnail(source, mimeType) : undefined;
            newAttachments.push({
              ...att,
              url: imagePreview || (att.url?.startsWith('data:') ? undefined : att.url),
              previewUrl: imagePreview || (att.previewUrl?.startsWith('data:') ? undefined : att.previewUrl),
            });
            if (base64) attachmentPayloads.push({
              name: att.name || 'attachment',
              mimeType,
              base64,
            });
            if (att.serverId) serverAttachmentIds.push(att.serverId);
          }
        }
      }
      requestMessages = nextMessages.map((message) => (
        message.id === userMsg.id
          ? { ...message, attachments: newAttachments.length > 0 ? newAttachments : undefined }
          : message
      ));
      setMessages((current) => current.map((message) => {
        const updatedUserMessage = requestMessages.find((candidate) => candidate.id === message.id);
        return updatedUserMessage || message;
      }));

      const contextExam = examPaper ? buildExamPaperContext(examPaper) : '';
      const fullPrompt = contextExam ? `${contextExam}\n\nUser request: ${text}` : text;

      const attachmentText = newAttachments.map((item) => item.rawText).filter(Boolean).join('\n\n');
      // Files from earlier messages in this chat (the last five), so "explain section 5.2" still finds the book.
      const contextFiles = messages
        .flatMap((message) => (message.sender === 'user' ? message.attachments ?? [] : []))
        .filter((a) => a.storedFileId)
        .map((a) => ({ fileId: a.storedFileId as string, name: a.name || 'file' }))
        .slice(-5);
      resetIdleTimeout();
      const response = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: fullPrompt,
          surface: scanBatch?.examId && activeTab === 'marking_hub' ? 'exam' : undefined,
          surfaceId: scanBatch?.examId && activeTab === 'marking_hub' ? scanBatch.examId : undefined,
          surfaceSubmissionId: scanBatch?.examId === markingContext?.examId ? markingContext?.submissionId : undefined,
          surfaceQuestionId: scanBatch?.examId === markingContext?.examId ? markingContext?.questionId : undefined,
          provider: selectedProvider === 'auto' ? undefined : selectedProvider,
          // The whole conversation (the server keeps recent turns word for word and condenses older ones).
          history: requestMessages.slice(-CHAT_HISTORY_MAX_TURNS - 1, -1).filter((message) => message.text?.trim()).map((message) => ({
            role: message.sender === 'assistant' ? 'assistant' : 'user',
            text: message.text.length > CHAT_HISTORY_MAX_CHARS ? `${message.text.slice(0, CHAT_HISTORY_MAX_CHARS)}\n[…]` : message.text,
          })),
          attachmentText,
          attachments: attachmentPayloads,
          attachmentIds: serverAttachmentIds,
          contextFiles: contextFiles.length ? contextFiles : undefined,
          answerLanguage: options?.answerLanguage,
          learning: options?.learning && options.learning.mode !== 'normal' ? options.learning : undefined,
          marking: options?.marking,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || 'Bwenge could not complete your request. Please try again.');
      }

      if (!response.body) throw new Error('AI service returned an empty stream');
      handleClearStagedAttachments();

      let assistantText = '';
      let streamBuffer = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const handleEvent = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'text' && typeof event.text === 'string') {
            assistantText += event.text;
            if (event.text.length > 0) {
              firstTokenReceived = true;
              resetIdleTimeout();
            }
            updateAssistant(assistantText, true);
          } else if (event.type === 'reset') {
            assistantText = '';
            updateAssistant(assistantText, true);
          } else if (event.type === 'status') {
            toolSteps = applyStatusEvent(toolSteps, event);
            updateAssistant(assistantText, true);
          } else if (event.type === 'tool_call' || event.type === 'tool_result') {
            toolSteps = applyToolEvent(toolSteps, event);
            resetIdleTimeout();
            updateAssistant(assistantText, true);
          } else if (event.type === 'exam' && typeof event.examId === 'string') {
            const first = examId !== event.examId;
            examId = event.examId;
            updateAssistant(assistantText, true);
            // Large screens open the live marking panel beside the chat, like an artifact.
            if (first && window.innerWidth >= 1200) openMarking(event.examId);
          } else if (event.type === 'files_stored' && Array.isArray(event.files)) {
            // Remember where the AI stored this message's files, so follow-up questions can use them.
            const key = (name: string) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const stored = event.files as Array<{ fileId: string; name: string }>;
            setMessages((current) => current.map((message) => message.id !== userMsg.id || !message.attachments ? message : {
              ...message,
              attachments: message.attachments.map((a) => {
                const hit = stored.find((f) => key(f.name) === key(a.name));
                return hit ? { ...a, storedFileId: hit.fileId } : a;
              }),
            }));
          } else if (event.type === 'attachment' && typeof event.id === 'string') {
            if (!generatedAttachments.some((attachment) => attachment.id === event.id)) {
              generatedAttachments.push(event as import('./components/types').AttachmentRef);
            }
            updateAssistant(assistantText, true);
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Bwenge could not complete your request. Please try again.');
          }
        } catch (error: any) {
          if (error instanceof SyntaxError) return;
          throw error;
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetIdleTimeout(); // any bytes, including heartbeats, mean the server is still working
          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';
          for (const line of lines) handleEvent(line);
        }
        streamBuffer += decoder.decode();
        if (streamBuffer.trim()) handleEvent(streamBuffer);
      } finally {
        reader.releaseLock();
      }

      if (!assistantText.trim()) throw new Error('The AI service completed without returning a response.');
      updateAssistant(assistantText, false);
      const finalMessages: Message[] = [...requestMessages, {
        ...pendingAssistant,
        text: assistantText,
        isStreaming: false,
        isWaiting: false,
        ...(generatedAttachments.length ? { generatedAttachments: [...generatedAttachments] } : {}),
        ...(examId ? { examId } : {}),
        ...(toolSteps.length ? { steps: toolSteps.map((step) => (step.status === 'running' ? { ...step, status: 'done' as const } : step)), startedAt, endedAt: Date.now() } : {}),
      }];
      setMessages(finalMessages);
      window.dispatchEvent(new Event('bwenge:usage')); // credits shown in the sidebar

      if (temporaryChatMode) return;
      const sessionsToSave = [...chatSessions];
      const currentSessionId = activeSessionId || 'session-' + Date.now();
      setActiveSessionId(currentSessionId);
      const existingSessionIdx = sessionsToSave.findIndex((s) => s.id === currentSessionId);
      const sessionTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');

      if (existingSessionIdx >= 0) {
        sessionsToSave[existingSessionIdx] = {
          ...sessionsToSave[existingSessionIdx],
          messages: finalMessages,
          messageCount: finalMessages.length,
          date: new Date().toISOString(),
        };
      } else {
        sessionsToSave.unshift({
          id: currentSessionId,
          title: sessionTitle,
          messages: finalMessages,
          messageCount: finalMessages.length,
          date: new Date().toISOString(),
        });
      }
      setChatSessions(sessionsToSave);
    } catch (error: any) {
      const stopped = controller.signal.aborted && !timedOut;
      const errorText = timedOut
        ? 'The connection to Bwenge was lost. Please try again.'
        : stopped
          ? 'Generation was stopped.'
          : error?.message || 'Bwenge could not complete your request. Please try again.';
      if (!stopped) console.error('Send message error:', error);
      const failedAssistant: Message = {
        ...pendingAssistant,
        text: errorText,
        isStreaming: false,
        isWaiting: false,
        ...(generatedAttachments.length ? { generatedAttachments: [...generatedAttachments] } : {}),
        stopped,
        errorKind: stopped ? undefined : 'generic',
        ...(generatedAttachments.length ? { generatedAttachments: [...generatedAttachments] } : {}),
      };
      setMessages((current) => current.map((message) => (
        message.id === assistantId ? failedAssistant : message
      )));
    } finally {
      if (idleTimeout) clearTimeout(idleTimeout);
      setIsAiThinking(false);
      setIsAiLoading(false);
      setAbortController(null);
    }
  };

  const handleToggleSoftDelete = (scriptId: string) => {
    setStudentScripts((prev: StudentScript[]) =>
      prev.map((s) => (s.id === scriptId ? { ...s, teacherApproved: !s.teacherApproved } : s))
    );
  };

  const handleToggleFlag = (scriptId: string) => {
    setStudentScripts((prev: StudentScript[]) =>
      prev.map((s) => {
        if (s.id !== scriptId) return s;
        const flags = s.flags || [];
        const nextFlags = flags.length > 0 ? [] : ['NEEDS_REVIEW' as any];
        return { ...s, flags: nextFlags };
      })
    );
  };

  const handleUpdateBonusMarks = (scriptId: string, bonus: number) => {
    setStudentScripts((prev) =>
      prev.map((s) => {
        if (s.id !== scriptId) return s;
        const base = s.totalAwardedMarks ?? 80;
        const nextAwarded = Math.max(0, base + bonus);
        return { ...s, totalAwardedMarks: nextAwarded };
      })
    );
  };

  const handleDeletePermanently = async (fileId: string) => {
    const file = useStore.getState().uploadedFiles.find((item) => item.id === fileId);
    if (!file) throw new Error('This paper is no longer in the workspace. Refresh and try again.');
    setUploadedFiles((prev) => prev.filter((item) => item.id !== fileId));
    setStudentScripts((prev) => prev.filter((script) =>
      script.sourceFileId !== fileId && !(script.fileName && script.fileName === file.name)
    ));
  };

  const handleGenerateExcelExport = async () => {
    setIsGeneratingExcel(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      const blob = new Blob(['Student ID,Student Name,Score,Status\n' + studentScripts.map(s => `${s.studentId},${s.studentName},${s.totalAwardedMarks || 0},${s.status}`).join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      setExcelDownloadUrl(url);
      showAiStatus('info', 'Excel export generated successfully');
    } catch (e) {
      showAiStatus('warning', 'Failed to generate Excel export');
    } finally {
      setIsGeneratingExcel(false);
    }
  };

  const handleExportChat = async () => {
    const chatText = messages.map((m) => `${m.sender.toUpperCase()}: ${m.text}`).join('\n\n');
    try {
      await copyToClipboard(chatText);
      showAiStatus('info', 'Conversation copied to clipboard');
    } catch {
      showAiStatus('warning', 'Could not copy the conversation');
    }
  };

  const handleRenameCurrentChat = (title: string) => {
    if (!activeSessionId) return;
    const normalizedTitle = title.trim().slice(0, 80);
    if (!normalizedTitle) return;
    setChatSessions((current) => current.map((session) =>
      session.id === activeSessionId ? { ...session, title: normalizedTitle } : session
    ));
  };

  const handleToggleTemporaryChat = () => {
    clearChatStore();
    setActiveSessionId(null);
    handleClearStagedAttachments();
    setActiveTab('documents');
    if (temporaryChatMode) {
      setTemporaryChatMode(false);
      return;
    }
    setTemporaryChatMode(true);
  };

  useEffect(() => {
    if (!pendingMark || messages.length > 0 || isAiLoading) return;
    const req = pendingMark;
    setPendingMark(null);
    void handleSendMessage(req.text, req.attachments, { marking: req.marking });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMark, messages.length, isAiLoading]);

  // Share the whole conversation, with everything Bwenge made, as one HTML page (opens anywhere, offline).
  const handleShareChat = async () => {
    if (!messages.length) return;
    const title = chatSessions.find((session) => session.id === activeSessionId)?.title || 'Bwenge conversation';
    showAiStatus('info', 'Preparing the conversation page…');
    try {
      const { shareConversationHtml } = await import('./lib/conversationHtml');
      const { shared, skipped } = await shareConversationHtml(messages, title);
      showAiStatus(skipped.length ? 'warning' : 'info', `${shared ? 'Conversation shared' : 'Conversation saved'} as an HTML page${skipped.length ? `; ${skipped.length} large or expired file(s) are listed by name only` : ', with its files'}`);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') showAiStatus('warning', 'The conversation page could not be made');
    }
  };

  const handleClearCurrentChat = () => {
    clearChatStore();
    setActiveSessionId(null);
    handleClearStagedAttachments();
  };

  const handleDeleteCurrentChat = () => {
    if (activeSessionId) handleDeleteSession(activeSessionId);
    clearChatStore();
    setActiveSessionId(null);
    handleClearStagedAttachments();
  };

  if (window.location.pathname === '/model') {
    return <ModelPage />;
  }
  // A student opening the teacher's link: the hand-in page, no account needed.
  const handIn = /^\/a\/([\w-]{16,40})\/?$/.exec(window.location.pathname);
  if (handIn) {
    return <Suspense fallback={null}><AssignmentSubmitPage token={handIn[1]} /></Suspense>;
  }
  if (window.location.pathname === '/terms') {
    return <TermsPage />;
  }
  if (window.location.pathname === '/privacy') {
    return <PrivacyPage />;
  }

  if (authStatus === 'loading') {
    return (
      <div className="h-[var(--app-h,100dvh)] w-full flex items-center justify-center bg-[#0B1420] text-[#FAF9F5]">
        <div className="flex min-w-64 flex-col items-center gap-4 rounded-3xl border border-white/[0.07] bg-white/[0.025] px-10 py-9 shadow-2xl">
          <BwengeLoader variant="banner" message="Preparing your workspace" />
          <span className="text-[11px] font-medium tracking-wide text-neutral-500">This usually takes just a moment</span>
        </div>
      </div>
    );
  }

  if (authStatus === 'anonymous' && !publicForm && !upgradePageOpen && !adminOpen) {
    return (
      <LandingPage
        onLoginSuccess={(user) => {
          if (user) {
            setAuthenticatedUser(user);
          } else {
            authService.me().then((u) => {
              if (u) setAuthenticatedUser(u);
            });
          }
          setAuthStatus('authenticated');
        }}
      />
    );
  }

  const markingChatPane = (
<RightChatSidebar
                    messages={messages}
                    chatSessions={chatSessions}
                    onSendMessage={handleSendMessage}
                    stagedAttachments={stagedAttachments}
                    onStageAttachments={handleStageAttachments}
                    attachmentError={attachmentError}
                    onRemoveStagedAttachment={handleRemoveStagedAttachment}
                    onClearStagedAttachments={handleClearStagedAttachments}
                    activeDocument={activeDocument}
                    setActiveDocument={setActiveDocument}
                    onOpenScanner={openScanner}
                    onNewChat={handleNewChat}
                    onLoadSession={handleLoadChatSession}
                    onClearChat={handleClearCurrentChat}
                    onInsightAction={handleInsightAction}
                    isDegraded={aiServiceState === 'degraded'}
                    isTyping={isAiThinking}
                    onUpgradeClick={(jobId, service) => {
                      setUpgradeContext({ jobId, service });
                      setUpgradeModalOpen(true);
                    }}
                    selectedProvider={selectedProvider}
                    onProviderChange={setSelectedProvider}
                    onRetry={() => {
                      const lastUserMessage = [...messages].reverse().find((message) => message.sender === 'user');
                      const retry = retryPromptRef.current;
                      if (retry) void handleSendMessage(retry.text, retry.attachment, retry.options);
                      else if (lastUserMessage) void handleSendMessage(lastUserMessage.text, lastUserMessage.attachments || lastUserMessage.attachment);
                    }}
                  />
  );

  const workspacePane = (
    <CenterWorkspace
      activeTab={activeTab}
      scanBatch={scanBatch}
      markingChat={markingChatPane}
      onMarkingContext={setMarkingContext}
      onScanExamReady={(examId) => {
        setScanBatch(prev => {
          if (!prev || prev.id !== scanBatch?.id) return prev;
          try { if (authenticatedUser?.id) sessionStorage.setItem(`bwenge.scan.exam:${authenticatedUser.id}`, examId); } catch {}
          return { ...prev, examId };
        });
      }}
      onCloseScanBatch={() => {
        setScanBatch(null);
        try { if (authenticatedUser?.id) sessionStorage.removeItem(`bwenge.scan.exam:${authenticatedUser.id}`); } catch {}
      }}
      examPaper={examPaper}
      setExamPaper={setExamPaper}
      uploadedFiles={uploadedFiles}
      documentViewMode={documentViewMode}
      onDocumentViewModeChange={setDocumentViewMode}
      studentScripts={studentScripts}
      setStudentScripts={setStudentScripts}
      onUploadStudentPaper={handleUploadStudentPaper}
      onOpenScanner={openScanner}
      onGenerateSampleBatch300={() => {
        const sampleBatch: UploadedFile[] = Array.from({ length: 5 }, (_, i) => ({
          id: `sample-${Date.now()}-${i}`,
          name: `Student_Paper_${i + 1}.txt`,
          url: '',
          fileType: 'text',
          rawText: `Sample student answer ${i + 1}`,
          studentName: `Student ${i + 1}`,
          batchBadge: '1',
        }));
        setUploadedFiles((prev) => [...sampleBatch, ...prev]);
      }}
      onTextSelection={(text: string, pos: { top: number; left: number }) => {
        setSelectedText(text);
        setSelectionPos(pos);
      }}
      onToggleSoftDelete={handleToggleSoftDelete}
      onToggleFlag={handleToggleFlag}
      onUpdateBonusMarks={handleUpdateBonusMarks}
      onDeletePermanently={handleDeletePermanently}
      activeDocument={activeDocument}
      pinnedSyllabusId={useStore.getState().pinnedSyllabusId}
      onPinSyllabus={(id) => useStore.getState().setPinnedSyllabusId(id)}
      studioProjectStatus={studioProjectStatus}
      savedStudioProjects={savedStudioProjects}
      onLoadStudioProject={(projId) => {}}
      externalGeneratedForm={scannerGeneratedForm}
      onClearExternalForm={() => setScannerGeneratedForm(null)}
      openFormRequest={openFormRequest}
    />
  );

  const resultsPane = (
    <SidebarResultsPanel
      batchTitle={examPaper?.title || 'Batch Results'}
      excelDownloadUrl={excelDownloadUrl}
      isGenerating={isGeneratingExcel}
      results={studentScripts.filter(script => script.totalAwardedMarks !== undefined).map((script) => ({
        id: script.studentId,
        name: script.studentName,
        score: script.totalAwardedMarks ?? 0,
        maxScore: script.maxTotalMarks ?? 0,
        status:
          script.flags && script.flags.length > 0
            ? 'Needs Review'
            : (script.percentage ?? 0) >= 50
            ? 'Passed'
            : 'Failed',
      }))}
      onClose={() => setActiveTab('documents')}
      onGenerateExcel={handleGenerateExcelExport}
    />
  );

  const studioProps = {
    messages,
    onSendMessage: handleSendMessage,
    onNewChat: handleNewChat,
    onLoadSession: handleLoadChatSession,
    onOpenSettings: () => setSettingsOpen(true),
    onOpenForms: () => {
      setActiveTab('marking_hub');
      setOpenFormRequest((request) => request + 1);
    },
    onDeleteChat: handleDeleteCurrentChat,
    onExportChat: handleExportChat,
    activeSessionId,
    currentChatTitle: chatSessions.find((session) => session.id === activeSessionId)?.title || '',
    onRenameChat: handleRenameCurrentChat,
    isTemporaryChat: temporaryChatMode,
    onToggleTemporaryChat: handleToggleTemporaryChat,
    onShare: handleShareChat,
    onLogout: handleLogout,
    isTyping: isAiThinking,
    onAbort: () => abortController?.abort(),
    selectedProvider,
    onProviderChange: setSelectedProvider,
    stagedAttachments,
    onStageAttachments: handleStageAttachments,
    attachmentError,
    onRemoveStagedAttachment: handleRemoveStagedAttachment,
    onOpenSidebar: () => setIsMobileSidebarOpen(true),
    onOpenScanner: openScanner,
    user: authenticatedUser,
    onOpenLoginModal: () => setLoginModalOpen(true),
    onPreviewDoc: (doc: any) => {
      setActiveDocument(doc);
      setActiveTab('marking_hub');
    },
    onFeedback: async (messageId: string, rating: 'up' | 'down', details: ResponseFeedbackDetails) => {
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0 || messages[messageIndex].sender !== 'assistant') {
        throw new Error('Could not find the AI response to attach feedback to.');
      }
      const question = messages
        .slice(0, messageIndex)
        .reverse()
        .find((message) => message.sender === 'user')?.text || '';
      await submitResponseFeedback(messageId, rating, {
        ...details,
        question: question.slice(0, 6_000),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, rating } : m))
      );
    },
    onRetry: (messageId: string) => {
      const lastUserMessage = [...messages].reverse().find((message) => message.sender === 'user');
      const retry = retryPromptRef.current;
      if (retry) void handleSendMessage(retry.text, retry.attachment, retry.options);
      else if (lastUserMessage) void handleSendMessage(lastUserMessage.text, lastUserMessage.attachments || lastUserMessage.attachment);
    },
    onUpgradeClick: (jobId: string, service: string) => {
      setUpgradeContext({ jobId, service });
      setUpgradeModalOpen(true);
    },
    userName: authenticatedUser?.name,
  };

  const openUpgradePage = (targetPlan?: 'individual' | 'business' | 'organisation') => {
    const selectedPlan = targetPlan || upgradeContext?.targetPlan || 'individual';
    const nextContext: { jobId?: string; service?: string; targetPlan: 'individual' | 'business' | 'organisation' } = selectedPlan === 'individual'
      ? { ...upgradeContext, targetPlan: selectedPlan }
      : { targetPlan: selectedPlan };
    setUpgradeContext(nextContext);
    const params = new URLSearchParams();
    if (nextContext.jobId) params.set('jobId', nextContext.jobId);
    if (nextContext.service) params.set('service', nextContext.service);
    if (nextContext.targetPlan) params.set('plan', nextContext.targetPlan);
    window.history.pushState({}, '', `/upgrade?${params.toString()}`);
    setUpgradePageOpen(true);
    setUpgradeModalOpen(false);
  };

  const closeUpgradePage = () => {
    window.history.replaceState({}, '', '/');
    setUpgradePageOpen(false);
  };

  const finishUpgrade = async () => {
    try {
      const response = await authFetch('/api/user/me');
      if (!response.ok) throw new Error('Payment succeeded, but account details could not be refreshed.');
      const data = await response.json();
      if (data.user) setAuthenticatedUser(data.user);
    } catch (error) {
      showAiStatus('warning', error instanceof Error ? error.message : 'Payment succeeded, but account details could not be refreshed.');
    }
    window.dispatchEvent(new Event('bwenge:usage'));
    closeUpgradePage();
    // If the chat stopped at a limit, carry on with that request right away (the server kept its files).
    const lastReply = [...messages].reverse().find((m) => m.sender === 'assistant');
    if (lastReply && /Limit reached/.test(String(lastReply.text ?? ''))) {
      showAiStatus('info', 'Payment received. Finishing your request…');
      setTimeout(() => { void handleSendMessage('continue'); }, 400);
    }
  };

  if (authenticatedUser && window.location.pathname === '/learn') {
    return <LearnPage onBack={() => { window.history.pushState({}, '', '/'); window.location.reload(); }} />;
  }

  const studioMatch = window.location.pathname.match(/^\/forms\/([^/?#]+)\/edit\/?$/);
  if (authenticatedUser && studioMatch) {
    return <FormStudioPage formId={decodeURIComponent(studioMatch[1])} onBack={() => { window.history.pushState({}, '', '/'); window.location.reload(); }} />;
  }

  if (authenticatedUser && /^\/exams(\/|$)/.test(window.location.pathname)) {
    return <ExamReviewPage onBack={() => { window.history.pushState({}, '', '/'); window.location.reload(); }} />;
  }

  if (upgradePageOpen && !authenticatedUser && authStatus === 'anonymous') {
    return (
      <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-5 bg-[#101114] p-6 text-center text-white">
        <h1 className="text-2xl font-semibold">Sign in to continue</h1>
        <p className="max-w-md text-sm leading-6 text-neutral-400">Your payment and upgrade are linked to your Bwenge account.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => { closeUpgradePage(); setLoginModalOpen(true); }} className="rounded-xl border border-white/10 px-5 py-3 text-sm text-neutral-200 hover:bg-white/5">Back and sign in</button>
          <button type="button" onClick={closeUpgradePage} className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-black hover:bg-amber-300">Back to workspace</button>
        </div>
      </div>
    );
  }

  if (upgradePageOpen && authenticatedUser) {
    return (
      <UpgradePage
        jobId={upgradeContext?.jobId}
        service={upgradeContext?.service}
        targetPlan={upgradeContext?.targetPlan}
        onBack={closeUpgradePage}
        onSuccess={() => { void finishUpgrade(); }}
      />
    );
  }

  if (curationOpen && authStatus === 'authenticated') {
    const leave = () => { setCurationOpen(false); window.history.replaceState({}, '', '/'); };
    return (
      <Suspense fallback={null}>
        {authenticatedUser?.role === 'ADMIN' ? <AdminPage onBack={leave} initialTab="datasets" /> : <CurationViewPage onBack={leave} />}
      </Suspense>
    );
  }

  if (adminOpen && authStatus === 'authenticated' && authenticatedUser?.role === 'ADMIN') {
    return (
      <Suspense fallback={null}>
        <AdminPage onBack={() => { setAdminOpen(false); window.history.replaceState({}, '', '/'); }} />
      </Suspense>
    );
  }

  if (publicFormLoading || publicFormError || publicForm) {
    return (
      <div className="min-h-[100dvh] w-full bg-[#F4F4F1] dark:bg-[#141416] text-slate-900 overflow-y-auto flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-black/10 bg-white/90 px-4 sm:px-8 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: publicForm?.themeColor || '#D97757' }} />
            <span className="text-sm font-bold text-slate-800 truncate">
              {publicForm?.title || 'Bwenge Form'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {publicForm?.id && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await copyToClipboard(new URL(`/forms/${encodeURIComponent(publicForm.id)}`, window.location.origin).toString());
                    setPublicFormLinkCopied(true);
                    window.setTimeout(() => setPublicFormLinkCopied(false), 1800);
                  } catch { showAiStatus('warning', 'Could not copy this form link'); }
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {publicFormLinkCopied ? 'Link copied' : 'Copy link'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setPublicForm(null);
                setPublicFormError('');
                setPublicFormLoading(false);
                window.history.pushState({}, '', '/');
              }}
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Back to Studio
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 sm:px-6">
          {publicFormLoading ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
              Loading form…
            </div>
          ) : publicFormError ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-8 text-center space-y-3 shadow-sm">
              <p className="text-base font-bold text-rose-600">{publicFormError}</p>
              <button
                type="button"
                onClick={() => {
                  setPublicForm(null);
                  setPublicFormError('');
                  window.history.pushState({}, '', '/');
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
              >
                Return to Bwenge Studio
              </button>
            </div>
          ) : (
            <Suspense fallback={<div className="mx-auto max-w-2xl p-8 text-center text-sm text-slate-500">Loading form…</div>}>
              <DynamicForm
                schema={publicForm}
                onSubmit={async (answers) => {
                  const res = await fetch(`/api/forms/${publicForm.id}/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ answers }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    throw new Error(data.error || 'Failed to submit form response.');
                  }
                  return data;
                }}
              />
            </Suspense>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="dark h-[var(--app-h,100dvh)] w-full min-w-0 bg-[#262624] text-[#FAF9F5] font-sans antialiased transition-colors duration-200 overflow-hidden flex flex-col">
      {AI_SCAN_ENABLED && scannerOpen && (
        <div className={`fixed inset-0 ${scanForMark ? 'z-[75]' : 'z-[70]'} bg-[#0f1013] flex flex-col w-full h-[var(--app-h,100dvh)] overflow-hidden animate-in fade-in duration-200`}>
          <DocumentScanner
            onClose={() => { setScannerOpen(false); setScanForMark(false); }}
            onSavePages={scanForMark
              ? async (pages) => {
                if (scanTarget !== 'scripts') {
                  const { buildPdf } = await import('./scanner/TelegramScanApp');
                  const name = scanTarget === 'paper' ? 'Question paper (photographed).pdf' : 'Marking scheme (photographed).pdf';
                  setMarkIncoming({ id: Date.now(), files: [new File([await buildPdf(pages)], name, { type: 'application/pdf' })], role: scanTarget });
                  return;
                }
                const { scansToZip } = await import('./utils/scansToZip');
                // Each student's first page comes back too, so the Mark page can show who was scanned.
                const byStudent = new Map<string, { name: string; pages: number; thumb: string }>();
                for (const p of pages) {
                  const key = p.candidateId ?? p.studentName ?? 'student';
                  const cur = byStudent.get(key);
                  if (cur) cur.pages++; else byStudent.set(key, { name: p.studentName ?? `Student ${byStudent.size + 1}`, pages: 1, thumb: p.dataUrl });
                }
                setMarkIncoming({ id: Date.now(), files: [await scansToZip(pages)], students: [...byStudent.values()] });
              }
              : handleSaveScannedPages}
            aiTools={!scanForMark}
            quick={scanForMark}
            single={scanForMark && scanTarget !== 'scripts' ? (scanTarget === 'paper' ? 'Question paper' : 'Marking scheme') : undefined}
            labels={scanForMark ? 'student' : undefined}
            saveLabel={scanForMark ? (scanTarget === 'scripts' ? 'Add to marking' : scanTarget === 'paper' ? 'Use as question paper' : 'Use as marking scheme') : undefined}
            activeRubricText={examPaper ? JSON.stringify(examPaper) : ''}
            onGeneratedForm={(form) => {
              setScannerGeneratedForm(form);
              setActiveTab('marking_hub');
              setScannerOpen(false);
            }}
            onSendToChatAgent={(prompt) => {
              setScannerOpen(false);
              void handleSendMessage(prompt);
            }}
          />
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden lg:flex-row min-h-0">
        <LeftSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenLibrary={() => { setLibraryTab('mine'); setLibraryOpen(true); }}
          onOpenPublicLibrary={() => { setLibraryTab('library'); setLibraryOpen(true); }}
          onOpenMark={() => setMarkOpen(true)}
          onOpenAssignments={() => setAssignmentsOpen({ id: null })}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          user={authenticatedUser}
          onOpenLoginModal={() => setLoginModalOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAdmin={() => {
            window.history.pushState({}, '', '/admin');
            setAdminOpen(true);
          }}
          onLogout={handleLogout}
          sessions={chatSessions}
          onLoadSession={handleLoadChatSession}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
        />

        {isMobileSidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          />
        )}

        {isMobile ? (
          <div className="relative min-h-0 min-w-0 flex-1 flex flex-col">
            <CreateStudio {...studioProps} />
            {activeTab !== 'documents' && (
              <MobileSheet
                hideHeader={!!scanBatch && activeTab === 'marking_hub'}
                title={activeTab === 'results' ? 'Results' : 'Marking workspace'}
                onBack={() => setActiveTab('documents')}
                onScan={openScanner}
              >
                {activeTab === 'results' ? resultsPane : workspacePane}
              </MobileSheet>
            )}
          </div>
        ) : activeTab === 'documents' ? (
          <div className="h-full flex-1 overflow-hidden">
            <CreateStudio {...studioProps} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            {!(scanBatch && activeTab === 'marking_hub') && (
            <TopNavbar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onNewChat={handleNewChat}
              onOpenSettings={() => setSettingsOpen(true)}
              onDeleteChat={handleClearCurrentChat}
              onExportChat={handleExportChat}
              onShare={() => {}}
              activeFormId={activeFormId}
              user={authenticatedUser}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            />
            )}

            <div className="relative flex min-h-0 flex-1 overflow-hidden lg:flex-row">
              <div className="min-h-0 min-w-0 border-r border-white/5 flex flex-1">
                {workspacePane}
              </div>

              <div className={`${scanBatch && activeTab === 'marking_hub' ? 'hidden' : 'flex'} h-full min-h-0 w-full min-w-0 flex-col border-l border-white/5 lg:w-[min(30vw,440px)] lg:flex-none`}>
                {scanBatch && activeTab === 'marking_hub' ? null : activeTab !== 'results' ? (
                  markingChatPane
                ) : (
                  <div className="flex h-full min-h-0 flex-col lg:pt-12">{resultsPane}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {loginModalOpen && (
          <LoginModal
            isOpen={loginModalOpen}
            onClose={() => {
              setLoginModalOpen(false);
              if (window.location.pathname === '/signup') {
                window.history.replaceState({}, '', '/');
              }
              setIsSignUpMode(false);
            }}
            defaultIsSignUp={isSignUpMode}
            onLoginSuccess={(u, t) => {
              setAuthenticatedUser(u);
              setAuthStatus('authenticated');
              setLoginModalOpen(false);
              setIsSignUpMode(false);
              if (window.location.pathname === '/signup') {
                window.history.replaceState({}, '', '/');
              }
              if (upgradeContext) openUpgradePage(upgradeContext.targetPlan);
            }}
          />
        )}
        {upgradeModalOpen && (
          <UpgradeSheet
            isOpen={upgradeModalOpen}
            onClose={() => setUpgradeModalOpen(false)}
            onSelectPlan={openUpgradePage}
          />
        )}
      </Suspense>
      {authenticatedUser && <Suspense fallback={null}><MarkingDrawer /></Suspense>}
      {authenticatedUser && assignmentsOpen && (
        <Suspense fallback={null}>
          <AssignmentsPage
            initialId={assignmentsOpen.id}
            autoMark={assignmentsOpen.mark}
            onClose={() => { setAssignmentsOpen(null); if (window.location.pathname.startsWith('/assignments')) window.history.replaceState({}, '', '/'); }}
            onMarkAll={(p) => {
              // The class goes to the Mark page as it is: one PDF per student, the task as the question paper,
              // and the students list so the results keep their names. The teacher adds the scheme there.
              setMarkIncoming({
                id: Date.now(), files: [],
                uploaded: [
                  ...p.task.map((f) => ({ fileId: f.id, name: f.name, mime: f.mime, size: f.size, role: 'paper' as const })),
                  ...p.scripts.map((f) => ({ fileId: f.id, name: f.name, mime: f.mime, size: f.size, role: 'scripts' as const, label: `${f.studentName} (${f.candidateId})` })),
                ],
                extras: [{ fileId: p.roster.id, name: p.roster.name, mime: p.roster.mime, size: p.roster.size }],
              });
              setAssignmentsOpen(null);
              setMarkOpen(true);
            }}
          />
        </Suspense>
      )}
      {authenticatedUser && markOpen && (
        <Suspense fallback={null}>
          <MarkPage
            onClose={() => { setMarkOpen(false); if (window.location.pathname === '/mark') window.history.replaceState({}, '', '/'); }}
            onMark={startMarking}
            onScan={openScanner ? (target) => { setScanTarget(target); setScanForMark(true); openScanner(); } : undefined}
            incoming={markIncoming}
            covered={scanForMark && scannerOpen}
          />
        </Suspense>
      )}
      {libraryOpen && (
        <Suspense fallback={null}>
          <OutputsLibrary initialTab={libraryTab} onClose={() => setLibraryOpen(false)} onAsk={(m) => { void handleSendMessage(m); }} />
        </Suspense>
      )}
      {settingsOpen && (
        <div className="fixed inset-0 z-[150] bg-[#FAF9F5]">
          <SettingsPage
            user={authenticatedUser}
            onUpdateUser={(u) => {
              setAuthenticatedUser(u);
              if (u.settings?.theme) setDarkMode(u.settings.theme === 'dark');
            }}
            onLogout={handleLogout}
            onBack={() => setSettingsOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
