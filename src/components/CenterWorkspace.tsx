import React, { useRef, useState } from 'react';
import { NavigationTab, ExamPaper, UploadedFile, StudentScript } from '../types';
import { ResultsView } from './ResultsView';
import {
  Plus, Check, X, Type, Maximize2, Sparkles, Trash2, RotateCcw, Award, Flag, Paperclip, Wrench, Bold, Italic, Underline, List, Link as LinkIcon,
  Clock, BookOpen, Layout, FileText, Link2, ArrowLeft, ArrowUp, ArrowDown, Copy, AlignLeft, Image as ImageIcon, Video,
  CircleDot, CheckSquare, ChevronDown, Calendar, Hash, Mail, Phone, Upload, Star, CheckCircle2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import DynamicForm from './DynamicForm';
import FormBuilder from './FormBuilder';
import { BwengeLoader } from './BwengeLoader';
import { authFetch } from '../utils/authFetch';
import { copyToClipboard } from '../utils/copyToClipboard';

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
  onDeletePermanently?: (fileId: string) => void | Promise<void>;
  documentViewMode?: 'grid' | 'list';
  onDocumentViewModeChange?: (mode: 'grid' | 'list') => void;
  activeDocument?: any;
  pinnedSyllabusId?: string | null;
  onPinSyllabus?: (id: string | null) => void;
  studioProjectStatus?: 'idle' | 'saving' | 'saved' | 'error';
  onLoadStudioProject?: (projectId: string) => void;
  savedStudioProjects?: Array<{ id: string; title: string; updatedAt: string }>;
  externalGeneratedForm?: any | null;
  onClearExternalForm?: () => void;
  openFormRequest?: number;
}

interface Annotation {
  id: string;
  x: number;
  y: number;
  text: string;
  type: 'note' | 'score' | 'check';
}

// ── Manual Form Builder types ──────────────────────────────────────────
// Mirrors the flat { title, description, questions } schema shape already
// produced by the AI path (POST /api/forms/generate → FormOrchestrator),
// so both the manual builder and the AI builder feed the same
// <DynamicForm /> renderer and the same publish/preview overlay.
type ManualQuestionType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOX'
  | 'DROPDOWN'
  | 'DATE'
  | 'NUMBER'
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'FILE_UPLOAD'
  | 'RATING'
  | 'LINEAR_SCALE'
  | 'MULTIPLE_CHOICE_GRID'
  | 'CHECKBOX_GRID'
  | 'TIME';

interface ManualQuestionOption {
  id: string;
  label: string;
}

interface ManualQuestion {
  id: string;
  type: ManualQuestionType;
  title: string;
  description?: string;
  required: boolean;
  options?: ManualQuestionOption[];
  rows?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  maxRating?: number;
  imageUrl?: string;
  videoUrl?: string;
  videoDataUrl?: string;
  contentTitle?: string;
  themeColor?: string;
  sectionTitle?: string;
  showVideoEditor?: boolean;
}

interface ManualContentBlock {
  id: string;
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'SECTION';
  title: string;
  description?: string;
  url?: string;
}

interface ManualFormDraft {
  id?: string;
  title: string;
  description: string;
  descriptionImageUrl?: string;
  questions: ManualQuestion[];
  blocks?: ManualContentBlock[];
  themeColor?: string;
}

