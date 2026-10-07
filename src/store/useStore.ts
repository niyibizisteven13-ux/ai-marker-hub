import { create } from 'zustand';
import { NavigationTab, User, Message, ChatSession, ExamPaper, StudentScript, UploadedFile } from '../types';
import { setAccessToken } from '../utils/authFetch';

interface AppState {
  // Auth
  user: User | null;
  authStatus: 'loading' | 'authenticated' | 'anonymous';
  setUser: (user: User | null) => void;
  setAuthStatus: (status: 'loading' | 'authenticated' | 'anonymous') => void;
  logout: () => void;

  // Chat
  messages: Message[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  lastInteractionId: string | null;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setSessions: (sessions: ChatSession[] | ((prev: ChatSession[]) => ChatSession[])) => void;
  setLastInteractionId: (id: string | null) => void;
  clearChat: () => void;

  // Exam & Marking
  examPaper: ExamPaper | null;
  uploadedFiles: UploadedFile[];
  studentScripts: StudentScript[];
  setExamPaper: (paper: ExamPaper | null) => void;
  setUploadedFiles: (files: UploadedFile[] | ((prev: UploadedFile[]) => UploadedFile[])) => void;
  setStudentScripts: (scripts: StudentScript[] | ((prev: StudentScript[]) => StudentScript[])) => void;

  // UI
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  activeFormId: string | null;
  setActiveFormId: (id: string | null) => void;
  isAiLoading: boolean;
  setIsAiLoading: (loading: boolean) => void;
  abortController: AbortController | null;
  setAbortController: (ac: AbortController | null) => void;

  aiDesignBuffer: any | null;
  setAiDesignBuffer: (design: any | null) => void;

  visualAnnotations: any[];
  addVisualAnnotation: (anno: any) => void;
  clearVisualAnnotations: () => void;

  agentStatus: string | null;
  setAgentStatus: (status: string | null) => void;

  chatSummary: string | null;
  setChatSummary: (summary: string | null) => void;

  oracleInsights: any[];
  addOracleInsight: (insight: any) => void;
  clearOracleInsights: () => void;

  pinnedSyllabusId: string | null;
  setPinnedSyllabusId: (id: string | null) => void;

  workspaceRestoreFailed: boolean;
  setWorkspaceRestoreFailed: (failed: boolean) => void;

  // Hydration & Optimistic UI
  hydrateSession: (sessionId: string) => Promise<void>;
  submitFeedback: (messageId: string, rating: 'up' | 'down') => void;
}

export const useStore = create<AppState>((set, get) => {
  // Clean up legacy localStorage tokens on boot
  if (typeof window !== 'undefined') {
    localStorage.removeItem('bwenge_user');
    localStorage.removeItem('bwenge_auth_token');
  }

  return {
    user: null,
    authStatus: 'loading',
    setUser: (user) => set({ user, authStatus: user ? 'authenticated' : 'anonymous' }),
    setAuthStatus: (authStatus) => set({ authStatus }),
    logout: () => {
      setAccessToken(null);
      set({
        user: null,
        authStatus: 'anonymous',
        messages: [],
        sessions: [],
        activeSessionId: null,
        lastInteractionId: null,
        examPaper: null,
        uploadedFiles: [],
        studentScripts: [],
        aiDesignBuffer: null,
        visualAnnotations: [],
        chatSummary: null,
        oracleInsights: [],
        pinnedSyllabusId: null,
        workspaceRestoreFailed: false,
      });
      if (typeof window !== 'undefined') {
        localStorage.clear();
        try {
          const channel = new BroadcastChannel('bwenge-auth');
          channel.postMessage({ type: 'LOGOUT' });
          channel.close();
        } catch {}
      }
    },

    messages: [],
    sessions: [],
    activeSessionId: null,
    lastInteractionId: null,
    addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
    setMessages: (messages) => set((state) => ({
      messages: typeof messages === 'function' ? (messages as any)(state.messages) : messages
    })),
    setSessions: (sessions) => set((state) => ({
      sessions: typeof sessions === 'function' ? (sessions as any)(state.sessions) : sessions
    })),
    setLastInteractionId: (id) => set({ lastInteractionId: id }),
    clearChat: () => set({ messages: [], lastInteractionId: null }),

    examPaper: null,
    uploadedFiles: [],
    studentScripts: [],
    setExamPaper: (examPaper) => set({ examPaper }),
    setUploadedFiles: (updater) => set((state) => ({
      uploadedFiles: typeof updater === 'function' ? updater(state.uploadedFiles) : updater
    })),
    setStudentScripts: (updater) => set((state) => ({
      studentScripts: typeof updater === 'function' ? updater(state.studentScripts) : updater
    })),

    activeTab: 'documents',
    setActiveTab: (activeTab: NavigationTab) => set({ activeTab }),
    activeFormId: null,
    setActiveFormId: (activeFormId) => set({ activeFormId }),
    isAiLoading: false,
    setIsAiLoading: (isAiLoading) => set({ isAiLoading }),

    abortController: null,
    setAbortController: (abortController) => set({ abortController }),

    aiDesignBuffer: null,
    setAiDesignBuffer: (aiDesignBuffer) => set({ aiDesignBuffer }),

    visualAnnotations: [],
    addVisualAnnotation: (anno) => set((state) => ({
      visualAnnotations: [...state.visualAnnotations, { ...anno, id: 'ai-anno-' + Date.now() }]
    })),
    clearVisualAnnotations: () => set({ visualAnnotations: [] }),

    agentStatus: null,
    setAgentStatus: (agentStatus) => set({ agentStatus }),

    chatSummary: null,
    setChatSummary: (chatSummary) => set({ chatSummary }),

    oracleInsights: [],
    addOracleInsight: (insight) => set((state) => ({
      oracleInsights: [
        { ...insight, id: 'insight-' + Date.now(), timestamp: new Date().toLocaleTimeString() },
        ...state.oracleInsights.slice(0, 9)
      ]
    })),
    clearOracleInsights: () => set({ oracleInsights: [] }),

    pinnedSyllabusId: null,
    setPinnedSyllabusId: (pinnedSyllabusId) => set({ pinnedSyllabusId }),

    workspaceRestoreFailed: false,
    setWorkspaceRestoreFailed: (workspaceRestoreFailed) => set({ workspaceRestoreFailed }),

    hydrateSession: async (sessionId) => {
      console.log(`Hydrating session: ${sessionId}`);
    },

    submitFeedback: (messageId, rating) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === messageId ? { ...m, rating } : m
        ),
      }));
    },
  };
});
