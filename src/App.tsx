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
import SettingsModal from './components/SettingsModal';
import RightChatSidebar from './components/RightChatSidebar';
import { SidebarResultsPanel } from './components/SidebarResultsPanel';
import { FloatingSmartToolbar } from './components/FloatingSmartToolbar';
import { HardwareToast } from './components/HardwareToast';
import DocumentScanner from './components/DocumentScanner';
import { processFileClientSide } from './utils/fileProcessor';
import { authFetch } from './utils/authFetch';
import { buildExamPaperContext } from './utils/contentAwarePrompt';
import { classifyIntent, localGreetingReply } from './utils/messageIntent';
import CreateStudio from './components/CreateStudio';
import { Menu, X, Plus, Sparkles } from 'lucide-react';
import UpgradePage from './pages/UpgradePage';

const LoginModal = React.lazy(() => import('./components/LoginModal'));
const UpgradeModal = React.lazy(() => import('./components/UpgradeModal'));


import { Suspense } from 'react';

const CHAT_HISTORY_KEY = 'bwenge_chat_history';
const CHAT_SESSIONS_KEY = 'bwenge_saved_sessions';

const normalizeInitialMessages = (loadedMessages: Message[]): Message[] => {
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
  });
};

export default function App() {
  const {
    user: authenticatedUser,
    setUser: setAuthenticatedUser,
    token: authToken,
    setToken: setAuthToken,
    logout: logoutStore,
    messages,
    setMessages,
    addMessage,
    sessions: chatSessions,
    setSessions: setChatSessions,
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
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<{ type: 'info' | 'warning'; message: string } | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState<boolean>(false);
  const [upgradeContext, setUpgradeContext] = useState<{ jobId?: string; service?: string; targetPlan?: string; amount?: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('auto');

  const [activeDocument, setActiveDocument] = useState<any>(null);
  const [stagedAttachments, setStagedAttachments] = useState<Array<File | ChatAttachment>>([]);


  const saveCurrentChatSession = () => {
    if (!messages || messages.length === 0) return;

    const sessionTitle = messages.find((msg) => msg.sender === 'user')?.text?.slice(0, 60) || `Marking session ${new Date().toLocaleString()}`;
    const session: ChatSession = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `session-${Date.now()}`,
      title: sessionTitle,
      date: new Date().toLocaleString(),
      messageCount: messages.length,
      messages,
      lastInteractionId,
    };

    const nextSessions = [session, ...chatSessions].slice(0, 20);
    setChatSessions(nextSessions);
  };



  const handleLoadChatSession = (sessionId: string) => {
    const session = chatSessions.find((item) => item.id === sessionId);
    if (session) {
      setMessages(session.messages);
      setLastInteractionId(session.lastInteractionId || null);
    }
  };


  const handleLoginSuccess = (user: User, token: string) => {
    setAuthenticatedUser(user);
    setAuthToken(token);
  };

  const handleUpdateUser = (updatedUser: User) => {
    setAuthenticatedUser(updatedUser);
  };



  const fetchCurrentUser = async () => {
    try {
      const res = await authFetch('/api/user/me');
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          setAuthenticatedUser(data.user);
          try {
            localStorage.setItem('bwenge_user', JSON.stringify(data.user));
          } catch {
            // ignore localStorage failures
          }
        }
      }
    } catch {
      // ignore fetch failures
    }
  };

  useEffect(() => {
    if (authToken && !authenticatedUser) {
      fetchCurrentUser();
    }
  }, [authToken]);

  const handleLogout = () => {
    logoutStore();
    setLoginModalOpen(false);
    setSettingsOpen(false);
  };

  const handleUpgrade = async (plan: string) => {
    if (plan === 'individual') {
      setUpgradeModalOpen(false);
      showAiStatus('info', 'Individual batch pricing is applied automatically when marking.');
    } else if (plan === 'business') {
      setUpgradeModalOpen(false);
      setUpgradeContext({ targetPlan: 'business' });
    } else if (plan === 'organisation') {
      setUpgradeModalOpen(false);
      const amountStr = window.prompt("Enter Institution Top-up amount ($):", "50");
      if (amountStr && !isNaN(parseFloat(amountStr))) {
        setUpgradeContext({ targetPlan: 'organisation', amount: parseFloat(amountStr) });
      }
    }
  };

  const uploadAttachmentToServer = async (file: File, tempId: string) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      });
      const data = await response.json();
      if (data.success) {
        setStagedAttachments((prev) =>
          prev.map((att) => att.id === tempId ? { ...att, serverId: data.fileId, status: 'ready' } as ChatAttachment : att)
        );
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Upload failed', error);
      setStagedAttachments((prev) =>
        prev.map((att) => att.id === tempId ? { ...att, status: 'failed' } as ChatAttachment : att)
      );
    }
  };

  const handleStageAttachments = async (attachments: Array<File | ChatAttachment>) => {
    const newAttachments: ChatAttachment[] = await Promise.all(attachments.map(async (att) => {
      if (att instanceof File) {
        const processed = await processFileClientSide(att);
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Trigger background upload
        uploadAttachmentToServer(att, tempId);

        return {
          id: tempId,
          name: att.name,
          size: `${Math.round(att.size / 1024)} KB`,
          type: att.type,
          fileType: processed.fileType as any,
          url: processed.url,
          rawText: processed.rawText,
          htmlContent: processed.htmlContent,
          status: 'uploading'
        };
      }
      return att;
    }));

    setStagedAttachments((prev) => [...prev, ...newAttachments]);
    if (newAttachments.length > 0) {
      setActiveDocument(newAttachments[0]);
    }
  };

  const handleRemoveStagedAttachment = (index: number) => {
    setStagedAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClearStagedAttachments = () => {
    setStagedAttachments([]);
  };

  const handleNewChat = () => {
    saveCurrentChatSession();
    setMessages([]);
    handleClearStagedAttachments();
  };

  const handleShare = async () => {
    if (!activeFormId) return;

    // USSD Instruction according to Master Plan (Product B collects via USSD only)
    const ussdMessage = `Apply to this program via USSD: Dial *801*11# and enter code: ${activeFormId}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Application Instructions',
          text: ussdMessage,
        });
      } catch (err) {
        console.log('Web Share aborted or failed:', err);
      }
    } else {
      navigator.clipboard.writeText(ussdMessage);
      showAiStatus('info', 'USSD instructions copied to clipboard!');
    }
  };

  const handleExportChat = () => {
    if (messages.length === 0) return;
    const chatText = messages
      .map((msg) => `${msg.sender.toUpperCase()}: ${msg.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(chatText);
    showAiStatus('info', 'Conversation exported to clipboard');
  };

  const handleClearCurrentChat = () => {
    clearChatStore();
    handleClearStagedAttachments();
  };

  const handleInsightAction = async (action: string, insight: any) => {
    if (action === 'DRAFT REMEDIATION') {
      const prompt = `Based on the critical gap detected: "${insight.content}", please draft a 15-minute remediation lesson plan. Focus on correcting the specific student misconceptions mentioned. Use the active assessment context.`;
      handleSendMessage(prompt);
      // Automatically switch to chat view to see the result
      setActiveTab('marking_hub');
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

  const buildChatAttachmentFromFile = async (file: File): Promise<ChatAttachment> => {
    const processed = await processFileClientSide(file);
    const base64Data = await convertFileToBase64(file);
    const normalizedMimeType = file.type === 'image/jfif' ? 'image/jpeg' : file.type || 'application/octet-stream';
    return {
      id: `${Date.now()}_file`,
      name: file.name,
      size: `${(file.size / 1024).toFixed(0)} KB`,
      type: file.name.split('.').pop()?.toUpperCase() || 'DOCX',
      mimeType: normalizedMimeType,
      fileType: processed.fileType || 'document',
      url: processed.url,
      rawText: processed.rawText,
      base64Data,
    };
  };

  const handleSendMessage = async (
    userText: string,
    attachment?: File | ChatAttachment | Array<File | ChatAttachment>,
  ) => {
    const attachmentsArray = Array.isArray(attachment) ? attachment : attachment ? [attachment] : undefined;
    if (!userText.trim() && (!attachmentsArray || attachmentsArray.length === 0)) return;

    const normalizedUserText = userText.trim();
    let attachmentData: ChatAttachment | undefined = undefined;
    let attachmentsData: ChatAttachment[] | undefined = undefined;
    let userPrompt = normalizedUserText;

    if (attachmentsArray && attachmentsArray.length > 0) {
      const convertedAttachments = await Promise.all(
        attachmentsArray.map(async (item) => {
          if (item instanceof File) {
            return await buildChatAttachmentFromFile(item);
          }
          return item;
        })
      );
      attachmentsData = convertedAttachments;
      attachmentData = convertedAttachments[0];
    }

    const docToMark = attachmentData || activeDocument;
    const intent = classifyIntent(normalizedUserText, Boolean(docToMark));

    const randomSuffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
    const userMsgId = `user-${Date.now()}-${randomSuffix}`;
    const newUserMessage: Message = {
      id: userMsgId,
      sender: 'user',
      text: userPrompt,
      attachment: attachmentData,
      attachments: attachmentsData,
      timestamp: 'Just now',
    };

    setMessages((prev: any) => [...prev, newUserMessage]);

    // Only short-circuit very basic greetings if it's the start of a chat.
    // More complex greetings or conversational greetings go to the LLM.
    if (intent === 'greeting' && (messages.length === 0 || normalizedUserText.length < 5)) {
      const greetingReply: Message = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: localGreetingReply(docToMark?.name || docToMark?.fileName),
        timestamp: 'Just now',
      };

      setMessages((prev: any) => [...prev, greetingReply]);
      setAiServiceState('ready');
      return;
    }


    const buildContextAwarePayload = () => {
      const examContext = buildExamPaperContext(examPaper);
      const submissionText = docToMark?.rawText || '';
      const submissionName = docToMark?.name || 'Active submission';
      const selectedEvidence = selectedText?.trim() ? selectedText : '';

      const serverAttachments = stagedAttachments.filter(att => (att as ChatAttachment).serverId);
      const attachmentIds = serverAttachments.map(att => (att as ChatAttachment).serverId);

      // HYBRID CONTEXT SYNTHESIS (Pillar 5)
      // If we have a summary, prepend it to the history.
      const summary = useStore.getState().chatSummary;
      const pinnedId = useStore.getState().pinnedSyllabusId;
      const pinnedFile = pinnedId ? uploadedFiles.find(f => f.id === pinnedId) : null;

      const historyPrefix = summary ? [{ role: 'system', text: `CONVERSATION SUMMARY (Memory): ${summary}` }] : [];

      return {
        query: userPrompt,
        fileContext: attachmentIds.length > 0 ? null : (submissionText || null),
        documentContext: submissionName || null,
        examContext: examContext || null,
        pinnedSyllabus: pinnedFile ? `PINNED SYLLABUS/RUBRIC: ${pinnedFile.rawText || pinnedFile.name}` : null,
        selectedEvidence: selectedEvidence || null,
        replyTo: null,
        // Only send base64 if not yet uploaded to server
        attachmentBase64: attachmentIds.length > 0 ? null : (docToMark?.base64Data || null),
        attachmentMimeType: docToMark?.mimeType || null,
        attachmentName: docToMark?.name || null,
        attachmentText: attachmentIds.length > 0 ? null : (docToMark?.rawText || null),
        previousInteractionId: lastInteractionId,
        history: [...historyPrefix, ...messages.slice(-4)].map(m => ({
           role: m.sender === 'user' ? 'user' : 'assistant',
           text: m.text
        })),
        activeFormId,
        provider: (selectedProvider && selectedProvider !== 'auto') ? selectedProvider : undefined,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      };
    };




    if (attachmentsData) {
      setUploadedFiles((prev) => [
        ...prev,
        ...attachmentsData.map((item) => ({
          id: item.id,
          name: item.name,
          fileType: (item.fileType as UploadedFile['fileType']) || 'text',
          url: item.url || '',
          rawText: item.rawText || '',
          isSoftDeleted: false,
        })),
      ]);
      setActiveDocument(attachmentData);
    }

    const { setAiDesignBuffer, addVisualAnnotation, setAgentStatus } = useStore.getState();

    try {
      setIsAiThinking(true);
      const controller = new AbortController();
      setAbortController(controller);

      const payload = buildContextAwarePayload();
      const formData = new FormData();

      // Add text fields
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== null && key !== 'history') {
          formData.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
      });

      if (payload.history) {
        formData.append('history', JSON.stringify(payload.history));
      }

      // Add actual file if present in stagedAttachments or attachment data
      if (attachmentsArray && attachmentsArray.length > 0) {
        attachmentsArray.forEach((att) => {
          if (att instanceof File) {
            formData.append('attachment', att);
          }
        });
      }

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          setMessages((prev: any) => [...prev, {
            id: `assistant-${Date.now()}`,
            sender: 'assistant',
            text: "🔒 **Authentication Required**: Please Log In or Register using the button in the sidebar to talk with Bwenge AI.",
            timestamp: 'Just now',
          }]);
          setAbortController(null);
          return;
        }

        const errorData = await response.json().catch(() => ({}));
        setMessages((prev: any) => [...prev, {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: `❌ **Error**: ${errorData.error || response.statusText || 'Failed to connect to AI server.'}`,
          timestamp: 'Just now',
        }]);
        setAiServiceState('offline');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to start stream reader');

      const decoder = new TextDecoder();
      let assistantText = '';
      let assistantThinkingText = '';
      const assistantMsgId = `assistant-${Date.now()}`;
      let buffer = '';

      // Initialize assistant message with streaming state
      setMessages((prev: any) => [...prev, {
        id: assistantMsgId,
        sender: 'assistant',
        text: '',
        thinkingText: '',
        timestamp: 'Just now',
        isStreaming: true,
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);

              // 1. Handle specialized tool/agent events
              if (data.type === 'tool_call') {
                const toolName = data.name || 'System Tool';
                const statusIcon = data.status === 'started' ? '🏗️' : '🔄';
                assistantThinkingText += `\n> ${statusIcon} **Tool**: \`${toolName}\`...\n`;
                if (data.agent) setAgentStatus(`Agent: ${data.agent} is using ${toolName}`);
              } else if (data.type === 'tool_result') {
                assistantThinkingText += `\n> ✅ **Result**: \`${data.name || 'Task'}\` completed.\n`;
              } else if (data.text) {
                if (data.isThinking) {
                  assistantThinkingText += data.text;
                } else {
                  assistantText += data.text;
                }

                // --- STREAMING JSON PARSER (Partial Schema) ---
                const formTag = '<form_schema>';
                const endTag = '</form_schema>';
                const startIdx = assistantText.indexOf(formTag);

                if (startIdx !== -1) {
                  let rawJson = '';
                  const endIdx = assistantText.indexOf(endTag, startIdx);

                  if (endIdx !== -1) {
                    rawJson = assistantText.slice(startIdx + formTag.length, endIdx);
                  } else {
                    rawJson = assistantText.slice(startIdx + formTag.length);
                  }

                  if (rawJson.trim()) {
                    try {
                      // Attempt to parse partial JSON by closing open braces/brackets
                      let cleanJson = rawJson.trim();
                      const openBraces = (cleanJson.match(/\{/g) || []).length;
                      const closeBraces = (cleanJson.match(/\}/g) || []).length;
                      const openBrackets = (cleanJson.match(/\[/g) || []).length;
                      const closeBrackets = (cleanJson.match(/\]/g) || []).length;

                      cleanJson += '}'.repeat(Math.max(0, openBraces - closeBraces));
                      cleanJson += ']'.repeat(Math.max(0, openBrackets - closeBrackets));

                      const schema = JSON.parse(cleanJson);
                      setAiDesignBuffer(schema);
                      if (activeTab !== 'marking_hub') setActiveTab('marking_hub');
                    } catch (e) { /* silent fail on partial json */ }
                  }
                }

                // Intercept Visual Annotations
                const annotationMatch = assistantText.match(/<visual_annotation>([\s\S]*?)<\/visual_annotation>/);
                if (annotationMatch) {
                   try {
                     const anno = JSON.parse(annotationMatch[1]);
                     addVisualAnnotation(anno);
                     assistantText = assistantText.replace(/<visual_annotation>[\s\S]*?<\/visual_annotation>/g, '');
                   } catch (e) {}
                }

                // Detect Sub-Agent Status
                const statusMatch = assistantText.match(/> (🕵️|🏗️|🔍|🏗️|🚀) \*\*(.*?)\*\*: (.*)/);
                if (statusMatch) {
                   setAgentStatus(`${statusMatch[2]}: ${statusMatch[3]}`.slice(0, 50));
                }
              }

              // 2. Handle Proactive Insights (SSE event type)
              if (data.type === 'insight') {
                 useStore.getState().addOracleInsight(data.insight);
              }

              // Update messages state
              setMessages((prev: any) =>
                prev.map((msg: any) =>
                  msg.id === assistantMsgId ? {
                    ...msg,
                    text: assistantText,
                    thinkingText: assistantThinkingText,
                    isThinking: data.isThinking ?? msg.isThinking,
                    gated: data.gated || msg.gated,
                    provider: data.provider || msg.provider,
                    taskId: data.taskId || msg.taskId,
                  } : msg
                )
              );
              setAiServiceState('ready');

              if (data.error) {
                assistantText = `❌ **Error**: ${data.error}`;
                setMessages((prev: any) =>
                  prev.map((msg: any) =>
                    msg.id === assistantMsgId ? { ...msg, text: assistantText, isStreaming: false } : msg
                  )
                );
              }
            } catch (e) {
              // Ignore partial JSON
            }
          }
        }
      }

      // Mark streaming as complete
      setMessages((prev: any) =>
        prev.map((msg: any) =>
          msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
        )
      );

      // ROLLING CONTEXT SUMMARIZATION (Trigger every 5 messages)
      if (messages.length > 0 && messages.length % 5 === 0) {
        const { chatSummary, setChatSummary } = useStore.getState();
        const convoToSummarize = messages.slice(-10).map(m => `${m.sender.toUpperCase()}: ${m.text}`).join('\n');

        fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `Summarize this conversation segment concisely. Current Summary: ${chatSummary || 'None'}\n\nNEW CONVERSATION:\n${convoToSummarize}`,
            extractSchema: '{"summary": "string"}',
            service: 'general'
          })
        }).then(res => res.json()).then(data => {
           if (data.summary) setChatSummary(data.summary);
        }).catch(e => console.error('Silent summarization failed', e));
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Stream aborted by user');
      } else {
        console.error('Streaming failed', error);
        setAiServiceState('degraded');
        showAiStatus('warning', 'AI service is unreachable.');
      }
    } finally {
      setIsAiThinking(false);
      setIsAiLoading(false);
      setAbortController(null);
    }


  };

  const buildOfflineMockResponse = (query: string, document: any) => {
    const docLabel = document?.name || document?.fileName || 'your uploaded submission';
    const summaryScore = Math.max(60, Math.min(95, 80 + Math.floor(Math.random() * 10) - 5));
    return `Offline demo mode: I generated a placeholder marking summary for ${docLabel}.

You asked: "${query}"

- Estimated score: ${summaryScore}/100
- Strengths: clear structure, organized responses, and strong reasoning in several sections.
- Suggestions: verify calculations and provide a concise conclusion.

This is a demo response while the AI service is unavailable. Retry when the engine reconnects for a final grading report.`;
  };

  const getAssessmentLabel = (fallback = 'Current assessment') => examPaper?.title || examPaper?.subject || fallback;
  const showAiStatus = (type: 'info' | 'warning', message: string) => {
    setAiStatus({ type, message });
    window.clearTimeout((showAiStatus as any)._timer);
    (showAiStatus as any)._timer = window.setTimeout(() => setAiStatus(null), 5000);
  };

  useEffect(() => {
    (window as any).openUpgradeModal = () => setUpgradeModalOpen(true);
    return () => { delete (window as any).openUpgradeModal; };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('darkMode', String(darkMode)); } catch {}
  }, [darkMode]);


  const addAiCard = (card: AICard) => {
    setAiCards((prev) => [card, ...prev]);
  };

  const handleCloseToolbar = () => {
    setSelectedText('');
    setSelectionPos(null);
  };

  const handleHighlight = (color: HighlightColor) => {
    if (!selectedText) return;
    const newHighlight: DocumentHighlight = {
      id: 'hl-' + Date.now(),
      docId: examPaper?.id || 'doc-1',
      docTitle: getAssessmentLabel('AI Marker Hub Document'),
      text: selectedText,
      color,
      createdAt: 'Just now',
      category: 'Text Highlight',
    };
    setHighlights((prev) => [newHighlight, ...prev]);
    addAiCard({
      id: 'card-' + Date.now(),
      type: 'summary',
      title: 'Highlight Captured',
      content: `Saved highlight "${selectedText.slice(0, 80)}..." in ${color.toUpperCase()} color.`,
      sourceText: selectedText,
      timestamp: 'Just now',
    });
    handleCloseToolbar();
  };

  const isPlaceholderText = (text: string) => {
    return /^(\[(PDF Document|Scanned Image \/ OCR Extract|Word Document|Presentation Deck|Spreadsheet|Source Code|File:)|Extracted text from\b)/i.test(text.trim());
  };

  const stripHtml = (html: string) => {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const buildStudentFileContext = () => {
    if (!uploadedFiles || uploadedFiles.length === 0) return null;

    const validFile = uploadedFiles.find((file) => {
      const rawText = file.rawText?.trim() || '';
      const htmlText = file.htmlContent ? stripHtml(file.htmlContent) : '';
      if (rawText && !isPlaceholderText(rawText)) return true;
      if (htmlText) return true;
      return false;
    });

    if (!validFile) return null;

    const rawText = validFile.rawText?.trim() || '';
    const htmlText = validFile.htmlContent ? stripHtml(validFile.htmlContent) : '';

    let fileText = '';
    if (rawText && !isPlaceholderText(rawText)) {
      fileText = rawText;
    } else if (htmlText) {
      fileText = htmlText;
    }

    if (!fileText) return null;

    const preview = fileText.length > 2500 ? `${fileText.slice(0, 2500)}\n\n[...content truncated]` : fileText;
    return `Uploaded student file content (extracted text):\n${preview}`;
  };

  const handleAskAI = async (query: string, attachments?: File[], replyTo?: string) => {
    if (!query.trim()) return;
    setIsAiLoading(true);
    try {
      const studentFileContext = buildStudentFileContext();
      let attachmentContext: string | null = null;

      if (attachments && attachments.length > 0) {
        const attachmentTexts = await Promise.all(
          attachments.map(async (file, index) => {
            const processed = await processFileClientSide(file);
            const content = processed.rawText?.trim() || `${processed.fileType.toUpperCase()} file attached: ${file.name}`;
            return `Attachment ${index + 1} (${file.name}):\n${content}`;
          })
        );
        attachmentContext = attachmentTexts.join('\n\n');
      }

      const combinedFileContext = [attachmentContext, studentFileContext].filter(Boolean).join('\n\n') || null;
      const payload: Record<string, string | null> = {
        query,
        fileContext: combinedFileContext,
        documentContext: null,
        replyTo: replyTo || null,
      };
      if (!combinedFileContext) {
        payload.documentContext = examPaper?.title || null;
      }
      const res = await authFetch('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const aiContent = data.answer?.trim() || data.error || 'AI did not return a valid answer. Please check the backend logs.';
      const providerSuffix = data.provider ? ` [${data.provider}]` : '';
      if (data.provider === 'Fallback' || data.success === false) {
        showAiStatus('warning', 'Critical review mode is active. Use the rubric, student evidence, and teacher judgment for the next step.');
      } else {
        showAiStatus('info', 'AI assistant is ready for structured analysis.');
      }
      addAiCard({
        id: 'chat-' + Date.now(),
        type: 'chat',
        role: 'assistant',
        title: `AI${providerSuffix}`,
        content: aiContent,
        timestamp: 'Just now',
      });
    } catch (error: any) {
      showAiStatus('warning', 'AI analysis is temporarily unavailable. Continue with rubric-based review and human judgment.');
      addAiCard({
        id: 'chat-' + Date.now(),
        type: 'chat',
        role: 'assistant',
        title: 'AI',
        content: error?.message || 'AI chat request failed.',
        timestamp: 'Just now',
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSummarize = async (text: string) => {
    if (!text.trim()) return;
    setIsAiLoading(true);
    handleCloseToolbar();
    try {
      const res = await authFetch('/api/ai/summarize', {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      addAiCard({
        id: 'summary-' + Date.now(),
        type: 'summary',
        title: 'Text Summary',
        content: data.summary || 'Summary generated.',
        sourceText: text,
        timestamp: 'Just now',
      });
    } catch (error: any) {
      addAiCard({
        id: 'summary-' + Date.now(),
        type: 'summary',
        title: 'Text Summary',
        content: error?.message || 'Failed to summarize text.',
        sourceText: text,
        timestamp: 'Just now',
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleTranslate = async (text: string, targetLanguage: string) => {
    if (!text.trim()) return;
    setIsAiLoading(true);
    handleCloseToolbar();
    try {
      const res = await authFetch('/api/ai/translate', {
        method: 'POST',
        body: JSON.stringify({ text, targetLanguage }),
      });
      const data = await res.json();
      addAiCard({
        id: 'trans-' + Date.now(),
        type: 'translation',
        title: `Translation (${targetLanguage})`,
        content: data.translation || `Translated to ${targetLanguage}.`,
        sourceText: text,
        timestamp: 'Just now',
        language: targetLanguage,
      });
    } catch (error: any) {
      addAiCard({
        id: 'trans-' + Date.now(),
        type: 'translation',
        title: `Translation (${targetLanguage})`,
        content: error?.message || 'Translation failed.',
        sourceText: text,
        timestamp: 'Just now',
        language: targetLanguage,
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleCaptureFlashcard = (text: string) => {
    handleCloseToolbar();
    const newFlashcard: Flashcard = {
      id: 'fc-' + Date.now(),
      deckId: decks[0]?.id || 'deck-physics',
      front: `Captured from selected text.`,
      back: text,
      sourceDocTitle: getAssessmentLabel('AI Marker Hub Document'),
      createdAt: 'Just now',
    };
    setFlashcards((prev) => [newFlashcard, ...prev]);
    addAiCard({
      id: 'fc-card-' + Date.now(),
      type: 'flashcard',
      title: 'Captured to Study Deck',
      content: 'Added a new flashcard from selected text.',
      sourceText: text,
      timestamp: 'Just now',
    });
  };

  const handleExportMarkdown = (text: string) => {
    const md = `> "${text}"\n\n*Source: ${examPaper?.title || 'AI Marker Hub Document'}*`;
    navigator.clipboard.writeText(md);
    addAiCard({
      id: 'md-' + Date.now(),
      type: 'notion',
      title: 'Markdown Copied',
      content: 'Copied markdown citation to clipboard.',
      sourceText: text,
      timestamp: 'Just now',
    });
    handleCloseToolbar();
  };

  const handleMarkScript = async (script: StudentScript) => {
    if (!examPaper) return;
    setIsAiLoading(true);
    try {
      const res = await authFetch('/api/mark-script', {
        method: 'POST',
        body: JSON.stringify({ examPaper, studentScript: script }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.markedScript) {
        setStudentScripts((prev) => prev.map((item) => (item.id === script.id ? data.markedScript : item)));
        if (data.providers?.includes('fallback') || data.providerWarnings?.length) {
          showAiStatus('warning', 'AI marking is in fallback mode. This script is ready for rubric-based human review and critical feedback.');
        }
        addAiCard({
          id: 'mark-' + Date.now(),
          type: 'chat',
          title: `Marked ${script.studentName}`,
          content: `Bwenge AI marked script with ${data.markedScript.totalAwardedMarks}/${data.markedScript.maxTotalMarks}.`,
          sourceText: script.rawText || '',
          timestamp: 'Just now',
        });
      } else {
        throw new Error(data.error || 'Marking failed.');
      }
    } catch (error: any) {
      showAiStatus('warning', 'The marking flow is unavailable right now. Continue with manual review and rubric-based analysis.');
      addAiCard({
        id: 'mark-error-' + Date.now(),
        type: 'chat',
        title: `Marking failed for ${script.studentName}`,
        content: error?.message || 'Marking workflow failed.',
        sourceText: script.rawText || '',
        timestamp: 'Just now',
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleUploadStudentPaper = async (filesInput: File[] | FileList | File) => {
    let rawFiles: File[] = [];
    if (filesInput instanceof File) rawFiles = [filesInput];
    else rawFiles = Array.from(filesInput);
    if (rawFiles.length === 0) return;

    const parsedFiles: UploadedFile[] = [];
    const parsedScripts: StudentScript[] = [];

    for (const file of rawFiles) {
      const processed = await processFileClientSide(file);
      const uploadedFile: UploadedFile = {
        id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: file.name,
        url: processed.url,
        fileType: processed.fileType,
        rawText: processed.rawText,
        htmlContent: processed.htmlContent,
        studentName: file.name.replace(/\.[^/.]+$/, ''),
        batchBadge: '1',
      };
      parsedFiles.push(uploadedFile);

      // Build per-question answers by splitting raw text on question markers
      const fullText = processed.rawText || '';
      const answers = examPaper?.questions.map((q, qi) => {
        // Try to extract the section between this question marker and the next
        const markers = examPaper.questions.map((qq) => qq.number);
        const currentMarker = markers[qi];
        const nextMarker = markers[qi + 1];
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const startPattern = new RegExp(escapeRegex(currentMarker) + '[:\\s.)]', 'i');
        const startMatch = fullText.search(startPattern);
        let answerText = '';
        if (startMatch !== -1) {
          const fromStart = fullText.slice(startMatch);
          if (nextMarker) {
            const endPattern = new RegExp(escapeRegex(nextMarker) + '[:\\s.)]', 'i');
            const endMatch = fromStart.search(endPattern);
            answerText = endMatch !== -1 ? fromStart.slice(0, endMatch).trim() : fromStart.slice(0, 1500).trim();
          } else {
            answerText = fromStart.slice(0, 1500).trim();
          }
        }
        // Fallback: send entire document text if no split found
        if (!answerText) answerText = fullText.slice(0, 1500) || `Answer for ${q.number}`;
        return { questionId: q.id, questionNumber: q.number, answerText };
      }) ?? [];
      parsedScripts.push({
        id: 'script-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        studentName: uploadedFile.studentName || file.name.replace(/\.[^/.]+$/, ''),
        studentId: 'STU-' + Math.floor(1000 + Math.random() * 9000),
        submittedAt: new Date().toISOString(),
        status: 'pending',
        answers,
        rawText: processed.rawText,
        fileName: uploadedFile.name,
      });
    }

    setUploadedFiles((prev) => [...parsedFiles, ...prev]);
    setStudentScripts((prev) => [...parsedScripts, ...prev]);
    // Uploads now render as unified file cards inside RightSidebar on mobile.
    // Avoid adding a separate chat message here to prevent duplicate UI entries.
    setActiveTab('marking_hub');

    for (const script of parsedScripts) {
      await handleMarkScript(script);
    }
  };

  const handleSaveScannedPages = async (pages: { id: string; dataUrl: string; filter: string }[]) => {
    if (!pages.length) return;

    const attachments: ChatAttachment[] = pages.map((page, index) => {
      const base64Data = page.dataUrl.split(',')[1] || '';
      return {
        id: page.id,
        name: `scan-page-${index + 1}.jpg`,
        size: '',
        type: 'image',
        mimeType: 'image/jpeg',
        fileType: 'image',
        url: page.dataUrl,
        base64Data,
      };
    });

    setScannerOpen(false);

    await handleSendMessage(
      `📄 Attached ${pages.length} scanned page${pages.length === 1 ? '' : 's'} for AI review.`, 
      attachments,
    );
  };

  const handleUploadMasterGuideFiles = async (filesInput: File[] | FileList | File) => {
    let rawFiles: File[] = [];
    if (filesInput instanceof File) rawFiles = [filesInput];
    else rawFiles = Array.from(filesInput);
    if (rawFiles.length === 0) return;

    const masterFiles = await Promise.all(
      rawFiles.map(async (file) => {
        const processed = await processFileClientSide(file);
        return {
          id: 'master-file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          name: file.name,
          url: processed.url,
          fileType: processed.fileType,
          rawText: processed.rawText,
          htmlContent: processed.htmlContent,
          studentName: file.name.replace(/\.[^/.]+$/, ''),
          batchBadge: '①',
        } as UploadedFile;
      })
    );
    setMasterGuideFiles((prev) => [...masterFiles, ...prev]);
  };

  const handleDeleteMasterGuideFile = (fileId: string) => {
    setMasterGuideFiles((prev) => prev.filter((file) => file.id !== fileId));
  };

  const handleUpdateMasterGuideFileText = (fileId: string, text: string) => {
    setMasterGuideFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, rawText: text } : file))
    );
  };

  const handleToggleSoftDelete = (fileId: string) => {
    setUploadedFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, isSoftDeleted: !file.isSoftDeleted } : file))
    );
  };

  const handleToggleFlag = (fileId: string) => {
    setUploadedFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, isFlagged: !file.isFlagged } : file))
    );
  };

  const handleUpdateBonusMarks = (fileId: string, bonus: number) => {
    setUploadedFiles((prev) =>
      prev.map((file) => (file.id === fileId ? { ...file, bonusMarks: bonus } : file))
    );
  };

  const handleDeletePermanently = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== fileId));
  };

  const handleGenerateExcelExport = async () => {
    if (studentScripts.length === 0) return;
    setIsGeneratingExcel(true);
    setExcelDownloadUrl(null);
    try {
      const batchTitle = examPaper?.title || 'Batch Results';
      const payload = {
        batchTitle,
        results: studentScripts.map((script) => ({
          studentId: script.studentId,
          studentName: script.studentName,
          score: script.totalAwardedMarks ?? 0,
          maxScore: script.maxTotalMarks ?? 0,
          gradePercentage: script.percentage ?? 0,
          status:
            script.flags && script.flags.length > 0
              ? 'Needs Review'
              : (script.percentage ?? 0) >= 50
              ? 'Passed'
              : 'Failed',
          breakdown: script.results?.map((result) => ({
            question: result.questionNumber,
            score: result.awardedMarks,
            max: result.maxMarks,
            feedback: result.feedbackToStudent,
          })) || [],
        })),
      };

      const response = await authFetch('/api/export-gradebook', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate Excel export.');
      }
      setExcelDownloadUrl(data.excelReportUrl);
    } catch (error: any) {
      console.error('Excel export failed:', error);
      setExcelDownloadUrl(null);
    } finally {
      setIsGeneratingExcel(false);
    }
  };

  useEffect(() => {
    setExcelDownloadUrl(null);
  }, [studentScripts]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('jobId');
    const service = params.get('service');
    if (window.location.pathname === '/upgrade' && jobId && service) {
      setUpgradeContext({ jobId, service });
    }
  }, []);

  if (upgradeContext) {
    return (
      <UpgradePage
        jobId={upgradeContext.jobId}
        service={upgradeContext.service}
        targetPlan={upgradeContext.targetPlan}
        customPrice={upgradeContext.amount}
        onBack={() => {
          setUpgradeContext(null);
          window.history.pushState({}, '', '/');
        }}
        onSuccess={() => {
          setUpgradeContext(null);
          window.history.pushState({}, '', '/');
          showAiStatus('info', 'Upgrade successful! Your content is now available.');
        }}
      />
    );
  }

  const handleDeleteSession = (sessionId: string) => {
    setChatSessions((prev) => prev.filter(s => s.id !== sessionId));
    // If the deleted session was the active one, clear current workspace
    if (activeSessionId === sessionId) {
      handleClearCurrentChat();
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#191919] text-[#D1D1D0] font-sans antialiased transition-colors duration-200 overflow-hidden flex flex-col">

      {scannerOpen && (
        <div className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-sm p-3 sm:p-4">
          <div className="absolute inset-0" onClick={() => setScannerOpen(false)} />
          <div className="relative mx-auto h-full max-w-[1700px] overflow-hidden rounded-[28px] border border-white/10 shadow-2xl">
            <div className="flex h-full flex-col lg:flex-row-reverse">
              <div className="lg:w-[48%] h-full overflow-hidden bg-[#0f1013] rounded-b-[28px] lg:rounded-[28px]">
                <DocumentScanner
                  onClose={() => setScannerOpen(false)}
                  onSavePages={handleSaveScannedPages}
                />
              </div>
              <div className="hidden lg:flex lg:w-[52%] flex-col justify-center gap-4 p-8 bg-slate-950/80 text-slate-100">
                <div className="space-y-2">
                  <p className="text-sm font-semibold uppercase text-amber-300 tracking-[0.18em]">Scanner preview mode</p>
                  <h2 className="text-2xl font-semibold">Your workspace stays visible while AI prepares the report.</h2>
                  <p className="text-sm leading-6 text-slate-300">
                    The left workspace remains visible under the panel, so you can compare the scanned paper and worksheet context while Bwenge AI generates a polished grading response.
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-800/90 bg-slate-900/90 p-4 text-sm text-slate-300">
                  <p className="font-semibold text-white mb-2">What happens next</p>
                  <ul className="space-y-2 list-disc list-inside">
                    <li>Review scanned pages before saving.</li>
                    <li>Save the scan and watch the AI report appear on the right.</li>
                    <li>Keep the original submission visible for side-by-side review.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden lg:flex-row min-h-0">

        <LeftSidebar
          activeTab={activeTab as NavigationTab}
          setActiveTab={(t) => setActiveTab(t as string)}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          user={authenticatedUser}
          onOpenLoginModal={() => setLoginModalOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={handleLogout}
          sessions={chatSessions}
          onLoadSession={handleLoadChatSession}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
        />

        {activeTab === 'documents' ? (
          <div className="flex-1 h-full overflow-hidden">
            <CreateStudio
              messages={messages}
              sessions={chatSessions}
              onSendMessage={handleSendMessage}
              onNewChat={handleNewChat}
              onLoadSession={handleLoadChatSession}
              onOpenSettings={() => setSettingsOpen(true)}
              onDeleteChat={handleClearCurrentChat}
              onExportChat={handleExportChat}
              onShare={handleShare}
              activeFormId={activeFormId}
              isTyping={isAiThinking}
              onAbort={() => abortController?.abort()}
              selectedProvider={selectedProvider}
              onProviderChange={setSelectedProvider}
              stagedAttachments={stagedAttachments}
              onStageAttachments={handleStageAttachments}
              onRemoveStagedAttachment={handleRemoveStagedAttachment}
            />
          </div>

        ) : (
          <div className="flex-1 flex flex-col min-w-0">
            <TopNavbar
              activeTab={activeTab as NavigationTab}
              setActiveTab={(t) => setActiveTab(t as string)}
              onNewChat={handleNewChat}
              onOpenSettings={() => setSettingsOpen(true)}
              onDeleteChat={handleClearCurrentChat}
              onExportChat={handleExportChat}
              onShare={handleShare}
              activeFormId={activeFormId}
              user={authenticatedUser}
            />

            <div className="flex-1 flex overflow-hidden lg:flex-row min-h-0">
              <div className="hidden md:flex flex-1 min-h-0 border-r border-white/5">
                <CenterWorkspace
                  activeTab={activeTab}
                  examPaper={examPaper}
                  setExamPaper={setExamPaper}
                  uploadedFiles={uploadedFiles}
                  studentScripts={studentScripts}
                  setStudentScripts={setStudentScripts}
                  onUploadStudentPaper={handleUploadStudentPaper}
                  onOpenScanner={() => setScannerOpen(true)}
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
                  scannerOpen={scannerOpen}
                  onCloseScanner={() => setScannerOpen(false)}
                  onSaveScannedPages={handleSaveScannedPages}
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
                />
              </div>

              <div className="w-full md:w-[460px] h-full flex flex-col border-l border-white/5">
                {activeTab !== 'results' ? (
                  <RightChatSidebar
                    messages={messages}
                    chatSessions={chatSessions}
                    onSendMessage={handleSendMessage}
                    stagedAttachments={stagedAttachments}
                    onStageAttachments={handleStageAttachments}
                    onRemoveStagedAttachment={handleRemoveStagedAttachment}
                    onClearStagedAttachments={handleClearStagedAttachments}
                    activeDocument={activeDocument}
                    setActiveDocument={setActiveDocument}
                    onOpenScanner={() => setScannerOpen(true)}
                    onNewChat={handleNewChat}
                    onLoadSession={handleLoadChatSession}
                    onClearChat={handleClearCurrentChat}
                    onInsightAction={handleInsightAction}
                    isDegraded={aiServiceState === 'degraded'}
                    isTyping={isAiThinking}
                    onUpgradeClick={(jobId, service) => setUpgradeContext({ jobId, service })}
                    selectedProvider={selectedProvider}
                    onProviderChange={setSelectedProvider}
                  />
                ) : (
                  <SidebarResultsPanel
                    batchTitle={examPaper?.title || 'Batch Results'}
                    excelDownloadUrl={excelDownloadUrl}
                    isGenerating={isGeneratingExcel}
                    results={studentScripts.map((script) => ({
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
                    onClose={() => setActiveTab('marking_hub')}
                    onGenerateExcel={handleGenerateExcelExport}
                  />
                )}
              </div>
            </div>
          </div>
        )}

      </div>


      <Suspense fallback={null}>
        <LoginModal
          isOpen={loginModalOpen}
          onClose={() => setLoginModalOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
        <UpgradeModal
          isOpen={upgradeModalOpen}
          onClose={() => setUpgradeModalOpen(false)}
          onUpgrade={handleUpgrade}
        />
      </Suspense>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={authenticatedUser}
        onUpdateUser={handleUpdateUser}
        onLogout={handleLogout}
      />
      <FloatingSmartToolbar
        selectedText={selectedText}
        position={selectionPos}
        onHighlight={handleHighlight}
        onSummarize={handleSummarize}
        onTranslate={handleTranslate}
        onCaptureFlashcard={handleCaptureFlashcard}
        onExportMarkdown={handleExportMarkdown}
        onClose={handleCloseToolbar}
      />

      {showPenToast && (
        <HardwareToast
          penState={penState}
          onClose={() => setShowPenToast(false)}
          onSimulateStroke={() => {
            setPenState((prev) => ({ ...prev, lastOCRText: 'Simulated stroke text', lastSyncTime: new Date().toLocaleTimeString() }));
          }}
        />
      )}
    </div>
  );
}