// Collision-resistant enough for client-side draft IDs; crypto.randomUUID
// isn't available in every runtime this bundle might hit (older WebViews),
// hence the fallback.
const genId = (prefix: string) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}_${crypto.randomUUID()}`
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const QUESTION_TYPE_CATALOG: { type: ManualQuestionType; label: string; icon: React.ElementType; hasOptions?: boolean }[] = [
  { type: 'SHORT_TEXT', label: 'Short answer', icon: Type },
  { type: 'LONG_TEXT', label: 'Paragraph', icon: AlignLeft },
  { type: 'MULTIPLE_CHOICE', label: 'Multiple choice', icon: CircleDot, hasOptions: true },
  { type: 'CHECKBOX', label: 'Checkboxes', icon: CheckSquare, hasOptions: true },
  { type: 'DROPDOWN', label: 'Dropdown', icon: ChevronDown, hasOptions: true },
  { type: 'DATE', label: 'Date', icon: Calendar },
  { type: 'NUMBER', label: 'Number', icon: Hash },
  { type: 'EMAIL', label: 'Email', icon: Mail },
  { type: 'PHONE', label: 'Phone', icon: Phone },
  { type: 'URL', label: 'Link', icon: Link2 },
  { type: 'FILE_UPLOAD', label: 'File upload', icon: Upload },
  { type: 'LINEAR_SCALE', label: 'Linear scale', icon: Hash },
  { type: 'RATING', label: 'Rating', icon: Star },
  { type: 'MULTIPLE_CHOICE_GRID', label: 'Multiple choice grid', icon: Layout, hasOptions: true },
  { type: 'CHECKBOX_GRID', label: 'Checkbox grid', icon: CheckSquare, hasOptions: true },
  { type: 'TIME', label: 'Time', icon: Clock },
];

const FORM_BUILDER_API_TYPES: Record<string, ManualQuestionType> = {
  text: 'SHORT_TEXT', long_text: 'LONG_TEXT', radio: 'MULTIPLE_CHOICE', checkbox: 'CHECKBOX',
  select: 'DROPDOWN', date: 'DATE', number: 'NUMBER', email: 'EMAIL', tel: 'PHONE', url: 'URL',
  file: 'FILE_UPLOAD', rating: 'RATING', linear_scale: 'LINEAR_SCALE', radio_grid: 'MULTIPLE_CHOICE_GRID',
  checkbox_grid: 'CHECKBOX_GRID', time: 'TIME',
};

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
  documentViewMode,
  onDocumentViewModeChange,
  activeDocument,
  pinnedSyllabusId,
  onPinSyllabus,
  studioProjectStatus = 'idle',
  onLoadStudioProject,
  savedStudioProjects = [],
  externalGeneratedForm = null,
  onClearExternalForm,
  openFormRequest = 0,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [zoomTarget, setZoomTarget] = useState<{ x: number, y: number } | null>(null);

  const aiDesignBuffer = useStore((state) => state.aiDesignBuffer);
  const setAiDesignBuffer = useStore((state) => state.setAiDesignBuffer);
  const agentStatus = useStore((state) => state.agentStatus);
  const isAiLoading = useStore((state) => state.isAiLoading);

  // ── Create Form feature state ──────────────────────────────────────────
  // This is a separate flow from the exam/assessment draft above
  // (aiDesignBuffer / AssessmentDraftView, which is exam-and-rubric
  // specific). "Create Form" talks to the general-purpose form builder on
  // the server — POST /api/forms/generate, backed by FormOrchestrator —
  // and renders the resulting schema with the same <DynamicForm />
  // component already used to render forms streamed from chat
  // (see ChatMessage.tsx's formSchemaMatch handling).
  const [showFormCreatorModal, setShowFormCreatorModal] = useState(false);
  const [formIntentText, setFormIntentText] = useState('');
  const [isGeneratingForm, setIsGeneratingForm] = useState(false);
  const [formGenError, setFormGenError] = useState<string | null>(null);
  const [generatedForm, setGeneratedForm] = useState<any | null>(null);
  const [formLinkCopied, setFormLinkCopied] = useState(false);
  const [savedForms, setSavedForms] = useState<any[]>([]);
  const [showSavedForms, setShowSavedForms] = useState(false);
  const [activeSavedForm, setActiveSavedForm] = useState<any | null>(null);
  const [draftRequirements, setDraftRequirements] = useState('');
  const [draftRubric, setDraftRubric] = useState<any>(null);
  const [draftSelectionSettings, setDraftSelectionSettings] = useState<any>(null);
  const [selectionRequirements, setSelectionRequirements] = useState('');
  const [formAnalysis, setFormAnalysis] = useState<any | null>(null);
  const [formAnalysisError, setFormAnalysisError] = useState('');
  const [savedFormsError, setSavedFormsError] = useState('');
  const [isLoadingSavedForms, setIsLoadingSavedForms] = useState(false);
  const [isAnalyzingForm, setIsAnalyzingForm] = useState(false);
  const [formAnalysisNotice, setFormAnalysisNotice] = useState('');
  const [formResponses, setFormResponses] = useState<any[]>([]);
  const [savingReviewId, setSavingReviewId] = useState<string | null>(null);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [formDashboardTab, setFormDashboardTab] = useState<'responses' | 'settings'>('responses');
  const [responsesError, setResponsesError] = useState('');
  const [formCopilotInstruction, setFormCopilotInstruction] = useState('');
  const [isRunningFormCopilot, setIsRunningFormCopilot] = useState(false);

  React.useEffect(() => {
    if (openFormRequest > 0) setShowFormCreatorModal(true);
  }, [openFormRequest]);

  React.useEffect(() => {
    if (externalGeneratedForm) {
      setGeneratedForm(externalGeneratedForm);
      onClearExternalForm?.();
    }
  }, [externalGeneratedForm, onClearExternalForm]);

  const handleRunFormCopilot = async (customInstruction?: string) => {
    const instruction = (customInstruction ?? formCopilotInstruction).trim();
    if (!instruction || isRunningFormCopilot) return;

    setIsRunningFormCopilot(true);
    setManualSaveError(null);
    try {
      const response = await authFetch('/api/forms/ai-agent', {
        method: 'POST',
        body: JSON.stringify({
          action: 'enhance_draft',
          currentDraft: manualForm,
          instruction,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI Form Agent could not enhance draft.');
      const draft = data.draft || {};
      const nextQuestions: ManualQuestion[] = Array.isArray(draft.questions)
        ? draft.questions.map((q: any, i: number) => ({
            id: q.id || genId(`q_${i}`),
            type: QUESTION_TYPE_CATALOG.some((t) => t.type === q.type) ? q.type : 'SHORT_TEXT',
            title: q.title || q.label || `Question ${i + 1}`,
            description: q.description || '',
            required: Boolean(q.required ?? true),
            options: Array.isArray(q.options)
              ? q.options.map((opt: any, oi: number) => ({
                  id: opt?.id || genId(`opt_${oi}`),
                  label: typeof opt === 'string' ? opt : opt?.label || `Option ${oi + 1}`,
                }))
              : undefined,
            rows: Array.isArray(q.rows) ? q.rows : ['Row 1', 'Row 2'],
            scaleMin: q.scaleMin ?? 1,
            scaleMax: q.scaleMax ?? 5,
            maxRating: q.maxRating ?? 5,
          }))
        : manualForm.questions;

      setManualForm((prev) => ({
        ...prev,
        title: draft.title || prev.title || 'AI Agent Form',
        description: draft.description || prev.description,
        questions: nextQuestions,
      }));
      if (draft.requirements) {
        setDraftRequirements(draft.requirements);
        setSelectionRequirements(draft.requirements);
      }
      setFormCopilotInstruction('');
    } catch (err: any) {
      setManualSaveError(err?.message || 'AI Form Co-Pilot failed.');
    } finally {
      setIsRunningFormCopilot(false);
    }
  };

  const handleGenerateForm = async () => {
    const intent = formIntentText.trim();
    if (!intent || isGeneratingForm) return;

    setIsGeneratingForm(true);
    setFormGenError(null);
    try {
      const response = await authFetch('/api/forms/generate', {
        method: 'POST',
        body: JSON.stringify({ intent, requirements: draftRequirements || intent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not generate the form.');
      const form = data.form || data.schema || data;
      if (!form || typeof form !== 'object') throw new Error('The generated form response was invalid.');
      setGeneratedForm(form);
      setShowFormCreatorModal(false);
    } catch (error: any) {
      setFormGenError(error?.message || 'Could not generate the form.');
    } finally {
      setIsGeneratingForm(false);
    }
  };

  const loadOwnedForms = async () => {
    const response = await authFetch('/api/forms');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load forms.');
    setSavedForms(data.forms || []);
  };

  const showFormsDashboard = async () => {
    setShowSavedForms(true);
    setSavedFormsError('');
    setIsLoadingSavedForms(true);
    try { await loadOwnedForms(); }
    catch (error: any) { setSavedFormsError(error?.message || 'Could not load forms.'); }
    finally { setIsLoadingSavedForms(false); }
  };

  const loadFormResponses = async (formId: string) => {
    setResponsesLoading(true);
    setResponsesError('');
    try {
      const response = await authFetch(`/api/forms/${formId}/responses`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load responses.');
      setFormResponses(data.submissions || []);
    } catch (error: any) {
      setResponsesError(error?.message || 'Could not load responses.');
      setFormResponses([]);
    } finally { setResponsesLoading(false); }
  };

  const saveResponseReview = async (event: React.FormEvent<HTMLFormElement>, responseId: string) => {
    event.preventDefault();
    if (!activeSavedForm?.id) return;
    const values = new FormData(event.currentTarget);
    const reviewedScore = Number(values.get('score'));
    const reviewedSelected = values.get('selected') === 'on';
    const reviewedFeedback = String(values.get('feedback') || '');
    setSavingReviewId(responseId);
    setResponsesError('');
    try {
      const response = await authFetch(`/api/forms/${activeSavedForm.id}/responses/${responseId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          score: reviewedScore,
          selected: reviewedSelected,
          feedback: reviewedFeedback,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this review.');
      await loadFormResponses(activeSavedForm.id);
      setFormAnalysis((current) => {
        if (!current) return current;
        const candidates = (current.candidates || []).map((candidate: any) => candidate.id === responseId
          ? { ...candidate, score: reviewedScore, selected: reviewedSelected, feedback: reviewedFeedback }
          : candidate);
        const scores = candidates.filter((candidate: any) => candidate.score !== null && candidate.score !== undefined)
          .map((candidate: any) => Number(candidate.score)).filter(Number.isFinite);
        return {
          ...current,
          candidates,
          selectedCount: candidates.filter((candidate: any) => candidate.selected).length,
          averageScore: scores.length ? Math.round(scores.reduce((sum: number, score: number) => sum + score, 0) / scores.length * 10) / 10 : null,
        };
      });
      setFormAnalysisNotice('Review saved.');
    } catch (error: any) {
      setResponsesError(error?.message || 'Could not save this review.');
    } finally {
      setSavingReviewId(null);
    }
  };

  const runFormAnalysis = async () => {
    if (!activeSavedForm?.id) return;
    setIsAnalyzingForm(true);
    setFormAnalysisError('');
    setFormAnalysisNotice('');
    try {
      const response = await authFetch(`/api/forms/${activeSavedForm.id}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ requirements: selectionRequirements }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not analyze responses.');
      setFormAnalysis(data.analysis);
      if (data.analysis?.selection?.error) setFormAnalysisNotice(data.analysis.selection.error);
      await loadOwnedForms();
    } catch (error: any) { setFormAnalysisError(error?.message || 'Could not analyze responses.'); }
    finally { setIsAnalyzingForm(false); }
  };

  const saveSelectionRequirements = async () => {
    if (!activeSavedForm?.id) return;
    const response = await authFetch(`/api/forms/${activeSavedForm.id}/requirements`, {
      method: 'PATCH',
      body: JSON.stringify({ requirements: selectionRequirements }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save requirements.');
  };

  const toggleFormResponses = async () => {
    if (!activeSavedForm?.id) return;
    const acceptingResponses = activeSavedForm.schema?.acceptingResponses === false;
    const response = await authFetch(`/api/forms/${activeSavedForm.id}/settings`, {
      method: 'PATCH', body: JSON.stringify({ acceptingResponses }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update form status.');
    const updatedForm = { ...activeSavedForm, schema: { ...(activeSavedForm.schema || {}), acceptingResponses } };
    setActiveSavedForm(updatedForm);
    setSavedForms((previous) => previous.map((form) => form.id === updatedForm.id ? updatedForm : form));
    setFormAnalysisNotice(acceptingResponses ? 'Form is accepting responses.' : 'Responses are paused.');
  };

  const exportResponsesCsv = async () => {
    if (!activeSavedForm?.id) return;
    const response = await authFetch(`/api/forms/${activeSavedForm.id}/results/export.csv`);
    if (!response.ok) throw new Error((await response.json()).error || 'Could not export responses.');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `form-responses-${activeSavedForm.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const handleCopyFormLink = async () => {
    if (!generatedForm?.id) return;
    const link = new URL(`/forms/${encodeURIComponent(generatedForm.id)}`, window.location.origin).toString();
    try {
      await copyToClipboard(link);
      setFormLinkCopied(true);
      window.setTimeout(() => setFormLinkCopied(false), 1800);
    } catch {
      setFormGenError(`Copy failed. Your form link is ${link}`);
    }
  };

  const handleDiscardGeneratedForm = () => {
    setGeneratedForm(null);
    setFormLinkCopied(false);
  };

  // Lets the creator test-submit their own generated form straight from
  // the preview, exercising the same POST /api/forms/:id/submit route a
  // real respondent would hit.
  const handleTestFormSubmit = async (answers: Record<string, any>) => {
    if (!generatedForm?.id) return;
    try {
      const response = await authFetch(`/api/forms/${generatedForm.id}/submit`, {
        method: 'POST',
        body: JSON.stringify(answers),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not submit response.');
    } catch (err) {
      console.warn('Test form submission failed', err);
    }
  };

  const FormBuilderView = ({ form }: { form: any }) => {
    const publicLink = form?.id ? `${window.location.origin}/forms/${form.id}` : '';
    return (
      <div className="w-full max-w-3xl bg-white dark:bg-[#1C1C20] rounded-[32px] shadow-2xl overflow-hidden border border-[#E8E4DC] dark:border-[#2D2D32] animate-in fade-in zoom-in-95 duration-500">
        <div className="bg-[#D97757] p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <FileText size={120} />
          </div>
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
              <Sparkles size={12} />
              AI Drafted Form
            </div>
            <h2 className="text-3xl font-black tracking-tight">{form.title || 'Untitled Form'}</h2>
            {form.description && (
              <p className="text-sm opacity-90 max-w-xl leading-relaxed pt-1">{form.description}</p>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-8 space-y-6 max-h-[48vh] overflow-y-auto custom-scrollbar">
          <DynamicForm schema={JSON.stringify(form)} onSubmit={handleTestFormSubmit} />
        </div>

        <div className="p-4 sm:p-8 bg-[#F4F0E8]/30 dark:bg-[#18181B]/30 border-t border-[#E8E4DC] dark:border-[#2D2D32] flex flex-wrap items-center gap-3">
          {form?.id ? (
            <>
              <button
                onClick={() => {
                  setActiveSavedForm(form);
                  setSelectionRequirements(draftRequirements || form.requirements || form.schema?.description || '');
                  setFormDashboardTab('responses');
                  setShowSavedForms(true);
                  void loadFormResponses(form.id);
                }}
                className="w-full sm:w-auto px-5 py-3 rounded-2xl font-bold text-sm bg-white dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32]"
              >
                View results
              </button>
            </>
          ) : (
            <span className="text-xs text-[#858075]">Save and publish this draft to collect responses and analyze results.</span>
          )}
          <button
            onClick={handleCopyFormLink}
            disabled={!form?.id}
            className="w-full sm:w-auto px-6 py-3 rounded-2xl font-black text-sm bg-[#191919] dark:bg-[#F3F3F3] text-white dark:text-[#191919] hover:opacity-90 transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {formLinkCopied ? <Check size={16} /> : <Link2 size={16} />}
            {formLinkCopied ? 'Link Copied' : 'Copy Public Link'}
          </button>
          {form?.id && <a href={publicLink} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto px-5 py-3 rounded-2xl font-bold text-sm bg-white dark:bg-[#202024] border border-[#E8E4DC] dark:border-[#2D2D32] text-center">Open public form</a>}
          <button
            onClick={() => setShowFormCreatorModal(true)}
            className="w-full sm:w-auto px-6 py-3 bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] text-[#191919] dark:text-[#F3F3F3] rounded-2xl font-bold text-sm transition-all border border-[#E8E4DC] dark:border-[#2D2D32] active:scale-95"
          >
            Refine Prompt &amp; Regenerate
          </button>
          <button
            onClick={handleDiscardGeneratedForm}
            className="w-full sm:w-auto px-6 py-3 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-2xl font-bold text-sm transition-all active:scale-95"
          >
            Discard
          </button>
          <div className="flex-1 text-center sm:text-right text-[9px] font-bold text-[#858075] uppercase tracking-widest truncate">
            {form?.id ? publicLink : 'Not yet published'}
          </div>
          {formGenError && <p role="alert" className="basis-full break-all text-xs text-rose-600">{formGenError}</p>}
        </div>
      </div>
    );
  };
  // ── Manual Form Builder state ────────────────────────────────────────
  const [showManualFormBuilder, setShowManualFormBuilder] = useState(false);
  const [formBuilderInitialSchema, setFormBuilderInitialSchema] = useState<any>();
  const [manualForm, setManualForm] = useState<ManualFormDraft>({ title: '', description: '', questions: [], blocks: [], themeColor: '#D97757' });
  const [manualBuilderTab, setManualBuilderTab] = useState<'build' | 'preview'>('build');
  const [descriptionSelection, setDescriptionSelection] = useState<{ top: number; left: number } | null>(null);
  const [showImportQuestions, setShowImportQuestions] = useState(false);
  const [isSavingManualForm, setIsSavingManualForm] = useState(false);
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [manualPublishedFormId, setManualPublishedFormId] = useState<string | null>(null);

  const updateDescriptionSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setDescriptionSelection(null);
      return;
    }
    const editor = document.getElementById('manual-form-description');
    if (!editor?.contains(selection.anchorNode)) {
      setDescriptionSelection(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setDescriptionSelection({ top: rect.top, left: rect.left + rect.width / 2 });
  };

  const addManualQuestion = (type: ManualQuestionType) => {
    const meta = QUESTION_TYPE_CATALOG.find((t) => t.type === type)!;
    setManualForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id: genId('q'),
          type,
          title: '',
          description: '',
          required: false,
          options: meta.hasOptions ? [{ id: genId('opt'), label: 'Option 1' }] : undefined,
          rows: ['Row 1', 'Row 2'], scaleMin: 1, scaleMax: 5, scaleMinLabel: '', scaleMaxLabel: '', maxRating: 5,
        },
      ],
    }));
  };

  const updateManualQuestion = (id: string, patch: Partial<ManualQuestion>) => {
    setManualForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    }));
  };

  const addImageToQuestion = (questionId: string, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setManualSaveError('Choose an image file.'); return; }
    if (file.size > 2 * 1024 * 1024) { setManualSaveError('Choose an image smaller than 2 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => updateManualQuestion(questionId, { imageUrl: String(reader.result || '') });
    reader.onerror = () => setManualSaveError('Could not read this image.');
    reader.readAsDataURL(file);
  };

  const addVideoToQuestion = (questionId: string, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) { setManualSaveError('Choose a video file.'); return; }
    if (file.size > 12 * 1024 * 1024) { setManualSaveError('Choose a video smaller than 12 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => updateManualQuestion(questionId, { videoDataUrl: String(reader.result || ''), videoUrl: '', showVideoEditor: true });
    reader.onerror = () => setManualSaveError('Could not read this video.');
    reader.readAsDataURL(file);
  };

  const deleteManualQuestion = (id: string) => {
    setManualForm((prev) => ({ ...prev, questions: prev.questions.filter((q) => q.id !== id) }));
  };

  const duplicateManualQuestion = (id: string) => {
    setManualForm((prev) => {
      const idx = prev.questions.findIndex((q) => q.id === id);
      if (idx === -1) return prev;
      const original = prev.questions[idx];
      const clone: ManualQuestion = {
        ...original,
        id: genId('q'),
        options: original.options ? original.options.map((o) => ({ ...o, id: genId('opt') })) : undefined,
      };
      const next = [...prev.questions];
      next.splice(idx + 1, 0, clone);
      return { ...prev, questions: next };
    });
  };

  const importQuestionsFromForm = (form: any) => {
    const questions = form?.schema?.questions || [];
    if (!questions.length) return;
    const imported = questions.map((question: ManualQuestion) => ({
      ...question,
      id: genId('q'),
      options: question.options?.map(option => ({ ...option, id: genId('opt') })),
      rows: question.rows ? [...question.rows] : undefined,
    }));
    setManualForm(prev => ({ ...prev, questions: [...prev.questions, ...imported] }));
    setShowImportQuestions(false);
  };

  const moveManualQuestion = (id: string, direction: 'up' | 'down') => {
    setManualForm((prev) => {
      const idx = prev.questions.findIndex((q) => q.id === id);
      if (idx === -1) return prev;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.questions.length) return prev;
      const next = [...prev.questions];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return { ...prev, questions: next };
    });
  };

  const addManualOption = (questionId: string) => {
    setManualForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) =>
        q.id === questionId
          ? { ...q, options: [...(q.options || []), { id: genId('opt'), label: `Option ${(q.options?.length || 0) + 1}` }] }
          : q
      ),
    }));
  };

  const updateManualOption = (questionId: string, optionId: string, label: string) => {
    setManualForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) =>
        q.id === questionId
          ? { ...q, options: (q.options || []).map((o) => (o.id === optionId ? { ...o, label } : o)) }
          : q
      ),
    }));
  };

  const updateManualRow = (questionId: string, rowIndex: number, value: string) => setManualForm(prev => ({
    ...prev,
    questions: prev.questions.map(q => q.id === questionId ? { ...q, rows: (q.rows || []).map((row, index) => index === rowIndex ? value : row) } : q),
  }));

  const addManualRow = (questionId: string) => setManualForm(prev => ({
    ...prev,
    questions: prev.questions.map(q => q.id === questionId ? { ...q, rows: [...(q.rows || []), `Row ${(q.rows || []).length + 1}`] } : q),
  }));

  const removeManualRow = (questionId: string, rowIndex: number) => setManualForm(prev => ({
    ...prev,
    questions: prev.questions.map(q => q.id === questionId ? { ...q, rows: (q.rows || []).filter((_, index) => index !== rowIndex) } : q),
  }));

  const addManualBlock = (type: ManualContentBlock['type']) => setManualForm(prev => ({
    ...prev,
    blocks: [...(prev.blocks || []), {
      id: genId('block'), type,
      title: type === 'SECTION' ? `Section ${(prev.blocks || []).filter(block => block.type === 'SECTION').length + 2}` : '',
      description: '', url: '',
    }],
  }));

  const updateManualBlock = (id: string, patch: Partial<ManualContentBlock>) => setManualForm(prev => ({
    ...prev, blocks: (prev.blocks || []).map(block => block.id === id ? { ...block, ...patch } : block),
  }));

  const deleteManualBlock = (id: string) => setManualForm(prev => ({ ...prev, blocks: (prev.blocks || []).filter(block => block.id !== id) }));

  const removeManualOption = (questionId: string, optionId: string) => {
    setManualForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) =>
        q.id === questionId ? { ...q, options: (q.options || []).filter((o) => o.id !== optionId) } : q
      ),
    }));
  };

  const resetManualBuilder = () => {
    setManualForm({ title: '', description: '', questions: [], blocks: [], themeColor: '#D97757' });
    setManualBuilderTab('build');
    setManualSaveError(null);
    setManualPublishedFormId(null);
  };

  const handleOpenManualBuilder = () => {
    resetManualBuilder();
    try {
      const savedDraft = localStorage.getItem('bwenge-form-builder-draft');
      setFormBuilderInitialSchema(savedDraft ? JSON.parse(savedDraft) : undefined);
    } catch {
      setFormBuilderInitialSchema(undefined);
    }
    setShowFormCreatorModal(false);
    setShowManualFormBuilder(true);
  };

  const handleSaveManualForm = async () => {
    if (!manualForm.title.trim()) {
      setManualSaveError('Give the form a title before publishing.');
      return;
    }
    if (manualForm.questions.length === 0) {
      setManualSaveError('Add at least one question before publishing.');
      return;
    }
    if (manualForm.questions.some((q) => !q.title.trim())) {
      setManualSaveError('Every question needs a title before publishing.');
      return;
    }

    setIsSavingManualForm(true);
    setManualSaveError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: manualForm.title.trim(),
          description: manualForm.description,
          descriptionImageUrl: manualForm.descriptionImageUrl,
          questions: manualForm.questions,
          blocks: manualForm.blocks || [],
          themeColor: manualForm.themeColor || '#D97757',
          requirements: manualForm.description.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.error || `Saving the form failed (${res.status})`);
      }

      const data = await res.json();
      if (!data?.success || !data?.form) {
        throw new Error('Save succeeded but the server response was unexpected.');
      }

      setShowManualFormBuilder(false);
      setFormLinkCopied(false);
      // Reuse the same publish/preview overlay the AI flow already uses.
      setGeneratedForm(data.form);
    } catch (err: any) {
      setManualSaveError(err?.message || 'Something went wrong saving the form.');
    } finally {
      setIsSavingManualForm(false);
    }
  };
  // ── End Create Form feature state ──────────────────────────────────────

  const publishFormBuilderSchema = async (builderSchema: any) => {
    const questions = (builderSchema.fields || []).map((field: any) => {
      const { label, ...question } = field;
      return { ...question, type: FORM_BUILDER_API_TYPES[field.type] || 'SHORT_TEXT', title: label || 'Untitled question' };
    });
    const response = await authFetch('/api/forms', {
      method: 'POST',
      body: JSON.stringify({
        title: builderSchema.title,
        description: builderSchema.description,
        descriptionImageUrl: builderSchema.descriptionImageUrl,
        questions,
        blocks: builderSchema.blocks || [],
        themeColor: builderSchema.themeColor,
        isQuiz: builderSchema.isQuiz,
        collectEmail: builderSchema.collectEmail,
        acceptingResponses: builderSchema.acceptingResponses,
        allowMultipleResponses: builderSchema.allowMultipleResponses,
        confirmationMessage: builderSchema.confirmationMessage,
        requirements: String(builderSchema.description || '').replace(/<[^>]*>/g, ' ').trim(),
      }),
    });
    const data = await response.json().catch(() => ({} as any));
    if (!response.ok || !data?.success || !data?.form) {
      throw new Error(data?.error || `Saving the form failed (${response.status}).`);
    }
    setManualPublishedFormId(data.form.id);
    const sharePath = data.form.shareableLink || `/forms/${data.form.id}`;
    try { localStorage.removeItem('bwenge-form-builder-draft'); } catch { /* local storage may be unavailable */ }
    setFormBuilderInitialSchema(undefined);
    return { shareUrl: new URL(sharePath, window.location.origin).toString() };
  };

  const runFormBuilderAgent = async (prompt: string, currentSchema: any) => {
    const response = await authFetch('/api/forms/ai-agent', {
      method: 'POST',
      body: JSON.stringify({
        action: 'enhance_draft',
        instruction: prompt,
        currentDraft: {
          title: currentSchema.title,
          description: currentSchema.description,
          questions: (currentSchema.fields || []).map((field: any) => {
            const { label, ...question } = field;
            return { ...question, type: FORM_BUILDER_API_TYPES[field.type] || 'SHORT_TEXT', title: label || 'Untitled question' };
          }),
          blocks: currentSchema.blocks || [],
          requirements: currentSchema.description || '',
        },
      }),
    });
    const data = await response.json().catch(() => ({} as any));
    if (!response.ok || !data?.draft) throw new Error(data?.error || 'The AI form assistant could not update this form.');
    return data.draft;
  };

  const AssessmentDraftView = ({ schema }: { schema: any }) => {
    const questions = schema.questions || [];
    const isDrafting = isAiLoading && !schema.questions;
    return (
      <div className="w-full max-w-4xl bg-white dark:bg-[#1C1C20] rounded-[32px] shadow-2xl overflow-hidden border border-[#E8E4DC] dark:border-[#2D2D32] animate-in fade-in zoom-in-95 duration-500">
        <div className="bg-[#D97757] p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Award size={120} />
          </div>
          <div className="relative z-10 space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
              {isAiLoading ? (
                <BwengeLoader variant="compact" />
              ) : (
                <Sparkles size={12} />
              )}
              {isAiLoading ? 'Bwenge is drafting assessment...' : 'AI Drafted Assessment'}
            </div>
            <h2 className="text-3xl font-black tracking-tight">{schema.title || (isAiLoading ? 'Generating Title...' : 'Untitled Assessment')}</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium opacity-90 pt-2">
              <div className="flex items-center gap-1.5 bg-black/10 px-2 py-1 rounded-md">
                <BookOpen size={14} />
                {schema.subject || 'General'}
              </div>
              <div className="flex items-center gap-1.5 bg-black/10 px-2 py-1 rounded-md">
                <Clock size={14} />
                {schema.durationMinutes || 60} mins
              </div>
              <div className="flex items-center gap-1.5 bg-black/10 px-2 py-1 rounded-md">
                <Layout size={14} />
                {questions.length} Questions
              </div>
              <div className="flex items-center gap-1.5 bg-black/10 px-2 py-1 rounded-md font-bold">
                Total: {schema.totalMarks || 0} Marks
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {schema.description && (
            <div className="text-sm text-[#66635B] dark:text-[#A0A0AA] italic leading-relaxed border-l-4 border-[#D97757]/30 pl-4 py-1">
              {schema.description}
            </div>
          )}

          <div className="space-y-6">
            {questions.map((q: any, idx: number) => (
              <div key={q.id || idx} className="group space-y-3 p-4 rounded-2xl hover:bg-[#F4F0E8]/50 dark:hover:bg-[#202024]/50 transition-all border border-transparent hover:border-[#E8E4DC] dark:hover:border-[#2D2D32]">
                <div className="flex items-start justify-between">
                  <div className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-[#D97757]/10 text-[#D97757] flex items-center justify-center text-xs font-bold border border-[#D97757]/20">
                      {q.number || idx + 1}
                    </span>
                    <div className="space-y-2">
                      <p className="text-[15px] font-bold text-[#191919] dark:text-[#F3F3F3] leading-snug">
                        {q.questionText || q.text || 'No question text provided'}
                      </p>
                      {q.options && q.options.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {q.options.map((opt: string, i: number) => (
                            <div key={i} className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-[#141416] border border-[#E8E4DC] dark:border-[#2D2D32] text-[#66635B] dark:text-[#A0A0AA] flex items-center gap-2">
                              <span className="w-4 h-4 rounded-full border border-[#D97757]/30 flex items-center justify-center text-[8px] font-bold text-[#D97757]">
                                {String.fromCharCode(65 + i)}
                              </span>
                              {opt}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-[10px] font-black text-[#D97757] bg-[#D97757]/10 px-2 py-1 rounded-md uppercase tracking-wider">
                    {q.maxMarks || 0} Marks
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-8 bg-[#F4F0E8]/30 dark:bg-[#18181B]/30 border-t border-[#E8E4DC] dark:border-[#2D2D32] flex flex-col sm:flex-row items-center gap-4">
          <button
            onClick={() => {
              if (setExamPaper) setExamPaper(schema);
              setAiDesignBuffer(null);
            }}
            disabled={isAiLoading}
            className={`w-full sm:w-auto px-8 py-3.5 rounded-2xl font-black text-sm transition-all shadow-xl flex items-center justify-center gap-2 active:scale-95 ${
              isAiLoading
                ? 'bg-slate-400 cursor-not-allowed opacity-50'
                : 'bg-[#D97757] hover:bg-[#C56648] text-white shadow-[#D97757]/20'
            }`}
          >
            <Check size={18} />
            {isAiLoading ? 'Drafting in progress...' : 'Approve & Deploy Assessment'}
          </button>
          <button
            onClick={() => setAiDesignBuffer(null)}
            className="w-full sm:w-auto px-8 py-3.5 bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] text-[#191919] dark:text-[#F3F3F3] rounded-2xl font-bold text-sm transition-all border border-[#E8E4DC] dark:border-[#2D2D32] active:scale-95"
          >
            Discard Draft
          </button>
          <div className="flex-1 text-center sm:text-right text-[9px] font-bold text-[#858075] uppercase tracking-widest">
            {agentStatus || 'Ready for refinement'}
          </div>
        </div>
      </div>
    );
  };

  const handleAnnotationClick = (anno: any) => {
    setZoomLevel(zoomLevel === 1 ? 2.5 : 1); // Toggle zoom
    setZoomTarget({ x: anno.x, y: anno.y });

    // Auto-reset zoom after 5 seconds
    if (zoomLevel === 1) {
       setTimeout(() => {
         setZoomLevel(1);
         setZoomTarget(null);
       }, 5000);
    }
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  // Selected paper for Full-Size Hover/Click Magnification View
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);

  // Live Canvas Annotation state for expanded view
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // AI vision-marking evidence overlays (see the "AI vision-marking evidence
  // overlays" block in the magnified viewer). Populated by the AI re-grade /
  // auto-mark pipeline; empty until that pipeline is wired up.
  const [visualAnnotations, setVisualAnnotations] = useState<any[]>([]);
  const [toolMode, setToolMode] = useState<'select' | 'text' | 'check' | 'score'>('select');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [localViewMode, setLocalViewMode] = useState<'grid' | 'list'>('grid');
  const viewMode = documentViewMode ?? localViewMode;
  const [isDeletingSelectedFile, setIsDeletingSelectedFile] = useState(false);
  const [deleteFileError, setDeleteFileError] = useState('');
  const changeViewMode = (mode: 'grid' | 'list') => {
    setLocalViewMode(mode);
    onDocumentViewModeChange?.(mode);
  };

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

  const deleteSelectedFile = async () => {
    const file = currentSelectedFile;
    if (!file?.id || !onDeletePermanently || isDeletingSelectedFile) return;
    if (!window.confirm(`Permanently delete “${file.name}”? This cannot be undone.`)) return;
    setDeleteFileError('');
    setIsDeletingSelectedFile(true);
    try {
      await onDeletePermanently(file.id);
      if (file.url.startsWith('blob:')) URL.revokeObjectURL(file.url);
      setSelectedFile(null);
    } catch (error) {
      setDeleteFileError(error instanceof Error ? error.message : 'Could not delete this paper. Please try again.');
    } finally {
      setIsDeletingSelectedFile(false);
    }
  };

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

  const hasDocument = uploadedFiles.length > 0 || !!examPaper || !!activeDocument || !!aiDesignBuffer;

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
    <div className="flex-1 min-h-[50vh] h-auto lg:h-full lg:pt-12 flex flex-col bg-[#FBF9F6] dark:bg-[#171717] overflow-y-auto select-text relative">
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#E8E4DC] bg-[#FBF9F6]/95 px-4 py-2 text-xs dark:border-[#2D2D32] dark:bg-[#141416]/95">
        <span className={studioProjectStatus === 'error' ? 'text-rose-500' : 'text-[#858075]'}>
          {studioProjectStatus === 'saving' ? 'Saving studio draft…' : studioProjectStatus === 'saved' ? 'All drafts saved' : studioProjectStatus === 'error' ? 'Save failed. Check connection and retry.' : 'Studio drafts save automatically'}
        </span>
        {savedStudioProjects.length > 1 && onLoadStudioProject && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Load saved studio project</span>
            <select aria-label="Load saved studio project" className="max-w-56 rounded border border-[#E8E4DC] bg-transparent px-2 py-1 dark:border-[#2D2D32]" value="" onChange={(event) => { if (event.target.value) onLoadStudioProject(event.target.value); }}>
              <option value="">Open saved project…</option>
              {savedStudioProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
        )}
      </div>
      {/* AI Draft Priority Layer */}
      {aiDesignBuffer && (
        <div className="absolute inset-0 z-[100] bg-[#FBF9F6]/95 dark:bg-[#141416]/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 lg:p-8 overflow-y-auto">
          <AssessmentDraftView schema={aiDesignBuffer} />

          <div className="mt-8 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] text-[#858075]">
            <BwengeLoader variant="compact" />
            Bwenge AI Architecture Suite Active
          </div>
        </div>
      )}

      {/* Create Form Priority Layer — shows the AI-generated form schema
          from POST /api/forms/generate, rendered live via DynamicForm */}
      {generatedForm && !aiDesignBuffer && (
        <div className="absolute inset-0 z-[100] bg-[#FBF9F6]/95 dark:bg-[#141416]/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 lg:p-8 overflow-y-auto">
          <FormBuilderView form={generatedForm} />
        </div>
      )}

      {showSavedForms && (
        <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm p-0 sm:p-5 flex items-center justify-center">
          <section className="w-full h-[100dvh] sm:h-[92dvh] max-w-6xl flex flex-col overflow-hidden bg-[#FBF9F6] dark:bg-[#141416] sm:rounded-3xl border border-[#E8E4DC] dark:border-[#2D2D32]">
            <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#E8E4DC] dark:border-[#2D2D32]">
              <div><h2 className="text-lg font-black text-[#191919] dark:text-white">My Forms &amp; Results</h2><p className="text-xs text-[#858075]">Responses, AI scores, selection, and exports</p></div>
              <button onClick={() => setShowSavedForms(false)} aria-label="Close forms dashboard" className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10"><X size={18} /></button>
            </header>
            <div className="flex-1 min-h-0 grid md:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="overflow-y-auto border-b md:border-b-0 md:border-r border-[#E8E4DC] dark:border-[#2D2D32] p-3 sm:p-4 max-h-[32vh] md:max-h-none">
                <button onClick={() => void showFormsDashboard()} className="mb-3 w-full rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-3 py-2 text-xs font-bold text-[#D97757]">Refresh forms</button>
                {isLoadingSavedForms && <p className="p-4 text-xs text-[#858075]">Loading forms…</p>}
                {savedFormsError && <p role="alert" className="p-3 text-xs text-rose-500">{savedFormsError}</p>}
                {!isLoadingSavedForms && !savedForms.length && !savedFormsError && <p className="p-4 text-xs text-[#858075]">No saved forms yet. Create and publish a form to start collecting responses.</p>}
                <div className="space-y-2">
                  {savedForms.map((form) => <button key={form.id} onClick={() => {
                    setActiveSavedForm(form);
                    setFormDashboardTab('responses');
                    setSelectionRequirements(form.selectionSettings?.requirements || form.schema?.requirements || form.schema?.description || '');
                    setFormAnalysis(null);
                    setFormAnalysisError('');
                    setFormAnalysisNotice('');
                    void loadFormResponses(form.id);
                  }} className={`w-full text-left rounded-xl border p-3 ${activeSavedForm?.id === form.id ? 'border-[#D97757] bg-[#D97757]/10' : 'border-[#E8E4DC] dark:border-[#2D2D32]'}`}>
                    <span className="block truncate text-sm font-bold text-[#191919] dark:text-white">{form.title}</span>
                    <span className="mt-1 block text-xs text-[#858075]">{form.responseCount} responses · updated {new Date(form.updatedAt).toLocaleDateString()}</span>
                  </button>)}
                </div>
              </aside>
              <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
                {!activeSavedForm ? <p className="py-12 text-center text-sm text-[#858075]">Choose a form to review responses and analyze candidates.</p> : <div className="mx-auto max-w-4xl space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><h3 className="text-xl font-black text-[#191919] dark:text-white">{activeSavedForm.title}</h3><p className="text-xs text-[#858075]">{activeSavedForm.responseCount} responses · {formAnalysis?.selectedCount || 0} selected</p></div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { void exportResponsesCsv().catch((error: any) => setFormAnalysisError(error.message)); }} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-3 py-2 text-xs font-bold">Export CSV</button>
                      <button onClick={() => { void loadFormResponses(activeSavedForm.id); }} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-3 py-2 text-xs font-bold">Refresh responses</button>
                      <a href={new URL(`/forms/${encodeURIComponent(activeSavedForm.id)}`, window.location.origin).toString()} target="_blank" rel="noreferrer" className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-3 py-2 text-xs font-bold">Open public form</a>
                    </div>
                  </div>
                  <div className="flex gap-2 border-b border-[#E8E4DC] dark:border-[#2D2D32]">
                    {(['responses', 'settings'] as const).map(tab => <button key={tab} onClick={() => setFormDashboardTab(tab)} className={`border-b-2 px-4 py-2 text-xs font-black capitalize ${formDashboardTab === tab ? 'border-[#D97757] text-[#D97757]' : 'border-transparent text-[#858075]'}`}>{tab}</button>)}
                  </div>
                  {formDashboardTab === 'responses' && <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[['Total responses', activeSavedForm.responseCount || 0], ['Latest response', formResponses[0] ? new Date(formResponses[0].submittedAt).toLocaleDateString() : '—'], ['Analyzed', formResponses.filter(response => response.analysis).length], ['Selected', formResponses.filter(response => response.analysis?.selected).length]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-3"><p className="text-[10px] uppercase tracking-wider text-[#858075]">{label}</p><p className="mt-1 truncate text-lg font-black text-[#D97757]">{value}</p></div>)}
                    </div>
                    {responsesLoading && <p className="py-8 text-center text-sm text-[#858075]">Loading responses…</p>}
                    {responsesError && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600">{responsesError}</p>}
                    {!responsesLoading && !responsesError && formResponses.length === 0 && <div className="rounded-2xl border border-dashed border-[#E8E4DC] p-8 text-center text-sm text-[#858075]">No responses yet. Copy the public link and share it to start collecting answers.</div>}
                    {formResponses.map((response, responseIndex) => <article key={response.id} className="rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-[#191919] dark:text-white">Response {formResponses.length - responseIndex}</h4><span className="text-xs text-[#858075]">{new Date(response.submittedAt).toLocaleString()}</span></div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.entries(response.answers || {}).map(([key, value]) => {
                        const definitions = [...(activeSavedForm.schema?.questions || []), ...(activeSavedForm.schema?.fields || [])];
                        const question = definitions.find((item: any, index: number) => String(item.id ?? item.number ?? index + 1) === key);
                        const displayValue = value && typeof value === 'object' ? Object.entries(value as Record<string, any>).map(([row, answer]) => `${row}: ${Array.isArray(answer) ? answer.join(', ') : answer}`).join(' · ') : Array.isArray(value) ? value.join(', ') : String(value ?? '');
                        return <div key={key} className="rounded-xl bg-[#F7F5F0] dark:bg-white/[0.04] p-3"><p className="text-[10px] font-bold text-[#858075]">{question?.title || question?.label || key}</p><p className="mt-1 break-words text-sm text-[#191919] dark:text-slate-200">{displayValue}</p></div>;
                      })}</div>
                      {response.analysis?.score != null && <p className="mt-3 text-xs font-bold text-[#D97757]">{response.analysis.ownerReviewed ? 'Reviewed score' : 'AI score'}: {response.analysis.score}/100 {response.analysis.selected ? '· Selected' : ''}</p>}
                      <form onSubmit={(event) => void saveResponseReview(event, response.id)} className="mt-4 grid gap-3 rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-[#F7F5F0]/70 dark:bg-white/[0.025] p-3 sm:grid-cols-[120px_1fr_auto] sm:items-end">
                        <label className="text-[11px] font-bold text-[#858075]">Score (0–100)
                          <input name="score" type="number" min="0" max="100" step="0.1" required value={response.analysis?.score ?? ''} onChange={(event) => {
                            const value = event.target.value;
                            setFormResponses((previous) => previous.map((item) => item.id === response.id ? { ...item, analysis: { ...(item.analysis || {}), score: value === '' ? null : Number(value) } } : item));
                          }} className="mt-1 w-full rounded-lg border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] px-2.5 py-2 text-sm text-[#191919] dark:text-white" />
                        </label>
                        <label className="text-[11px] font-bold text-[#858075]">Reviewer feedback
                          <textarea name="feedback" rows={2} maxLength={5000} defaultValue={response.analysis?.feedback || ''} className="mt-1 w-full resize-y rounded-lg border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] px-2.5 py-2 text-sm font-normal text-[#191919] dark:text-white" placeholder="Add evidence-based feedback" />
                        </label>
                        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-stretch">
                          <label className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold text-[#191919] dark:text-slate-200"><input name="selected" type="checkbox" defaultChecked={Boolean(response.analysis?.selected)} className="accent-[#D97757]" /> Select candidate</label>
                          <button type="submit" disabled={savingReviewId === response.id} className="rounded-lg bg-[#D97757] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{savingReviewId === response.id ? 'Saving…' : 'Save review'}</button>
                        </div>
                      </form>
                    </article>)}
                  </div>}
                  {formDashboardTab === 'settings' && <div className="rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-4 sm:p-5 space-y-3">
                    <h4 className="font-bold text-[#191919] dark:text-white">Form settings</h4>
                    <p className="text-xs text-[#858075]">Control whether respondents can submit new answers. Existing responses and analysis stay available while submissions are paused.</p>
                    <button onClick={() => { void toggleFormResponses().catch((error: any) => setFormAnalysisError(error.message)); }} className={`rounded-xl px-4 py-2.5 text-xs font-bold ${activeSavedForm.schema?.acceptingResponses === false ? 'bg-emerald-600 text-white' : 'border border-rose-300 text-rose-600'}`}>
                      {activeSavedForm.schema?.acceptingResponses === false ? 'Resume responses' : 'Pause responses'}
                    </button>
                    <label className="block text-xs font-bold text-[#191919] dark:text-white">Selection requirements
                      <textarea value={selectionRequirements} onChange={event => setSelectionRequirements(event.target.value)} rows={4} placeholder="Describe eligibility requirements and what makes a strong response…" className="mt-2 w-full rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-transparent p-3 text-sm font-normal outline-none focus:border-[#D97757]" />
                    </label>
                    <button onClick={() => { void saveSelectionRequirements().then(() => setFormAnalysisNotice('Requirements saved.')).catch((error: any) => setFormAnalysisError(error.message)); }} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-4 py-2.5 text-xs font-bold">Save requirements</button>
                    {formAnalysisError && <p role="alert" className="text-xs text-rose-500">{formAnalysisError}</p>}
                    {formAnalysisNotice && <p role="status" className="text-xs text-amber-600">{formAnalysisNotice}</p>}
                  </div>}
                  <div className="rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-4 sm:p-5 space-y-3">
                    <label className="block text-xs font-bold text-[#191919] dark:text-white">Selection requirements
                      <textarea value={selectionRequirements} onChange={(event) => setSelectionRequirements(event.target.value)} rows={4} placeholder="Describe eligibility requirements, priorities, and any disqualifying conditions…" className="mt-2 w-full rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-transparent p-3 text-sm font-normal outline-none focus:border-[#D97757]" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => { void saveSelectionRequirements().then(() => setFormAnalysisNotice('Requirements saved.')).catch((error: any) => setFormAnalysisError(error.message)); }} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] px-4 py-2.5 text-xs font-bold">Save requirements</button>
                      <button disabled={isAnalyzingForm || !activeSavedForm.responseCount} onClick={() => void runFormAnalysis()} className="rounded-xl bg-[#D97757] px-4 py-2.5 text-xs font-black text-white disabled:opacity-50">{isAnalyzingForm ? 'Analyzing responses…' : 'Analyze & select best fit'}</button>
                    </div>
                    {formAnalysisError && <p role="alert" className="text-xs text-rose-500">{formAnalysisError}</p>}
                    {formAnalysisNotice && <p role="status" className="text-xs text-amber-600">{formAnalysisNotice}</p>}
                  </div>
                  {formAnalysis && <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[['Responses', formAnalysis.totalSubmissions], ['Scored', formAnalysis.candidates?.filter((candidate: any) => candidate.score !== null).length || 0], ['Average score', formAnalysis.averageScore], ['Selected', formAnalysis.selectedCount]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-3"><p className="text-[10px] uppercase tracking-wider text-[#858075]">{label}</p><p className="mt-1 text-xl font-black text-[#D97757]">{value}</p></div>)}
                    </div>
                    {formAnalysis.qualitativeInsight && <p className="rounded-xl bg-[#D97757]/10 p-4 text-sm text-[#191919] dark:text-slate-200">{formAnalysis.qualitativeInsight}</p>}
                    <div className="space-y-3">
                      {(formAnalysis.candidates || []).map((candidate: any, index: number) => <article key={candidate.id} className="rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-white dark:bg-[#1C1C20] p-4 sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold text-[#191919] dark:text-white">#{index + 1} · {candidate.answers?.name || candidate.answers?.fullName || `Response ${formAnalysis.candidates.length - index}`}</h4><div className="flex items-center gap-2"><span className="rounded-full bg-[#D97757]/10 px-3 py-1 text-xs font-black text-[#D97757]">{candidate.score === null ? 'Not scored' : `${candidate.score}/100`}</span>{candidate.selected && <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">Selected</span>}</div></div>
                        <p className="mt-2 text-xs text-[#858075]">{candidate.feedback || 'Run AI analysis to score this response.'}</p>
                        <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-[#D97757]">View answers and score details</summary><div className="mt-3 grid sm:grid-cols-2 gap-2">{Object.entries(candidate.answers || {}).map(([key, value]) => <div key={key} className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3"><p className="text-[10px] text-[#858075]">{activeSavedForm.schema?.questions?.find((question: any, questionIndex: number) => String(question.id ?? question.number ?? questionIndex + 1) === key)?.title || key}</p><p className="mt-1 break-words text-xs text-[#191919] dark:text-slate-200">{Array.isArray(value) ? value.join(', ') : String(value)}</p></div>)}</div></details>
                      </article>)}
                    </div>
                  </>}
                </div>}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Persistent AI Agent Status Bar */}
      {agentStatus && !aiDesignBuffer && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-4 duration-500">
          <div className="px-6 py-3 rounded-full bg-[#191919] dark:bg-[#F3F3F3] text-white dark:text-[#191919] text-[10px] font-bold shadow-2xl flex items-center gap-4 border border-white/10">
            <BwengeLoader variant="compact" />
            <div className="flex flex-col">
              <span className="opacity-70 uppercase tracking-widest text-[8px]">Bwenge Status</span>
              <span>{agentStatus}</span>
            </div>
          </div>
        </div>
      )}

      {!hasDocument ? (
        /* Default State (When No Student File is Uploaded) */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          className={`flex-1 w-full h-full min-h-[60vh] lg:min-h-[80vh] flex flex-col items-center justify-center p-6 sm:p-8 text-center select-none transition-all duration-500 ${
            isDragging ? 'bg-[#F2EFE9] dark:bg-[#1A1A1E]' : ''
          }`}
        >
          <div className="max-w-md w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="relative">
              <div className="w-20 h-20 rounded-[28px] bg-[#D97757] text-white flex items-center justify-center text-3xl font-bold mx-auto shadow-2xl shadow-[#D97757]/30 transform rotate-3 hover:rotate-0 transition-transform cursor-default">
                <BookOpen size={32} />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-4 border-[#FBF9F6] dark:border-[#141416] animate-pulse" />
            </div>

            <div className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight text-[#191919] dark:text-[#F3F3F3]">
                Bwenge AI <span className="text-[#D97757]">Workspace</span>
              </h2>
              <p className="text-sm text-[#66635B] dark:text-[#A0A0AA] font-medium leading-relaxed">
                Upload or scan student scripts, build forms, and review marked exams. To mark a class, you can also just send the scripts in the chat.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="*/*"
                onChange={handleFileInputChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUploadClick();
                }}
                className="group p-5 rounded-2xl bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D97757]/10 text-[#D97757] flex items-center justify-center mb-3 group-hover:bg-[#D97757] group-hover:text-white transition-colors">
                  <Plus size={20} />
                </div>
                <span className="text-sm font-bold text-[#191919] dark:text-[#F3F3F3] block">
                  Upload Paper
                </span>
                <span className="text-[10px] text-[#858075] font-medium mt-1 block">
                  PDF, photos, Word, ZIP
                </span>
              </button>

              {onOpenScanner && <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenScanner?.();
                }}
                className="group p-5 rounded-2xl bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D97757]/10 text-[#D97757] flex items-center justify-center mb-3 group-hover:bg-[#D97757] group-hover:text-white transition-colors">
                  <Maximize2 size={20} />
                </div>
                <span className="text-sm font-bold text-[#191919] dark:text-[#F3F3F3] block">
                  Live Scanner
                </span>
                <span className="text-[10px] text-[#858075] font-medium mt-1 block">
                  Phone / Camera
                </span>
              </button>}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenManualBuilder();
                }}
                className="group p-5 rounded-2xl bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D97757]/10 text-[#D97757] flex items-center justify-center mb-3 group-hover:bg-[#D97757] group-hover:text-white transition-colors">
                  <FileText size={20} />
                </div>
                <span className="text-sm font-bold text-[#191919] dark:text-[#F3F3F3] block">
                  Create Form
                </span>
                <span className="text-[10px] text-[#858075] font-medium mt-1 block">
                  Build it question-by-question
                </span>
              </button>

              <a
                href="/exams"
                onClick={(e) => e.stopPropagation()}
                className="group p-5 rounded-2xl bg-white dark:bg-[#202024] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] text-left transition-all shadow-sm hover:shadow-xl hover:-translate-y-1 active:translate-y-0"
              >
                <div className="w-10 h-10 rounded-xl bg-[#D97757]/10 text-[#D97757] flex items-center justify-center mb-3 group-hover:bg-[#D97757] group-hover:text-white transition-colors">
                  <CheckCircle2 size={20} />
                </div>
                <span className="text-sm font-bold text-[#191919] dark:text-[#F3F3F3] block">
                  Marked Exams
                </span>
                <span className="text-[10px] text-[#858075] font-medium mt-1 block">
                  Review red marks, release PDFs
                </span>
              </a>

              <button type="button" onClick={(event) => { event.stopPropagation(); void showFormsDashboard(); }} className="col-span-2 rounded-2xl border border-[#D97757]/40 bg-[#D97757]/10 p-4 text-left text-[#191919] shadow-sm transition-colors hover:bg-[#D97757]/20 dark:text-white">
                <span className="block text-sm font-bold">My Forms &amp; Results</span>
                <span className="mt-1 block text-[10px] opacity-70">Review responses, export data, and ask AI to shortlist candidates</span>
              </button>
            </div>

          </div>
        </div>
      ) : (
        /* Active State: High-Density Scaling Canvas for Mass Student Paper Uploads */
        <div className="flex-1 w-full flex flex-col items-center justify-between relative p-3 sm:p-4 lg:p-6 overflow-y-auto min-h-0">
          <div className="w-full max-w-7xl flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold text-[#191919] dark:text-[#F3F3F3]">Student papers</p>
              <p className="text-xs text-[#858075] dark:text-[#888892]">
                {activeFiles.length} uploaded • {viewMode === 'grid' ? 'Grid' : 'List'} view active
              </p>
            </div>

            <div className="flex items-center gap-2 bg-[#F4F0E8] dark:bg-[#202024] p-1 rounded-xl border border-[#E8E4DC] dark:border-[#2D2D32]">
              <button
                onClick={() => changeViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-[#2D2D32] text-[#D97757] shadow-sm'
                    : 'text-[#858075] hover:text-[#D97757]'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => changeViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-[#2D2D32] text-[#D97757] shadow-sm'
                    : 'text-[#858075] hover:text-[#D97757]'
                }`}
              >
                List
              </button>
            </div>
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
            ) : viewMode === 'list' ? (
              <div className="w-full max-w-4xl space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {activeFiles.map((file, idx) => {
                  const studentNum = uploadedFiles.findIndex((f) => f.id === file.id) + 1;
                  return (
                    <div
                      key={file.id || idx}
                      onClick={() => setSelectedFile(file)}
                      className="group flex items-center justify-between p-4 bg-white dark:bg-[#1C1C20] rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] hover:border-[#D97757] transition-all cursor-pointer shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-[#D97757]/10 text-[#D97757] flex items-center justify-center text-xs font-black">
                          {studentNum}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[#191919] dark:text-[#F3F3F3]">
                            {file.studentName || `Student ${studentNum}`}
                          </p>
                          <p className="text-[10px] text-[#858075] uppercase tracking-wider font-bold">
                            {file.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {file.isFlagged && <Flag className="w-4 h-4 text-amber-500 fill-current" />}
                        <div className="text-[10px] font-mono text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md">
                          READY
                        </div>
                        <button
                          onClick={(e) => handleSoftDeleteCard(e, file.id)}
                          className="p-2 rounded-lg hover:bg-rose-500/10 text-[#858075] hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
                      style={{ contentVisibility: 'auto', containIntrinsicSize: '150px 200px' } as any}
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
                                {file.rawText || `Physics HL Assessment — Student #${displayNum}`}
                              </div>
                            </div>

                            {/* Crisp Sub-Pixel Footer Tag */}
                            <div className="pt-0.5 border-t border-dashed border-[#E8E4DC] dark:border-[#2D2D32] flex items-center justify-between text-[5px] sm:text-[6px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                              <span className="subpixel-antialiased">✓ Marked</span>
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
                <div className="w-full max-w-5xl h-[92vh] bg-[#FBF9F6] dark:bg-[#18181B] rounded-[32px] border border-[#E8E4DC] dark:border-[#2D2D32] shadow-2xl flex flex-col overflow-hidden relative animate-in zoom-in-95 duration-300">
                  {/* Floating Tool Ribbon in Magnified View */}
                  <div className="p-4 border-b border-[#E8E4DC] dark:border-[#2D2D32] bg-[#FFFFFF]/90 dark:bg-[#1F1F23]/90 backdrop-blur-md flex items-center justify-between z-20">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center space-x-2">
                        <span className="w-8 h-8 rounded-xl bg-[#D97757] text-white flex items-center justify-center text-xs font-black shadow-lg shadow-[#D97757]/20">
                          {displayNum}
                        </span>
                        <div>
                          <span className="text-xs font-black uppercase tracking-widest text-[#D97757] block leading-none mb-1">
                            Script Viewer
                          </span>
                          <span className="text-[10px] font-bold text-[#66635B] dark:text-[#A0A0AA] block">
                            Student Paper #{displayNum}
                          </span>
                        </div>
                      </div>

                      {onPinSyllabus && (
                        <button
                          onClick={() => onPinSyllabus(pinnedSyllabusId === selectedFile.id ? null : selectedFile.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            pinnedSyllabusId === selectedFile.id
                              ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                              : 'bg-[#F4F0E8] dark:bg-[#202024] text-[#858075] hover:text-amber-600'
                          }`}
                        >
                          <Paperclip size={14} className={pinnedSyllabusId === selectedFile.id ? 'rotate-45' : ''} />
                          {pinnedSyllabusId === selectedFile.id ? 'Pinned as Syllabus' : 'Pin as Syllabus'}
                        </button>
                      )}
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
                                      text: `🤖 AI Re-Grade Rule: "${reGradePromptText}" (+1 mark awarded)`,
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
                                    text: `🤖 AI Re-Grade Rule: "${reGradePromptText}" (+1 mark awarded)`,
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
                      onClick={deleteSelectedFile}
                      disabled={!currentSelectedFile?.id || !onDeletePermanently || isDeletingSelectedFile}
                      className="px-2.5 py-1 rounded-full bg-red-600/15 text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                      title="Permanently delete student paper"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{isDeletingSelectedFile ? 'Deleting…' : 'Delete Permanently'}</span>
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

                {deleteFileError && (
                  <p role="alert" className="px-4 py-2 text-sm text-rose-500">{deleteFileError}</p>
                )}

                {/* Magnified Interactive Document Canvas */}
                <div
                  onMouseUp={handleMouseUpInMagnified}
                  className="flex-1 overflow-y-auto p-6 relative select-text transition-transform duration-700 ease-in-out"
                  style={zoomTarget ? {
                    transform: `scale(${zoomLevel}) translate(${50 - zoomTarget.x}%, ${50 - zoomTarget.y}%)`,
                    transformOrigin: '0 0'
                  } : {}}
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
                      {selectedFile.rawText || `Student Answer Sheet content extracted.`}
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

                  {/* AI vision-marking evidence overlays. Populated by the AI
                      re-grade / auto-mark pipeline (see visualAnnotations
                      state above) with normalized [0-100] coordinates so
                      boxes stay aligned regardless of the rendered page
                      size. */}
                  {visualAnnotations.map((anno) => (
                    <div
                      key={anno.id}
                      onClick={() => handleAnnotationClick(anno)}
                      style={anno.coordinates ? {
                        top: `${anno.coordinates.y}%`,
                        left: `${anno.coordinates.x}%`,
                        width: `${anno.coordinates.width}%`,
                        height: `${anno.coordinates.height}%`,
                        transform: 'none'
                      } : {
                        top: `${anno.y}%`,
                        left: `${anno.x}%`,
                        transform: 'translate(-50%, -50%)'
                      }}
                      className={`group absolute z-40 px-3 py-1.5 rounded-xl shadow-xl text-[10px] font-bold border-2 animate-in zoom-in-50 duration-300 cursor-pointer hover:scale-110 transition-all ${
                        anno.type === 'error'
                          ? 'bg-rose-600/90 text-white border-rose-400'
                          : 'bg-emerald-600/90 text-white border-emerald-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={10} className="animate-pulse" />
                        <span>AI: {anno.label}</span>
                      </div>

                      {/* Evidence Tooltip on Hover */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 p-2 bg-slate-900 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-[9px] font-medium leading-tight shadow-2xl">
                         {anno.reason || "Vision evidence extracted for rubric verification."}
                      </div>

                      {/* Pulse ring */}
                      <div className="absolute inset-0 rounded-xl border-2 border-white/50 animate-ping opacity-20" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        </div>
      )}

      {/* Create Form intake modal — collects the natural-language intent
          that's sent to POST /api/forms/generate */}
      {showFormCreatorModal && (
        <div className="fixed inset-0 z-[110] bg-[#141416]/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white dark:bg-[#1C1C20] border border-[#E8E4DC] dark:border-[#2D2D32] rounded-[28px] shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#D97757]">
                  <FileText size={14} />
                  Create Form
                </div>
                <h3 className="text-lg font-black text-[#191919] dark:text-[#F3F3F3]">
                  Describe the form and candidate requirements
                </h3>
              </div>
              <button
                onClick={() => setShowFormCreatorModal(false)}
                className="p-1.5 rounded-full hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] text-[#858075] hover:text-[#191919] dark:hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-[#66635B] dark:text-[#A0A0AA] leading-relaxed">
              Include the purpose, questions, eligibility rules, and what makes a strong candidate. AI can use these requirements to score and shortlist submissions.
            </p>

            <textarea
              value={formIntentText}
              onChange={(e) => { setFormIntentText(e.target.value); setDraftRequirements(e.target.value); }}
              rows={4}
              placeholder="Scholarship application: collect grades, financial need, leadership, and goals. Select the strongest eligible applicants..."
              className="w-full rounded-2xl border border-[#E8E4DC] dark:border-[#2D2D32] bg-[#FBF9F6] dark:bg-[#141416] px-4 py-3 text-sm text-[#191919] dark:text-[#F3F3F3] placeholder:text-[#858075] outline-none focus:border-[#D97757] transition-colors resize-none"
              autoFocus
            />

            {formGenError && (
              <div className="text-xs font-semibold text-rose-500 bg-rose-500/10 rounded-xl px-3 py-2">
                {formGenError}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleGenerateForm}
                disabled={isGeneratingForm || !formIntentText.trim()}
                className={`flex-1 px-5 py-3 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 active:scale-95 ${
                  isGeneratingForm || !formIntentText.trim()
                    ? 'bg-slate-400 cursor-not-allowed opacity-50 text-white'
                    : 'bg-[#D97757] hover:bg-[#C56648] text-white shadow-lg shadow-[#D97757]/20'
                }`}
              >
                {isGeneratingForm ? (
                  <>
                    <BwengeLoader variant="compact" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Generate Form
                  </>
                )}
              </button>
              <button
                onClick={() => setShowFormCreatorModal(false)}
                className="px-5 py-3 rounded-2xl font-bold text-sm text-[#66635B] dark:text-[#A0A0AA] hover:bg-[#F4F0E8] dark:hover:bg-[#2D2D32] transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>

            <div className="text-center pt-1">
              <button
                onClick={() => {
                  setShowFormCreatorModal(false);
                  handleOpenManualBuilder();
                }}
                className="text-xs font-semibold text-[#858075] hover:text-[#D97757] transition-colors"
              >
                Prefer to build it yourself? Start from scratch →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated full-screen form studio with the shared live respondent preview. */}
      {showManualFormBuilder && (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#F4F4F1]">
          <FormBuilder
            key="manual-form-builder"
            initialSchema={formBuilderInitialSchema}
            onChange={schema => {
              try { localStorage.setItem('bwenge-form-builder-draft', JSON.stringify(schema)); } catch { /* local storage may be unavailable */ }
            }}
            onBack={() => setShowManualFormBuilder(false)}
            onResults={() => { setShowManualFormBuilder(false); void showFormsDashboard(); }}
            onPublish={publishFormBuilderSchema}
            onUpdateSettings={async (settings) => {
              if (!manualPublishedFormId) throw new Error('Publish the form before changing response settings.');
              const response = await authFetch(`/api/forms/${manualPublishedFormId}/settings`, {
                method: 'PATCH', body: JSON.stringify(settings),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error || 'Could not update response settings.');
            }}
            onRunAgent={runFormBuilderAgent}
          />
        </div>
      )}
    </div>
  );
};
