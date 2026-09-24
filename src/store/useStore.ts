import { create } from 'zustand';
import { User, Message, ChatSession, ExamPaper, StudentScript, UploadedFile } from '../types';

interface AppState {
  // Auth
  user: User | null;
  token: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;

  // Chat
  messages: Message[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  lastInteractionId: string | null;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setSessions: (sessions: ChatSession[]) => void;
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
  activeTab: string;
  setActiveTab: (tab: string) => void;
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



  // Hydration & Optimistic UI
  hydrateSession: (sessionId: string) => Promise<void>;
  submitFeedback: (messageId: string, rating: 'up' | 'down') => void;
}

export const useStore = create<AppState>((set, get) => ({
  user: JSON.parse(localStorage.getItem('bwenge_user') || 'null'),
  token: localStorage.getItem('bwenge_auth_token'),
  setUser: (user) => {
    localStorage.setItem('bwenge_user', JSON.stringify(user));
    set({ user });
  },
  setToken: (token) => {
    if (token) localStorage.setItem('bwenge_auth_token', token);
    else localStorage.removeItem('bwenge_auth_token');
    set({ token });
  },
  logout: () => {
    localStorage.removeItem('bwenge_user');
    localStorage.removeItem('bwenge_auth_token');
    set({ user: null, token: null });
  },

  messages: JSON.parse(localStorage.getItem('bwenge_chat_history') || '[]'),
  sessions: JSON.parse(localStorage.getItem('bwenge_saved_sessions') || '[]'),
  activeSessionId: null,
  lastInteractionId: null,
  addMessage: (msg) => set((state) => {
    const nextMessages = [...state.messages, msg];
    localStorage.setItem('bwenge_chat_history', JSON.stringify(nextMessages));
    return { messages: nextMessages };
  }),
  setMessages: (messages) => set((state) => {
    const nextMessages = typeof messages === 'function' ? (messages as any)(state.messages) : messages;
    localStorage.setItem('bwenge_chat_history', JSON.stringify(nextMessages));
    return { messages: nextMessages };
  }),
  setSessions: (sessions) => set((state) => {
    const nextSessions = typeof sessions === 'function' ? (sessions as any)(state.sessions) : sessions;
    localStorage.setItem('bwenge_saved_sessions', JSON.stringify(nextSessions));
    return { sessions: nextSessions };
  }),
  setLastInteractionId: (id) => set({ lastInteractionId: id }),
  clearChat: () => {
    localStorage.removeItem('bwenge_chat_history');
    set({ messages: [], lastInteractionId: null });
  },


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
  setActiveTab: (activeTab) => set({ activeTab }),
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
      ...state.oracleInsights.slice(0, 9) // Keep last 10
    ]
  })),
  clearOracleInsights: () => set({ oracleInsights: [] }),

  pinnedSyllabusId: null,
  setPinnedSyllabusId: (pinnedSyllabusId) => set({ pinnedSyllabusId }),


  hydrateSession: async (sessionId) => {
    // Logic to fetch session state from server and set it locally
    // For now, we'll log it as a placeholder for the multi-agent backend connection.
    console.log(`Hydrating session: ${sessionId}`);
  },

  submitFeedback: (messageId, rating) => {
    // Optimistically update the message in state
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, rating } : m
      ),
    }));
    // Background request (silent)
    // authFetch('/api/ai/feedback', { method: 'POST', body: JSON.stringify({ messageId, rating }) });
  },
}));

