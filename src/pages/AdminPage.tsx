import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, BarChart3, BookOpen, Boxes, CheckCircle2, ChevronDown, ChevronRight, Cpu, Database,
  FileText, FlaskConical, GraduationCap, Info, KeyRound, LayoutDashboard, Mail, Menu, MessageSquare, Play, Plus,
  RefreshCw, ScrollText, Search, Send, Settings, Sparkles, Trash2, Upload, Users, X, ShieldCheck
} from 'lucide-react';
import { adminApi, type AdminQualitySummary } from '../api/admin';
import { useStore } from '../store/useStore';

/* ───────────── Types ───────────── */
type Env = 'draft' | 'testing' | 'production';
type TabId = 'overview' | 'finetune' | 'datasets' | 'models' | 'knowledge' | 'documents' | 'playground'
  | 'review' | 'verified' | 'retrieval' | 'prompts' | 'providers' | 'analytics' | 'quality' | 'users' | 'logs' | 'settings'
  | 'feedback' | 'communication' | 'billing';

const DATASET_FILE_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.js,.ts,.tsx,.jsx,.py,.java,.kt,.cpp,.c,.h,.cs,.rs,.go,.sql,.html,.css,.yaml,.yml,.sh';

interface NavCategory {
  title: string;
  icon: ReactNode;
  items: { id: TabId; label: string; icon: ReactNode }[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    title: 'Overview & Telemetry',
    icon: <BarChart3 size={15} className="text-[#3FA7E0]" />,
    items: [
      { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
      { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} /> },
      { id: 'quality', label: 'AI Quality', icon: <FlaskConical size={16} /> },
    ],
  },
  {
    title: 'AI & Prompt Adapters',
    icon: <Sparkles size={15} className="text-[#F2C230]" />,
    items: [
      { id: 'finetune', label: 'Dataset-grounded Prompt Adapter', icon: <GraduationCap size={16} /> },
      { id: 'models', label: 'Model Registry', icon: <Boxes size={16} /> },
      { id: 'playground', label: 'AI Playground', icon: <FlaskConical size={16} /> },
      { id: 'prompts', label: 'System Prompts', icon: <ScrollText size={16} /> },
      { id: 'providers', label: 'AI Connections & Providers', icon: <KeyRound size={16} /> },
    ],
  },
  {
    title: 'Knowledge & Datasets',
    icon: <Database size={15} className="text-[#3DB27A]" />,
    items: [
      { id: 'datasets', label: 'Datasets & Curations', icon: <Database size={16} /> },
      { id: 'knowledge', label: 'Knowledge Bases', icon: <BookOpen size={16} /> },
      { id: 'documents', label: 'Document Ingestion', icon: <FileText size={16} /> },
      { id: 'retrieval', label: 'Retrieval Settings', icon: <Search size={16} /> },
    ],
  },
  {
    title: 'Operations & Governance',
    icon: <ShieldCheck size={15} className="text-[#FF8798]" />,
    items: [
      { id: 'review', label: 'Review Queue', icon: <CheckCircle2 size={16} /> },
      { id: 'verified', label: 'Verified Answers', icon: <Sparkles size={16} /> },
      { id: 'users', label: 'User & Roles', icon: <Users size={16} /> },
      { id: 'feedback', label: 'Feedback & Support', icon: <MessageSquare size={16} /> },
      { id: 'billing', label: 'Upgrades & Subscriptions', icon: <ShieldCheck size={16} /> },
      { id: 'communication', label: 'Email Communication', icon: <Mail size={16} /> },
      { id: 'logs', label: 'System Audit Logs', icon: <Activity size={16} /> },
      { id: 'settings', label: 'Control Plane', icon: <Settings size={16} /> },
    ],
  },
];

/* ───────────── UI primitives ───────────── */
const card = 'rounded-2xl border border-[#263052]/90 bg-gradient-to-b from-[#18203B]/90 to-[#11172A]/90 shadow-2xl shadow-black/50 min-w-0 box-border backdrop-blur-md transition-all duration-300 hover:border-[#3FA7E0]/50 hover:shadow-[#3FA7E0]/10 hover:shadow-xl';
const input = 'w-full box-border rounded-xl border border-[#2A3760] bg-[#0D1220] px-4 py-3 text-base sm:text-sm text-[#E8EAF2] placeholder-[#6C789E] focus:border-[#3FA7E0] focus:outline-none focus:ring-4 focus:ring-[#3FA7E0]/15 transition-all shadow-inner';
const btn = 'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition-all disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FA7E0] cursor-pointer shrink-0 shadow-sm active:scale-[0.98]';
const btnPrimary = `${btn} bg-gradient-to-r from-[#3FA7E0] via-[#48B3EC] to-[#60C0F3] text-[#08101F] hover:from-[#48B3EC] hover:to-[#76C5EF] font-bold shadow-[#3FA7E0]/25 shadow-lg`;
const btnGhost = `${btn} border border-[#2A3760] bg-[#18213D] text-[#E8EAF2] hover:bg-[#222E54] hover:border-[#3FA7E0]/40 shadow-black/20`;

function Section({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#202945] pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-white sm:text-2xl tracking-tight truncate flex items-center gap-2.5">
            <span className="w-2 h-6 rounded-full bg-gradient-to-b from-[#3FA7E0] to-[#2470A2] inline-block shadow-sm shadow-[#3FA7E0]" />
            {title}
          </h2>
          {hint && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#9AA6C9]">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2.5 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className={`${card} p-5 sm:p-6 min-w-0 relative overflow-hidden group`}>
      <div className="absolute top-0 right-0 w-28 h-28 bg-gradient-to-bl from-[#3FA7E0]/10 to-transparent rounded-bl-full pointer-events-none transition-transform duration-500 group-hover:scale-125" />
      <p className="text-xs font-semibold uppercase tracking-wider text-[#9AA6C9] truncate">{label}</p>
      <p className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums truncate drop-shadow">{value}</p>
      {detail && <p className="mt-2 text-xs text-[#7C8CB8] font-medium truncate flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#3FA7E0]" />{detail}</p>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-[#3DB27A]/15 text-[#6FD6A2] border-[#3DB27A]/40 shadow-sm shadow-[#3DB27A]/10',
  yellow: 'bg-[#F2C230]/15 text-[#F2C230] border-[#F2C230]/40 shadow-sm shadow-[#F2C230]/10',
  red: 'bg-[#E5586B]/15 text-[#FF8798] border-[#E5586B]/40 shadow-sm shadow-[#E5586B]/10',
  blue: 'bg-[#3FA7E0]/15 text-[#7CC4EE] border-[#3FA7E0]/40 shadow-sm shadow-[#3FA7E0]/10',
  gray: 'bg-white/5 text-[#9AA6C9] border-white/10',
};
function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${TONES[tone] || TONES.gray}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {children}
    </span>
  );
}

function Field({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 min-w-0">
      <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#B7C1DE] truncate">
        {label}
        {tip && <span title={tip} className="cursor-help text-[#6C789E] hover:text-[#3FA7E0]"><Info size={14} /></span>}
      </span>
      {children}
    </label>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-950/40 via-red-900/20 to-red-950/40 p-8 text-center space-y-4 shadow-xl">
      <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center mx-auto text-red-300 font-bold text-lg">!</div>
      <div className="space-y-1">
        <h3 className="text-base font-bold text-white">Connection or Database Error</h3>
        <p className="text-sm text-red-200 max-w-lg mx-auto break-words">{message}</p>
      </div>
      <button onClick={onRetry} className={btnPrimary}>
        <RefreshCw size={16} /> Retry Server Connection
      </button>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`${card} p-6 space-y-3`}>
            <div className="h-3 bg-[#263052] rounded w-1/2" />
            <div className="h-8 bg-[#263052] rounded w-3/4" />
            <div className="h-3 bg-[#263052] rounded w-2/3" />
          </div>
        ))}
      </div>
      <div className={`${card} p-8 space-y-4`}>
        <div className="h-5 bg-[#263052] rounded w-1/3" />
        <div className="h-32 bg-[#263052]/50 rounded-xl" />
      </div>
    </div>
  );
}

function EmptyState({ title, desc, icon, action }: { title: string; desc: string; icon: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${card} p-12 text-center space-y-4 flex flex-col items-center justify-center`}>
      <div className="w-16 h-16 rounded-2xl bg-[#3FA7E0]/10 border border-[#3FA7E0]/30 flex items-center justify-center text-[#3FA7E0] shadow-lg shadow-[#3FA7E0]/10">
        {icon}
      </div>
      <div className="space-y-1.5 max-w-md">
        <h3 className="text-base font-bold text-white">{title}</h3>
        <p className="text-xs sm:text-sm text-[#9AA6C9] leading-relaxed">{desc}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

function displayFeedbackReasons(value: string) {
  try {
    const reasons = JSON.parse(value);
    return Array.isArray(reasons) ? reasons.join(', ') : value;
  } catch {
    return value;
  }
}

/* ───────────── Main Admin Component ───────────── */
export default function AdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<TabId>('overview');
  const [env, setEnv] = useState<Env>('production');
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collapsible category accordion state
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (title: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  // Data states from real server
  const [overview, setOverview] = useState<any>(null);
  const [health, setHealth] = useState<any[]>([]);
  const [kbs, setKbs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [quality, setQuality] = useState<AdminQualitySummary | null>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [providerForms, setProviderForms] = useState<Record<string, { model: string; baseUrl: string }>>({});
  const [newProvider, setNewProvider] = useState('GONKAROUTER');
  const [newProviderModel, setNewProviderModel] = useState('');
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<any[]>([]);
  const [billingData, setBillingData] = useState<{ subscriptions: any[]; payments: any[]; requests: any[] }>({ subscriptions: [], payments: [], requests: [] });
  const [billingSearch, setBillingSearch] = useState('');
  const [billingUserId, setBillingUserId] = useState('');
  const [billingPlan, setBillingPlan] = useState('PRO');
  const [billingStatus, setBillingStatus] = useState('ACTIVE');
  const [billingEndDate, setBillingEndDate] = useState('');
  const [feedbackDatasetId, setFeedbackDatasetId] = useState('');
  const [feedbackCorrections, setFeedbackCorrections] = useState<Record<string, string>>({});
  const [userSearch, setUserSearch] = useState('');
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const currentAdminId = useStore((state) => state.user?.id);
  const [datasetAdapterJobs, setDatasetAdapterJobs] = useState<any[]>([]);
  const [retrievalSet, setRetrievalSet] = useState<any>(null);

  // Dataset-grounded prompt adapter configuration state
  const [ftDatasetId, setFtDatasetId] = useState('');
  const [ftBaseModel, setFtBaseModel] = useState('zai-org/GLM-5.3-Flash');
  const [ftSuffix, setFtSuffix] = useState('bwenge-domain-v1');
  const [ftAutoApprove, setFtAutoApprove] = useState(true);
  const [ftStarting, setFtStarting] = useState(false);
  const [selectedFtJob, setSelectedFtJob] = useState<any | null>(null);
  const [ftTestPrompt, setFtTestPrompt] = useState('');
  const [ftTestOutput, setFtTestOutput] = useState<any | null>(null);
  const [ftTesting, setFtTesting] = useState(false);
  const [newExampleConsent, setNewExampleConsent] = useState(false);
  const [newExamplePiiReviewed, setNewExamplePiiReviewed] = useState(false);

  // Dataset & Examples state
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetDesc, setNewDatasetDesc] = useState('');
  const [inspectDataset, setInspectDataset] = useState<any | null>(null);
  const [datasetExamples, setDatasetExamples] = useState<any[]>([]);
  const [datasetExamplesLoading, setDatasetExamplesLoading] = useState(false);
  const [datasetFileUploading, setDatasetFileUploading] = useState(false);
  const [datasetAdapterStarting, setDatasetAdapterStarting] = useState<string | null>(null);
  const [newExInstruction, setNewExInstruction] = useState('');
  const [newExInput, setNewExInput] = useState('');
  const [newExOutput, setNewExOutput] = useState('');

  // Knowledge Base & Model & Prompt inline creation state
  const [newKbName, setNewKbName] = useState('');
  const [newKbDesc, setNewKbDesc] = useState('');
  const [newKbGlobalApproved, setNewKbGlobalApproved] = useState(false);
  const [newModelName, setNewModelName] = useState('');
  const [newModelBase, setNewModelBase] = useState('zai-org/GLM-5.3-Flash');
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');

  // Document upload state
  const [uploadKbId, setUploadKbId] = useState('');
  const [uploadDomain, setUploadDomain] = useState('general');
  const [uploadLang, setUploadLang] = useState('rw');
  const [uploadRegion, setUploadRegion] = useState('Rwanda');
  const [uploadConsent, setUploadConsent] = useState(false);
  const [inspectingDoc, setInspectingDoc] = useState<any | null>(null);
  const [inspectChunks, setInspectChunks] = useState<any[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Playground state
  const [pgQ, setPgQ] = useState('');
  const [pgKb, setPgKb] = useState('');
  const [pgModel, setPgModel] = useState('');
  const [pgResult, setPgResult] = useState<any>(null);
  const [pgLoading, setPgLoading] = useState(false);

  // Corrections & Verified Answers state (Phases 2, 3, 4)
  const [corrections, setCorrections] = useState<any[]>([]);
  const [verifiedAnswers, setVerifiedAnswers] = useState<any[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctionErrorType, setCorrectionErrorType] = useState('wrong_fact');
  const [correctionSeverity, setCorrectionSeverity] = useState('minor');
  const [correctedText, setCorrectedText] = useState('');
  const [correctionDomain] = useState('general');

  const notify = (msg: string, bad = false) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [ov, hl, kbList, docList, dsList, mdList, prList, usList, lgList, anData, qData, prvList, ftList, rsData, corrList, verList, fbList, billData] = await Promise.all([
        adminApi.getOverview(),
        adminApi.getHealth(),
        adminApi.getKnowledgeBases(),
        adminApi.getDocuments(),
        adminApi.getDatasets(),
        adminApi.getModels(),
        adminApi.getPrompts(),
        adminApi.getUsers(),
        adminApi.getAuditLogs(50),
        adminApi.getAnalytics('7d'),
        adminApi.getQuality(),
        adminApi.getProviders(),
        adminApi.getDatasetAdapters(),
        adminApi.getRetrievalSettings(env),
        adminApi.getCorrections(),
        adminApi.getVerifiedAnswers(),
        adminApi.getFeedback(),
        adminApi.getBilling(),
      ]);

      setOverview(ov.data);
      setHealth(hl.data);
      setKbs(kbList.data);
      setDocs(docList.data);
      setDatasets(dsList.data);
      setModels(mdList.data);
      setPrompts(prList.data);
      setUsers(usList.data);
      setAuditLogs(lgList.data);
      setAnalytics(anData.data);
      setQuality(qData.data);
      setProviders(prvList.data);
      setProviderForms(prvList.data.reduce((forms: Record<string, { model: string; baseUrl: string }>, provider: any) => {
        forms[provider.provider] = { model: provider.model || '', baseUrl: provider.baseUrl || '' };
        return forms;
      }, {}));
      setFeedbackItems(fbList.data);
      setBillingData(billData.data);
      setDatasetAdapterJobs(ftList.data);
      setRetrievalSet(rsData.data);
      setCorrections(corrList.data);
      setVerifiedAnswers(verList.data);

      if (dsList.data.length > 0 && !ftDatasetId) {
        setFtDatasetId(dsList.data[0].id);
      }
      if (dsList.data.length > 0 && !dsList.data.some((dataset: any) => dataset.id === feedbackDatasetId)) {
        setFeedbackDatasetId(dsList.data[0].id);
      } else if (dsList.data.length === 0 && feedbackDatasetId) {
        setFeedbackDatasetId('');
      }
      if (ftList.data.length > 0) {
        setSelectedFtJob((prev: any) => {
          if (!prev) return ftList.data[0];
          return ftList.data.find((j: any) => j.id === prev.id) || ftList.data[0];
        });
      }
    } catch (err: any) {
      if (!silent) setError(err.message || 'Failed to connect to backend server.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [env, ftDatasetId, feedbackDatasetId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!billingUserId && users.length > 0) {
      const userId = users[0].id;
      const subscription = billingData.subscriptions.find((entry) => entry.userId === userId);
      setBillingUserId(userId);
      setBillingPlan(subscription?.planType || 'PRO');
      setBillingStatus(subscription?.status || 'ACTIVE');
      setBillingEndDate(subscription?.endDate ? new Date(subscription.endDate).toISOString().slice(0, 10) : '');
    }
  }, [billingData.subscriptions, billingUserId, users]);

  // Auto-poll adapter builds while they are queued or running.
  useEffect(() => {
    const hasActiveBuild = datasetAdapterJobs.some((j) => j.status === 'BUILDING_ADAPTER' || j.status === 'QUEUED');
    if (!hasActiveBuild) return;
    const timer = window.setInterval(async () => {
      try {
        const [ftList, mdList, ov] = await Promise.all([
          adminApi.getDatasetAdapters(),
          adminApi.getModels(),
          adminApi.getOverview(),
        ]);
        setDatasetAdapterJobs(ftList.data);
        setModels(mdList.data);
        setOverview(ov.data);
        setSelectedFtJob((prev: any) => {
          if (!prev) return ftList.data[0] || null;
          return ftList.data.find((j: any) => j.id === prev.id) || prev;
        });
      } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, [datasetAdapterJobs]);

  const go = (id: TabId) => { setTab(id); setDrawer(false); };

  const openDatasetInspector = async (ds: any) => {
    setInspectDataset(ds);
    setDatasetExamplesLoading(true);
    try {
      const res = await adminApi.getDatasetExamples(ds.id);
      setDatasetExamples(res.data);
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setDatasetExamplesLoading(false);
    }
  };

  const uploadFileToDataset = async (dataset: any, file: File, inspectAfterUpload = false) => {
    const formData = new FormData();
    formData.append('file', file);
    setDatasetFileUploading(true);
    try {
      const result = await adminApi.uploadDatasetFile(dataset.id, formData);
      await loadData(true);
      if (inspectAfterUpload || inspectDataset?.id === dataset.id) {
        await openDatasetInspector(dataset);
      }
      notify(result.message || 'File extracted into pending dataset examples.');
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setDatasetFileUploading(false);
    }
  };

  const buildDatasetKnowledgeAdapter = async (dataset: any) => {
    setDatasetAdapterStarting(dataset.id);
    try {
      const result: any = await adminApi.createDatasetAdapter({
        datasetId: dataset.id,
        baseModel: ftBaseModel,
        suffix: ftSuffix,
        targetEnvironment: env,
        autoApprove: true,
      });
      setSelectedFtJob(result.data);
      setFtDatasetId(dataset.id);
      setTab('finetune');
      notify('Dataset knowledge adapter build started.');
      await loadData(true);
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setDatasetAdapterStarting(null);
    }
  };

  return (
    <div className="h-dvh min-h-screen bg-[#070B14] text-[#E8EAF2] flex flex-col overflow-hidden font-sans">
      {toast && (
        <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-50 rounded-2xl px-5 py-3.5 text-sm font-semibold shadow-2xl border backdrop-blur-md ${toast.bad ? 'bg-red-950/95 border-red-500/50 text-red-200 shadow-red-950/50' : 'bg-[#141C33]/95 border-[#3FA7E0]/50 text-[#7CC4EE] shadow-black/60'}`}>
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full ${toast.bad ? 'bg-red-400' : 'bg-[#3FA7E0]'}`} />
            {toast.msg}
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 bg-black/70 z-40 backdrop-blur-sm lg:hidden transition-opacity" onClick={() => setDrawer(false)} />
      )}

      {/* Top Navbar */}
      <header className="sticky top-0 z-40 flex h-18 items-center justify-between border-b border-[#202945] bg-[#0C1021]/95 px-4 sm:px-8 backdrop-blur-xl shrink-0 min-w-0">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button onClick={onBack} className={btnGhost} title="Return to App">
            <ArrowLeft size={17} /> <span className="hidden xs:inline">Exit Console</span><span className="xs:hidden">Exit</span>
          </button>
          <div className="hidden sm:block h-6 w-px bg-[#263052] shrink-0" />
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#3FA7E0] to-[#55B5EA] flex items-center justify-center text-[#08101F] font-black text-sm shadow-md shadow-[#3FA7E0]/30 shrink-0">
              B
            </div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight text-white flex items-center gap-2 truncate min-w-0">
              <span className="text-[#3FA7E0] truncate">Bwenge AI</span>
              <span className="text-[#9AA6C9] font-normal hidden md:inline">| Enterprise Control Plane</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="flex items-center bg-[#141C33] rounded-xl border border-[#2A3760] p-1 text-xs shrink-0 shadow-inner">
            {(['draft', 'testing', 'production'] as Env[]).map((e) => (
              <button
                key={e}
                onClick={() => { setEnv(e); notify(`Switched environment to ${e.toUpperCase()}`); }}
                className={`px-3 sm:px-4 py-1.5 rounded-lg font-bold capitalize transition-all cursor-pointer ${env === e ? 'bg-gradient-to-r from-[#3FA7E0] to-[#55B5EA] text-[#08101F] shadow-md shadow-[#3FA7E0]/20' : 'text-[#9AA6C9] hover:text-white'}`}
              >
                {e}
              </button>
            ))}
          </div>

          <button onClick={() => setDrawer(true)} className={`lg:hidden ${btnGhost} p-2.5`} aria-label="Open Navigation">
            <Menu size={20} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden min-w-0">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0B1020] border-r border-[#202945] flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl lg:shadow-none ${drawer ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 flex items-center justify-between border-b border-[#202945] lg:hidden shrink-0 bg-[#0F1428]">
            <span className="font-bold text-white flex items-center gap-2"><Sparkles size={16} className="text-[#3FA7E0]" /> Navigation Menu</span>
            <button onClick={() => setDrawer(false)} className="text-[#9AA6C9] hover:text-white p-2" aria-label="Close Navigation"><X size={20} /></button>
          </div>

          <nav className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0 scrollbar-hidden">
            {NAV_CATEGORIES.map((cat, catIdx) => {
              const isCollapsed = collapsedCategories[cat.title] || false;
              const hasActiveChild = cat.items.some((i) => i.id === tab);

              return (
                <div key={catIdx} className="space-y-1.5">
                  <button
                    onClick={() => toggleCategory(cat.title)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition cursor-pointer ${hasActiveChild ? 'text-[#7CC4EE]' : 'text-[#8292C2] hover:text-white'}`}
                  >
                    <span className="flex items-center gap-2">
                      {cat.icon}
                      {cat.title}
                    </span>
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-1 pl-2 border-l border-[#202945] ml-2">
                      {cat.items.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => go(n.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${tab === n.id ? 'bg-gradient-to-r from-[#3FA7E0]/20 to-[#3FA7E0]/5 text-[#7CC4EE] border border-[#3FA7E0]/40 shadow-sm shadow-[#3FA7E0]/10' : 'text-[#9AA6C9] hover:bg-[#141C33] hover:text-white'}`}
                        >
                          <span className={`shrink-0 ${tab === n.id ? 'text-[#3FA7E0]' : 'text-[#6C789E]'}`}>{n.icon}</span>
                          <span className="truncate">{n.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] bg-[#070B14]">
          <div className="flex flex-wrap items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-3xl font-black text-white capitalize tracking-tight">{tab.replace(/([A-Z])/g, ' $1')}</h2>
              <p className="text-sm text-[#9AA6C9] mt-1">AI database, vector index, and dataset-grounded prompt adapter console.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {tab !== 'finetune' && (
                <button onClick={() => setTab('finetune')} className={btnPrimary}>
                  <GraduationCap size={16} /> Prompt Adapters
                </button>
              )}
              <button onClick={() => void loadData()} className={btnGhost}>
                <RefreshCw size={16} /> Sync Live Data
              </button>
            </div>
          </div>

          {loading ? (
            <SkeletonLoader />
          ) : error ? (
            <ErrorBanner message={error} onRetry={() => void loadData()} />
          ) : (
            <>
              {/* ── OVERVIEW TAB ── */}
              {tab === 'overview' && overview && (
                <div className="space-y-8 min-w-0">
                  {/* Command Center Banner */}
                  <div className={`${card} p-6 sm:p-8 bg-gradient-to-r from-[#1E2749] via-[#161C30] to-[#121829] border-[#3FA7E0]/40 relative overflow-hidden`}>
                    <div className="absolute top-0 right-0 w-80 h-80 bg-[#3FA7E0]/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-6 relative z-10">
                      <div>
                        <h3 className="text-lg sm:text-xl font-black text-white flex items-center gap-2.5">
                          <Sparkles size={20} className="text-[#3FA7E0]" /> Enterprise Command Center
                        </h3>
                        <p className="text-xs sm:text-sm text-[#9AA6C9] mt-1">Manage prompt adapters, dataset curation, and model evaluation. Adapters do not train model weights.</p>
                      </div>
                      <Badge tone="blue">Environment: {env.toUpperCase()}</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 relative z-10">
                      <button onClick={() => setTab('finetune')} className={btnGhost + ' justify-start h-auto py-3.5 px-4 bg-[#0F1424]/90 hover:bg-[#1C2648]'}>
                        <GraduationCap size={18} className="text-[#3FA7E0]" />
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-white truncate">Dataset-grounded Prompt Adapter</p>
                          <p className="text-[10px] text-[#9AA6C9] truncate">Dataset-grounded</p>
                        </div>
                      </button>
                      <button onClick={() => setTab('datasets')} className={btnGhost + ' justify-start h-auto py-3.5 px-4 bg-[#0F1424]/90 hover:bg-[#1C2648]'}>
                        <Database size={18} className="text-[#3DB27A]" />
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-white truncate">Datasets</p>
                          <p className="text-[10px] text-[#9AA6C9] truncate">Curate &amp; Export JSONL</p>
                        </div>
                      </button>
                      <button onClick={() => setTab('playground')} className={btnGhost + ' justify-start h-auto py-3.5 px-4 bg-[#0F1424]/90 hover:bg-[#1C2648]'}>
                        <FlaskConical size={18} className="text-[#F2C230]" />
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-white truncate">AI Playground</p>
                          <p className="text-[10px] text-[#9AA6C9] truncate">Test RAG &amp; Adapter</p>
                        </div>
                      </button>
                      <button onClick={() => setTab('review')} className={btnGhost + ' justify-start h-auto py-3.5 px-4 bg-[#0F1424]/90 hover:bg-[#1C2648]'}>
                        <CheckCircle2 size={18} className="text-[#FF8798]" />
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-white truncate">Review Queue</p>
                          <p className="text-[10px] text-[#9AA6C9] truncate">Validate Corrections</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Key Metrics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Knowledge Bases" value={overview.counts.knowledgeBases} detail={`${overview.counts.documents} indexed documents`} />
                    <Stat label="Dataset Examples" value={overview.counts.datasetExamples} detail="Approved source examples" />
                    <Stat label="Dataset-grounded Prompt Adapters" value={overview.counts.datasetAdapters} detail={`${overview.counts.activeModels} active models`} />
                    <Stat label="Forms & Submissions" value={`${overview.counts.formsCount ?? 0} / ${overview.counts.submissionsCount ?? 0}`} detail="Forms / Candidate responses" />
                    <Stat label="Questions Answered" value={overview.counts.questionsAnswered} detail="Logged in UsageEvents" />
                    <Stat label="Tokens Processed" value={overview.counts.tokensUsed.toLocaleString()} detail="Real Input + Output tokens" />
                    <Stat label="Active Models" value={overview.counts.activeModels} detail="Serving live traffic" />
                    <Stat label="Indexed Storage" value={`${overview.counts.storageUsedMb ?? 0} MB`} detail="Database & document store" />
                  </div>

                  {/* Visual Analytics Overview Banner */}
                  <div className={`${card} p-6 space-y-4`}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <BarChart3 size={18} className="text-[#3FA7E0]" /> Usage reporting
                      </h3>
                      <span className="text-xs text-[#9AA6C9]">Query and token totals are shown in the metrics above.</span>
                    </div>
                  </div>

                  <Section title="Service Checks" hint="Database checks are measured. Provider credentials are checked without a live AI request; adapter and ingestion services are not probed.">
                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                      {health.map((s, idx) => (
                        <div key={idx} className={`${card} p-5 flex items-center justify-between min-w-0`}>
                          <div className="min-w-0 mr-3">
                            <p className="text-xs font-bold text-[#9AA6C9] truncate">{s.name}</p>
                            <p className="mt-1.5 text-sm font-extrabold text-white truncate">{s.latency || s.detail || '—'}</p>
                          </div>
                          <Badge tone={['ONLINE', 'CONFIGURED'].includes(s.status) ? 'green' : s.status === 'NOT_CONFIGURED' ? 'yellow' : 'blue'}>{s.status.replaceAll('_', ' ')}</Badge>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Section title="Recent Prompt Adapter & Model Activity" actions={
                      <button onClick={() => setTab('finetune')} className={btnGhost}>Manage Prompt Adapters</button>
                    }>
                      <div className={`${card} p-5 space-y-3`}>
                        {datasetAdapterJobs.length === 0 ? (
                          <EmptyState title="No Dataset-grounded Prompt Adapters" desc="Build an inference-time prompt adapter from approved dataset examples. Model weights are not trained." icon={<GraduationCap size={24} />} />
                        ) : (
                          datasetAdapterJobs.slice(0, 4).map((j) => (
                            <div key={j.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[#0F1424] border border-[#263052] hover:border-[#3FA7E0]/40 transition">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-white truncate">{j.adapterName || j.id}</p>
                                <p className="text-[11px] text-[#9AA6C9] truncate mt-0.5">Dataset: {j.datasetName || j.datasetId} · {j.exampleCount} examples</p>
                              </div>
                              <Badge tone={j.status === 'ADAPTER_READY' ? 'green' : j.status === 'BUILDING_ADAPTER' ? 'blue' : 'yellow'}>
                                {j.status === 'ADAPTER_READY' ? 'ADAPTER READY' : j.status === 'BUILDING_ADAPTER' ? 'BUILDING ADAPTER' : j.status}
                              </Badge>
                            </div>
                          ))
                        )}
                      </div>
                    </Section>

                    <Section title="Recent Live AI Queries (UsageEvents)">
                      <div className={`${card} p-5 space-y-3`}>
                        {(overview.recent?.questions || []).length === 0 ? (
                          <EmptyState title="No Queries Logged" desc="Test AI prompts in the playground or use the app to generate usage telemetry." icon={<FlaskConical size={24} />} />
                        ) : (
                          (overview.recent?.questions || []).slice(0, 4).map((q: any) => (
                            <div key={q.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[#0F1424] border border-[#263052] hover:border-[#3FA7E0]/40 transition">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-white truncate">{q.question}</p>
                                <p className="text-[11px] text-[#9AA6C9] truncate mt-0.5">Model: {q.model} · {q.tokensIn + q.tokensOut} tokens</p>
                              </div>
                              <Badge tone="blue">{q.latencyMs}ms</Badge>
                            </div>
                          ))
                        )}
                      </div>
                    </Section>
                  </div>
                </div>
              )}

              {/* ── DATASET ADAPTERS TAB ── */}
              {tab === 'finetune' && (
                <div className="space-y-6 min-w-0">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Build a dataset-grounded prompt adapter */}
                    <div className={`${card} p-6 sm:p-8 space-y-5 lg:col-span-5`}>
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <GraduationCap size={20} className="text-[#3FA7E0]" /> Build Dataset-grounded Prompt Adapter
                        </h3>
                        <p className="text-xs text-[#9AA6C9] mt-1">
                          Creates an inference-time adapter from approved dataset examples. It does not train or modify model weights.
                        </p>
                      </div>

                      <Field label="Dataset (Live Database)">
                        <select
                          className={input}
                          value={ftDatasetId}
                          onChange={(e) => setFtDatasetId(e.target.value)}
                        >
                          {datasets.map((ds) => (
                            <option key={ds.id} value={ds.id}>
                              {ds.name} ({ds.exampleCount ?? ds._count?.examples ?? 0} examples · {ds.approvedCount ?? 0} approved)
                            </option>
                          ))}
                        </select>
                      </Field>

                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!ftDatasetId) return;
                            try {
                              const res = await adminApi.generateDatasetExamples(ftDatasetId, 'all');
                              notify(res.message || 'Harvested live examples from database');
                              await loadData(true);
                            } catch (e: any) {
                              notify(e.message, true);
                            }
                          }}
                          className={btnGhost + ' text-xs py-2 px-3'}
                        >
                          <Database size={14} /> Sync Examples from DB
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const ds = datasets.find((d) => d.id === ftDatasetId);
                            if (ds) {
                              setTab('datasets');
                              void openDatasetInspector(ds);
                            }
                          }}
                          className={btnGhost + ' text-xs py-2 px-3'}
                        >
                          <FileText size={14} /> Inspect Dataset Examples
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Base Model">
                          <select className={input} value={ftBaseModel} onChange={(e) => setFtBaseModel(e.target.value)}>
                            <option value="zai-org/GLM-5.3-Flash">zai-org/GLM-5.3-Flash</option>
                            <option value="gonkarouter/GLM-5-Reasoning">gonkarouter/GLM-5-Reasoning</option>
                            <option value="gonkarouter/Nano-Banana-Vision">gonkarouter/Nano-Banana-Vision</option>
                          </select>
                        </Field>
                        <Field label="Adapter Name Suffix">
                          <input
                            className={input}
                            value={ftSuffix}
                            onChange={(e) => setFtSuffix(e.target.value)}
                            placeholder="e.g. stem-grader-v2"
                          />
                        </Field>
                      </div>

                      <label className="flex items-center gap-2.5 text-xs font-semibold text-[#B7C1DE] cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={ftAutoApprove}
                          onChange={(e) => setFtAutoApprove(e.target.checked)}
                          className="rounded border-[#2E3A63] w-4 h-4 text-[#3FA7E0]"
                        />
                        Auto-approve pending examples &amp; activate adapter in <strong>{env}</strong> when ready
                      </label>

                      <button
                        type="button"
                        disabled={ftStarting || !ftDatasetId}
                        onClick={async () => {
                          if (!ftDatasetId) {
                            notify('Create or select a dataset first.', true);
                            return;
                          }
                          setFtStarting(true);
                          try {
                            const res: any = await adminApi.createDatasetAdapter({
                              datasetId: ftDatasetId,
                              baseModel: ftBaseModel,
                              suffix: ftSuffix,
                              targetEnvironment: env,
                              autoApprove: ftAutoApprove,
                            });
                            setSelectedFtJob(res.data);
                            notify('Dataset-grounded prompt adapter build started.');
                            await loadData(true);
                          } catch (e: any) {
                            notify(e.message, true);
                          } finally {
                            setFtStarting(false);
                          }
                        }}
                        className={btnPrimary + ' w-full py-3.5'}
                      >
                        <Sparkles size={18} /> {ftStarting ? 'Building Prompt Adapter...' : 'Build & Activate Prompt Adapter'}
                      </button>
                    </div>

                    {/* Right: Adapter Build Monitor & Testing Sandbox */}
                    <div className={`${card} p-6 sm:p-8 space-y-6 lg:col-span-7`}>
                      {selectedFtJob ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263052] pb-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2.5">
                                <h3 className="text-base font-bold text-white truncate">
                                  {selectedFtJob.adapterName || selectedFtJob.id}
                                </h3>
                                <Badge
                                  tone={
                                    selectedFtJob.status === 'ADAPTER_READY'
                                      ? 'green'
                                      : selectedFtJob.status === 'BUILDING_ADAPTER'
                                      ? 'blue'
                                      : selectedFtJob.status === 'FAILED' || selectedFtJob.status === 'CANCELLED'
                                      ? 'red'
                                      : 'yellow'
                                  }
                                >
                                  {selectedFtJob.status === 'ADAPTER_READY' ? 'ADAPTER READY' : selectedFtJob.status === 'BUILDING_ADAPTER' ? 'BUILDING ADAPTER' : selectedFtJob.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-[#9AA6C9] mt-1">
                                Dataset: <span className="text-white font-semibold">{selectedFtJob.datasetName || selectedFtJob.datasetId}</span> ·{' '}
                                Examples: <span className="text-white font-semibold">{selectedFtJob.exampleCount ?? 'All'}</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedFtJob.status === 'BUILDING_ADAPTER' && (
                                <button
                                  onClick={async () => {
                                    await adminApi.cancelDatasetAdapter(selectedFtJob.id);
                                    notify('Adapter build cancelled.');
                                    await loadData(true);
                                  }}
                                  className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-950/20 rounded-xl px-3.5 py-2 font-semibold"
                                >
                                  Cancel Job
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs font-semibold text-[#9AA6C9]">
                              <span>Knowledge adapter build status</span>
                              <span className="text-white font-bold">
                                {selectedFtJob.status === 'ADAPTER_READY' ? 100 : selectedFtJob.progress ?? 0}%
                              </span>
                            </div>
                            <div className="w-full h-3 bg-[#0F1424] rounded-full overflow-hidden border border-[#263052] p-0.5">
                              <div
                                className="h-full bg-gradient-to-r from-[#3FA7E0] via-[#3DB27A] to-[#6FD6A2] rounded-full transition-all duration-500 shadow-sm"
                                style={{ width: `${selectedFtJob.status === 'ADAPTER_READY' ? 100 : selectedFtJob.progress ?? 15}%` }}
                              />
                            </div>
                          </div>

                          {selectedFtJob.errorMessage && (
                            <p className="text-sm text-red-300 bg-red-950/40 border border-red-500/40 rounded-xl p-4 font-medium">
                              Adapter build failed: {selectedFtJob.errorMessage}
                            </p>
                          )}

                          {selectedFtJob.adapterPrompt && (
                            <div className="p-4 rounded-xl bg-[#0F1424] border border-[#2E3A63] space-y-1.5 shadow-inner">
                              <p className="text-xs font-bold text-[#7CC4EE] flex items-center gap-2">
                                <Cpu size={15} /> Dataset-Grounded Knowledge Adapter (Active in AI Context)
                              </p>
                              <p className="text-xs text-[#E8EAF2] whitespace-pre-wrap leading-relaxed font-mono">
                                {selectedFtJob.adapterPrompt}
                              </p>
                            </div>
                          )}

                          {Array.isArray(selectedFtJob.logs) && selectedFtJob.logs.length > 0 && (
                            <div className="p-4 rounded-xl bg-[#080C17] border border-[#263052] font-mono text-xs text-[#9AA6C9] space-y-1.5 max-h-36 overflow-y-auto shadow-inner">
                              {selectedFtJob.logs.map((line: string, idx: number) => (
                                <div key={idx} className="leading-relaxed">{line}</div>
                              ))}
                            </div>
                          )}

                          {/* Model Verification Sandbox */}
                          <div className="pt-4 border-t border-[#263052] space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-[#9AA6C9]">
                              Test Dataset-grounded Prompt Adapter
                            </h4>
                            <div className="flex flex-col sm:flex-row gap-2.5">
                              <input
                                className={input}
                                value={ftTestPrompt}
                                onChange={(e) => setFtTestPrompt(e.target.value)}
                                placeholder="Enter a prompt to test this dataset-grounded AI adapter..."
                              />
                              <button
                                type="button"
                                disabled={ftTesting || selectedFtJob.status !== 'ADAPTER_READY'}
                                onClick={async () => {
                                  if (!ftTestPrompt.trim()) return;
                                  setFtTesting(true);
                                  try {
                                    const res = await adminApi.testDatasetAdapter(selectedFtJob.id, ftTestPrompt);
                                    setFtTestOutput(res.data);
                                    notify('Prompt adapter test completed.');
                                  } catch (e: any) {
                                    notify(e.message, true);
                                  } finally {
                                    setFtTesting(false);
                                  }
                                }}
                                className={btnPrimary}
                              >
                                <Play size={15} /> {ftTesting ? 'Running...' : 'Test Model'}
                              </button>
                            </div>
                            {ftTestOutput && (
                              <div className="p-4 rounded-xl bg-[#0F1424] border border-[#3FA7E0]/50 space-y-2 text-xs shadow-lg">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[#7CC4EE] font-bold">
                                  <span>Adapter: {ftTestOutput.adapterName} · Provider model: {ftTestOutput.baseModel}</span>
                                  <span>{ftTestOutput.examplesUsed} dataset examples applied · {ftTestOutput.latencyMs}ms</span>
                                </div>
                                <p className="text-[#E8EAF2] whitespace-pre-wrap leading-relaxed">{ftTestOutput.output}</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <EmptyState
                          title="No Prompt Adapter Selected"
                          desc="Select a dataset on the left and build an adapter to apply its approved knowledge to live AI responses."
                          icon={<GraduationCap size={28} />}
                        />
                      )}
                    </div>
                  </div>

                  {/* Dataset-grounded Prompt Adapter Jobs Table */}
                  <Section title="Dataset-grounded Prompt Adapter History" hint="Inspect inference-time adapters built from approved dataset examples. Model weights are not trained.">
                    <div className={`${card} overflow-x-auto`}>
                      <table className="w-full text-left text-sm min-w-[720px]">
                        <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                          <tr>
                            <th className="p-4">Prompt Adapter</th>
                            <th className="p-4">Dataset</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Examples</th>
                            <th className="p-4">Est. Tokens</th>
                            <th className="p-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#263052]">
                          {datasetAdapterJobs.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-sm text-[#9AA6C9]">No dataset-grounded prompt adapters have been built yet.</td>
                            </tr>
                          ) : (
                            datasetAdapterJobs.map((j) => (
                              <tr
                                key={j.id}
                                onClick={() => setSelectedFtJob(j)}
                                className={`cursor-pointer transition-colors ${
                                  selectedFtJob?.id === j.id ? 'bg-[#3FA7E0]/15' : 'hover:bg-[#18213D]/60'
                                }`}
                              >
                                <td className="p-4 font-mono text-xs font-bold text-white truncate max-w-[220px]">
                                  {j.adapterName || j.id}
                                </td>
                                <td className="p-4 text-xs text-[#9AA6C9] truncate max-w-[180px]">
                                  {j.datasetName || j.datasetId}
                                </td>
                                <td className="p-4">
                                  <Badge tone={j.status === 'ADAPTER_READY' ? 'green' : j.status === 'BUILDING_ADAPTER' ? 'blue' : 'yellow'}>
                                    {j.status === 'ADAPTER_READY' ? 'ADAPTER READY' : j.status === 'BUILDING_ADAPTER' ? `BUILDING ADAPTER (${j.progress || 0}%)` : j.status}
                                  </Badge>
                                </td>
                                <td className="p-4 text-xs text-[#9AA6C9]">{j.exampleCount || 0}</td>
                                <td className="p-4 text-xs text-[#9AA6C9]">{j.tokenEstimate}</td>
                                <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                  {j.status === 'BUILDING_ADAPTER' ? (
                                    <button
                                      onClick={async () => {
                                        await adminApi.cancelDatasetAdapter(j.id);
                                        notify('Adapter build cancelled.');
                                        await loadData(true);
                                      }}
                                      className="text-red-400 hover:text-red-300 text-xs font-bold p-1.5"
                                    >
                                      Cancel
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setSelectedFtJob(j)}
                                      className="text-[#7CC4EE] hover:underline text-xs font-bold p-1.5"
                                    >
                                      Inspect &amp; Test
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                </div>
              )}

              {/* ── DATASETS TAB ── */}
              {tab === 'datasets' && (
                inspectDataset ? (
                  <Section
                    title={`Dataset Examples: ${inspectDataset.name}`}
                    hint="Review extracted dataset examples, record consent and PII review, and build an inference-time prompt adapter."
                    actions={
                      <div className="flex flex-wrap gap-2.5">
                        <button
                          onClick={async () => {
                            try {
                              await adminApi.approveAllDatasetExamples(inspectDataset.id);
                              const res = await adminApi.getDatasetExamples(inspectDataset.id);
                              setDatasetExamples(res.data);
                              await loadData(true);
                              notify('All dataset examples approved');
                            } catch (err: any) {
                              notify(err.message, true);
                            }
                          }}
                          className={btnPrimary}
                        >
                          <CheckCircle2 size={16} /> Approve All ({datasetExamples.length})
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const res: any = await adminApi.exportDataset(inspectDataset.id);
                              const blob = new Blob([JSON.stringify(res.manifest, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `dataset_${inspectDataset.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_manifest.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                              notify('Dataset quality manifest exported.');
                            } catch (err: any) {
                              notify(err.message, true);
                            }
                          }}
                          className={btnGhost}
                        >
                          <FileText size={16} /> Export Manifest
                        </button>
                        <button
                          onClick={() => void buildDatasetKnowledgeAdapter(inspectDataset)}
                          disabled={datasetAdapterStarting === inspectDataset.id}
                          className={btnPrimary}
                        >
                          <Sparkles size={16} />
                          {datasetAdapterStarting === inspectDataset.id ? 'Building...' : 'Approve & Build Knowledge'}
                        </button>
                        <button onClick={() => setInspectDataset(null)} className={btnGhost}>
                          Back to Datasets
                        </button>
                      </div>
                    }
                  >
                    <div className={`${card} p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
                      <div>
                        <h4 className="text-sm font-bold text-white">Attach source file to this dataset</h4>
                        <p className="text-xs text-[#9AA6C9] mt-1">
                          Extracted content becomes pending dataset examples. Record consent and complete a PII review before approval or export.
                        </p>
                      </div>
                      <label className={`${btnPrimary} cursor-pointer shrink-0 ${datasetFileUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                        <Upload size={16} /> {datasetFileUploading ? 'Extracting & Generating...' : 'Attach & Extract File'}
                        <input
                          type="file"
                          accept={DATASET_FILE_ACCEPT}
                          className="hidden"
                          disabled={datasetFileUploading}
                          onChange={async (event) => {
                            const fileInput = event.currentTarget;
                            const file = fileInput.files?.[0];
                            if (!file) return;
                            await uploadFileToDataset(inspectDataset, file);
                            fileInput.value = '';
                          }}
                        />
                      </label>
                    </div>

                    {/* Add Manual Dataset Example */}
                    <div className={`${card} p-5 space-y-4`}>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#7CC4EE]">
                        + Add Dataset Example to {inspectDataset.name}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label="Instruction / Prompt">
                          <textarea
                            rows={2}
                            className={input}
                            value={newExInstruction}
                            onChange={(e) => setNewExInstruction(e.target.value)}
                            placeholder="e.g. Grade student answer against rubric..."
                          />
                        </Field>
                        <Field label="Target Output / Completion">
                          <textarea
                            rows={2}
                            className={input}
                            value={newExOutput}
                            onChange={(e) => setNewExOutput(e.target.value)}
                            placeholder="e.g. Score: 9/10. Explanation..."
                          />
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <input
                          className={`${input} max-w-lg`}
                          value={newExInput}
                          onChange={(e) => setNewExInput(e.target.value)}
                          placeholder="Optional context/input"
                        />
                        <label className="flex items-center gap-2 text-xs text-[#B7C1DE]">
                          <input type="checkbox" checked={newExampleConsent} onChange={(e) => setNewExampleConsent(e.target.checked)} />
                          Data-owner consent is recorded
                        </label>
                        <label className="flex items-center gap-2 text-xs text-[#B7C1DE]">
                          <input type="checkbox" checked={newExamplePiiReviewed} onChange={(e) => setNewExamplePiiReviewed(e.target.checked)} />
                          Human PII review is complete
                        </label>
                        <button
                          onClick={async () => {
                            if (!newExInstruction.trim() || !newExOutput.trim()) {
                              notify('Enter both Instruction and Target Output.', true);
                              return;
                            }
                            try {
                              await adminApi.createDatasetExample(inspectDataset.id, {
                                instruction: newExInstruction,
                                input: newExInput,
                                output: newExOutput,
                                status: newExampleConsent && newExamplePiiReviewed ? 'approved' : 'pending',
                                consentGiven: newExampleConsent,
                                piiReviewed: newExamplePiiReviewed,
                              });
                              setNewExInstruction('');
                              setNewExInput('');
                              setNewExOutput('');
                              setNewExampleConsent(false);
                              setNewExamplePiiReviewed(false);
                              const res = await adminApi.getDatasetExamples(inspectDataset.id);
                              setDatasetExamples(res.data);
                              await loadData(true);
                              notify(newExampleConsent && newExamplePiiReviewed ? 'Dataset example added and approved.' : 'Dataset example added as pending until consent and PII review are recorded.');
                            } catch (e: any) {
                              notify(e.message, true);
                            }
                          }}
                          className={btnPrimary}
                        >
                          <Plus size={16} /> Add Dataset Example
                        </button>
                      </div>
                    </div>

                    {datasetExamplesLoading ? (
                      <div className="py-12 text-center text-sm text-[#9AA6C9]">Loading dataset examples...</div>
                    ) : datasetExamples.length === 0 ? (
                      <EmptyState
                        title="No Dataset Examples Found"
                        desc="Attach a source file or harvest live database records to create pending source examples."
                        icon={<Database size={28} />}
                      />
                    ) : (
                      <div className="space-y-4">
                        {datasetExamples.map((ex) => (
                          <div key={ex.id} className={`${card} p-5 space-y-3 min-w-0`}>
                            <div className="flex flex-wrap justify-between items-center gap-2">
                              <div className="flex items-center gap-2.5">
                                <Badge tone={ex.status === 'approved' ? 'green' : ex.status === 'rejected' ? 'red' : 'yellow'}>
                                  {ex.status}
                                </Badge>
                                {ex.validationFlags && (
                                  <span className="text-[11px] font-mono text-[#6C789E]">{ex.validationFlags}</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 text-[11px] text-[#B7C1DE]">
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={ex.consentGiven === true}
                                    aria-label={`Record data-owner consent for example ${ex.id}`}
                                    onChange={async (event) => {
                                      const consentGiven = event.target.checked;
                                      try {
                                        await adminApi.updateDatasetExample(ex.id, {
                                          consentGiven,
                                          ...(consentGiven || ex.status !== 'approved' ? {} : { status: 'pending' }),
                                        });
                                        const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                        setDatasetExamples(res.data);
                                      } catch (error: any) {
                                        notify(error.message, true);
                                      }
                                    }}
                                  />
                                  Consent recorded
                                </label>
                                <label className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={ex.piiReviewed === true}
                                    aria-label={`Mark PII review complete for example ${ex.id}`}
                                    onChange={async (event) => {
                                      const piiReviewed = event.target.checked;
                                      try {
                                        await adminApi.updateDatasetExample(ex.id, {
                                          piiReviewed,
                                          ...(piiReviewed || ex.status !== 'approved' ? {} : { status: 'pending' }),
                                        });
                                        const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                        setDatasetExamples(res.data);
                                      } catch (error: any) {
                                        notify(error.message, true);
                                      }
                                    }}
                                  />
                                  PII review complete
                                </label>
                              </div>
                              <div className="flex gap-2">
                                {ex.status !== 'approved' && (
                                  <button
                                    onClick={async () => {
                                      await adminApi.updateDatasetExample(ex.id, { status: 'approved' });
                                      const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                      setDatasetExamples(res.data);
                                      await loadData(true);
                                      notify('Example approved');
                                    }}
                                    className="px-3.5 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold hover:bg-emerald-600/30"
                                  >
                                    Approve
                                  </button>
                                )}
                                {ex.status !== 'rejected' && (
                                  <button
                                    onClick={async () => {
                                      await adminApi.updateDatasetExample(ex.id, { status: 'rejected' });
                                      const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                      setDatasetExamples(res.data);
                                      await loadData(true);
                                      notify('Example rejected');
                                    }}
                                    className="px-3.5 py-1.5 bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold hover:bg-rose-600/30"
                                  >
                                    Reject
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    await adminApi.deleteDatasetExample(ex.id);
                                    const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                    setDatasetExamples(res.data);
                                    await loadData(true);
                                    notify('Example deleted');
                                  }}
                                  className="px-2.5 py-1.5 text-red-400 hover:text-red-300 text-xs"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-bold text-[#9AA6C9]">Instruction / Prompt:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3.5 rounded-xl border border-[#2E3A63] mt-1 whitespace-pre-wrap font-medium">
                                {ex.instruction || ex.prompt}
                              </p>
                            </div>
                            {ex.input && (
                              <div>
                                <p className="text-xs font-bold text-[#9AA6C9]">Context / Input:</p>
                                <p className="text-xs text-[#B7C1DE] bg-[#0F1424] p-3 rounded-xl border border-[#2E3A63] mt-1 whitespace-pre-wrap">
                                  {ex.input}
                                </p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-bold text-[#9AA6C9]">Target Output / Completion:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3.5 rounded-xl border border-[#2E3A63] mt-1 whitespace-pre-wrap font-medium">
                                {ex.output || ex.completion}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                ) : (
                  <Section
                    title="Datasets & Real Database Curations"
                    hint="Harvest source examples from database tables or create custom prompt-adapter datasets."
                  >
                    {/* Inline New Dataset Creator */}
                    <div className={`${card} p-5 flex flex-col sm:flex-row gap-4 items-end`}>
                      <div className="flex-1 w-full">
                        <Field label="New Dataset Name">
                          <input
                            className={input}
                            value={newDatasetName}
                            onChange={(e) => setNewDatasetName(e.target.value)}
                            placeholder="e.g. Rwanda STEM Exam Corpus"
                          />
                        </Field>
                      </div>
                      <div className="flex-1 w-full">
                        <Field label="Description">
                          <input
                            className={input}
                            value={newDatasetDesc}
                            onChange={(e) => setNewDatasetDesc(e.target.value)}
                            placeholder="Synced with live database submissions"
                          />
                        </Field>
                      </div>
                      <button
                        onClick={async () => {
                          if (!newDatasetName.trim()) {
                            notify('Enter a dataset name first.', true);
                            return;
                          }
                          await adminApi.createDataset({
                            name: newDatasetName.trim(),
                            description: newDatasetDesc.trim() || undefined,
                            autoHarvest: false,
                          });
                          setNewDatasetName('');
                          setNewDatasetDesc('');
                          notify('Dataset created successfully.');
                          await loadData(true);
                        }}
                        className={btnPrimary}
                      >
                        <Plus size={16} /> Create Dataset
                      </button>
                    </div>

                    {datasets.length === 0 ? (
                      <EmptyState
                        title="No Datasets Created Yet"
                        desc="Create a dataset above to collect source examples and build inference-time prompt adapters."
                        icon={<Database size={28} />}
                      />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {datasets.map((ds) => (
                          <div key={ds.id} className={`${card} p-6 space-y-5 min-w-0`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="font-bold text-white text-base truncate">{ds.name}</h3>
                                <p className="text-xs text-[#9AA6C9] break-words mt-1">
                                  {ds.description || 'Curated dataset for source-grounded examples.'}
                                </p>
                              </div>
                              <Badge tone="blue">{ds.exampleCount ?? ds._count?.examples ?? 0} pairs</Badge>
                            </div>

                            <div className="flex flex-wrap gap-4 text-xs text-[#9AA6C9] bg-[#0F1424] p-3.5 rounded-xl border border-[#263052]">
                              <span>Approved: <strong className="text-[#6FD6A2]">{ds.approvedCount ?? 0}</strong></span>
                              <span>Pending: <strong className="text-[#F2C230]">{ds.pendingCount ?? 0}</strong></span>
                              <span>Est. Tokens: <strong className="text-white">{ds.estimatedTokens ?? 0}</strong></span>
                            </div>

                            <div className="flex flex-wrap gap-2.5">
                              <label className={`${btnGhost} cursor-pointer text-xs py-2 px-3.5 ${datasetFileUploading ? 'opacity-60 pointer-events-none' : ''}`}>
                                <Upload size={14} /> {datasetFileUploading ? 'Extracting...' : 'Attach File'}
                                <input
                                  type="file"
                                  accept={DATASET_FILE_ACCEPT}
                                  className="hidden"
                                  disabled={datasetFileUploading}
                                  onChange={async (event) => {
                                    const fileInput = event.currentTarget;
                                    const file = fileInput.files?.[0];
                                    if (!file) return;
                                    await uploadFileToDataset(ds, file, true);
                                    fileInput.value = '';
                                  }}
                                />
                              </label>
                              <button
                                onClick={async () => {
                                  const res = await adminApi.generateDatasetExamples(ds.id, 'all');
                                  notify(res.message || 'Harvested examples from all DB tables');
                                  await loadData(true);
                                }}
                                className={btnGhost + ' text-xs py-2 px-3.5'}
                              >
                                <Database size={14} /> Harvest DB
                              </button>
                              <button
                                onClick={() => void openDatasetInspector(ds)}
                                className={btnGhost + ' text-xs py-2 px-3.5'}
                              >
                                Inspect ({ds.exampleCount ?? ds._count?.examples ?? 0})
                              </button>
                              <button
                                onClick={() => void buildDatasetKnowledgeAdapter(ds)}
                                disabled={datasetAdapterStarting === ds.id}
                                className={btnPrimary + ' text-xs py-2 px-3.5'}
                              >
                                <Sparkles size={14} />
                                {datasetAdapterStarting === ds.id ? 'Building...' : 'Build Knowledge'}
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    const r: any = await adminApi.exportDataset(ds.id);
                                    const blob = new Blob([r.jsonl], { type: 'application/x-ndjson' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${ds.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_dataset.jsonl`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    notify('Dataset JSONL exported successfully.');
                                  } catch (err: any) {
                                    notify(err.message, true);
                                  }
                                }}
                                className={btnGhost + ' text-xs py-2 px-3.5'}
                              >
                                📥 JSONL
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                )
              )}

              {/* ── MODELS REGISTRY TAB ── */}
              {tab === 'models' && (
                <Section title="Model Registry & Active Deployments" hint="Manage provider models and dataset-grounded prompt adapters serving live platform requests.">
                  <div className={`${card} p-5 flex flex-col sm:flex-row gap-4 items-end`}>
                    <div className="flex-1 w-full">
                      <Field label="Model Name / Identifier">
                        <input
                          className={input}
                          value={newModelName}
                          onChange={(e) => setNewModelName(e.target.value)}
                          placeholder="e.g. dataset-adapter:glm-5.3-flash:stem-grader"
                        />
                      </Field>
                    </div>
                    <div className="flex-1 w-full">
                      <Field label="Base Model">
                        <input
                          className={input}
                          value={newModelBase}
                          onChange={(e) => setNewModelBase(e.target.value)}
                          placeholder="zai-org/GLM-5.3-Flash"
                        />
                      </Field>
                    </div>
                    <button
                      onClick={async () => {
                        if (!newModelName.trim()) {
                          notify('Enter a model name.', true);
                          return;
                        }
                        await adminApi.createModel({
                          name: newModelName.trim(),
                          provider: 'GonkaRouter',
                          baseModel: newModelBase.trim() || 'zai-org/GLM-5.3-Flash',
                          version: 'v1',
                          environment: env,
                        });
                        setNewModelName('');
                        notify('Model registered and activated');
                        await loadData(true);
                      }}
                      className={btnPrimary}
                    >
                      <Plus size={16} /> Register Model
                    </button>
                  </div>

                  {models.length === 0 ? (
                    <EmptyState title="No Models Registered" desc="Register a provider model or build a dataset-grounded prompt adapter. Model weights are not trained." icon={<Boxes size={28} />} />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {models.map((m) => (
                        <div key={m.id} className={`${card} p-6 space-y-4 min-w-0`}>
                          <div className="flex justify-between items-start gap-2 min-w-0">
                            <h3 className="font-bold text-white truncate text-base" title={m.name}>{m.name}</h3>
                            <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                          </div>
                          <p className="text-xs text-[#9AA6C9] truncate">Provider: {m.provider} · Base: {m.baseModel}</p>
                          {m.dataset && <p className="text-xs text-[#7CC4EE] truncate">Dataset: {m.dataset}</p>}
                          {m.score && <p className="text-xs text-[#6FD6A2] font-semibold">Eval Score: {m.score}</p>}
                          <div className="flex justify-between items-center text-xs text-[#6C789E] pt-3 border-t border-[#263052]">
                            <span className="truncate">Env: {m.environment}</span>
                            <div className="flex gap-2.5">
                              <button
                                onClick={async () => {
                                  await adminApi.activateModel(m.id, env);
                                  notify(`Model ${m.name} activated for ${env}`);
                                  await loadData(true);
                                }}
                                className="text-[#7CC4EE] hover:underline font-bold"
                              >
                                Activate
                              </button>
                              <button
                                onClick={async () => {
                                  await adminApi.deleteModel(m.id);
                                  notify('Model deleted');
                                  await loadData(true);
                                }}
                                className="text-red-400 hover:text-red-300 font-bold"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── KNOWLEDGE BASES TAB ── */}
              {tab === 'knowledge' && (
                <Section title="Knowledge Bases" hint="Manage document repositories and vector stores synced with the database.">
                  <div className={`${card} p-5 flex flex-col sm:flex-row gap-4 items-end`}>
                    <div className="flex-1 w-full">
                      <Field label="Knowledge Base Name">
                        <input
                          className={input}
                          value={newKbName}
                          onChange={(e) => setNewKbName(e.target.value)}
                          placeholder="e.g. National Exam Marking Schemes"
                        />
                      </Field>
                    </div>
                    <div className="flex-1 w-full">
                      <Field label="Description">
                        <input
                          className={input}
                          value={newKbDesc}
                          onChange={(e) => setNewKbDesc(e.target.value)}
                          placeholder="Official rubrics and curriculum standards"
                        />
                      </Field>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-[#B7C1DE]">
                      <input
                        type="checkbox"
                        checked={newKbGlobalApproved}
                        onChange={(e) => setNewKbGlobalApproved(e.target.checked)}
                      />
                      Approve this knowledge base for global sharing
                    </label>
                    <button
                      onClick={async () => {
                        if (!newKbName.trim()) {
                          notify('Enter a Knowledge Base name.', true);
                          return;
                        }
                        try {
                          await adminApi.createKnowledgeBase({
                            name: newKbName.trim(),
                            description: newKbDesc.trim() || 'Created from admin console',
                            globalApproved: newKbGlobalApproved,
                          });
                          setNewKbName('');
                          setNewKbDesc('');
                          setNewKbGlobalApproved(false);
                          notify('Knowledge base created');
                          await loadData(true);
                        } catch (e: any) {
                          notify(e.message, true);
                        }
                      }}
                      className={btnPrimary}
                    >
                      <Plus size={16} /> New Knowledge Base
                    </button>
                  </div>

                  {kbs.length === 0 ? (
                    <EmptyState title="No Knowledge Bases" desc="Create a knowledge base above to start storing documents and indexed chunks." icon={<BookOpen size={28} />} />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {kbs.map((kb) => (
                        <div key={kb.id} className={`${card} p-6 space-y-4 min-w-0`}>
                          <div className="flex justify-between items-start gap-2 min-w-0">
                            <h3 className="font-bold text-white truncate text-base">{kb.name}</h3>
                            <Badge tone={kb.state === 'active' ? 'green' : 'gray'}>{kb.state}</Badge>
                          </div>
                          <p className="text-xs text-[#9AA6C9] break-words">{kb.description || 'No description provided.'}</p>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await adminApi.updateKnowledgeBase(kb.id, {
                                  name: kb.name,
                                  description: kb.description || undefined,
                                  state: kb.state,
                                  globalApproved: !kb.globalApproved,
                                });
                                await loadData(true);
                                notify(kb.globalApproved ? 'Global sharing disabled for this knowledge base.' : 'Knowledge base approved for global sharing. Documents must still be individually approved.');
                              } catch (error: any) {
                                notify(error.message, true);
                              }
                            }}
                            className={btnGhost + ' text-xs py-1.5 px-2.5'}
                          >
                            {kb.globalApproved ? 'Disable global sharing' : 'Approve global sharing'}
                          </button>
                          <div className="flex justify-between text-xs text-[#6C789E] border-t border-[#263052] pt-3 font-semibold">
                            <span>{kb.docs} Documents</span>
                            <span>{kb.chunks} Indexed Chunks</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── DOCUMENTS TAB ── */}
              {tab === 'documents' && (
                <Section
                  title="Document Ingestion &amp; Instant Knowledge Pipeline"
                  hint="Upload PDFs, DOCX, TXT/MD, CSV/XLSX, images (OCR) and audio (ASR)."
                  actions={
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        className={input + ' w-auto text-xs py-2.5'}
                        value={uploadKbId}
                        onChange={(e) => setUploadKbId(e.target.value)}
                      >
                        <option value="">Select Knowledge Base...</option>
                        {kbs.map((kb) => (
                          <option key={kb.id} value={kb.id}>{kb.name}</option>
                        ))}
                      </select>
                      <select
                        className={input + ' w-auto text-xs py-2.5'}
                        value={uploadDomain}
                        onChange={(e) => setUploadDomain(e.target.value)}
                      >
                        <option value="general">Domain: General</option>
                        <option value="health">Health &amp; Medical</option>
                        <option value="legal">Legal &amp; Policy</option>
                        <option value="finance">Finance</option>
                        <option value="farming">Farming &amp; Agriculture</option>
                        <option value="education">Education</option>
                      </select>
                      <label className={btnPrimary + ' cursor-pointer'}>
                        <Upload size={16} /> Upload &amp; Index
                        <input
                          type="file"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const kbId = uploadKbId || kbs[0]?.id;
                            if (!kbId) {
                              notify('Please select a Knowledge Base first.', true);
                              return;
                            }
                            const form = new FormData();
                            form.append('file', file);
                            form.append('knowledgeBaseId', kbId);
                            form.append('domain', uploadDomain);
                            form.append('language', uploadLang);
                            form.append('region', uploadRegion);
                            form.append('consentGiven', String(uploadConsent));
                            try {
                              notify('Uploading and extracting text/OCR/ASR...');
                              const res: any = await adminApi.uploadDocument(form);
                              notify(res.message || 'Document uploaded and indexed successfully.');
                              await loadData(true);
                            } catch (err: any) {
                              notify(err.message, true);
                            }
                          }}
                        />
                      </label>
                    </div>
                  }
                >
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <Field label="Document Language">
                      <select className={input} value={uploadLang} onChange={(e) => setUploadLang(e.target.value)}>
                        <option value="rw">Kinyarwanda (rw)</option>
                        <option value="fr">French (fr)</option>
                        <option value="en">English (en)</option>
                      </select>
                    </Field>
                    <Field label="Region">
                      <input className={input} value={uploadRegion} onChange={(e) => setUploadRegion(e.target.value)} placeholder="Rwanda" />
                    </Field>
                    <Field label="Personal Data Consent Flag">
                      <label className="flex items-center gap-2.5 mt-2 text-xs font-semibold text-[#E8EAF2] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={uploadConsent}
                          onChange={(e) => setUploadConsent(e.target.checked)}
                          className="rounded border-[#2E3A63] bg-[#0F1424] text-[#3FA7E0] w-4 h-4"
                        />
                        Contains personal data with verified consent
                      </label>
                    </Field>
                  </div>

                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[760px]">
                      <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Type</th>
                          <th className="p-4">Size</th>
                          <th className="p-4">Chunks</th>
                          <th className="p-4">Knowledge Base</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {docs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-sm text-[#9AA6C9]">No documents uploaded yet.</td>
                          </tr>
                        ) : (
                          docs.map((d) => (
                            <tr key={d.id} className="hover:bg-[#18213D]/60 transition-colors">
                              <td className="p-4 font-bold text-white max-w-[220px] truncate" title={d.name}>{d.name}</td>
                              <td className="p-4"><Badge tone="blue">{d.type}</Badge></td>
                              <td className="p-4 text-[#9AA6C9]">{d.size}</td>
                              <td className="p-4 text-xs font-bold text-[#7CC4EE]">{d.units}</td>
                              <td className="p-4 text-[#9AA6C9] max-w-[160px] truncate">{d.kb}</td>
                              <td className="p-4">
                                <Badge tone={d.status === 'READY' ? 'green' : 'yellow'}>{d.status}</Badge>
                              </td>
                              <td className="p-4 flex items-center gap-2.5">
                                <button
                                  onClick={async () => {
                                    setInspectingDoc(d);
                                    setInspectLoading(true);
                                    try {
                                      const r: any = await adminApi.getDocumentChunks(d.id);
                                      setInspectChunks(r.data);
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    } finally {
                                      setInspectLoading(false);
                                    }
                                  }}
                                  className={btnGhost + ' py-1.5 px-3 text-xs font-bold'}
                                >
                                  Chunks
                                </button>
                                <button
                                  onClick={async () => {
                                    try {
                                      await adminApi.approveDocument(d.id);
                                      notify('Document approved for RAG retrieval.');
                                      await loadData(true);
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    }
                                  }}
                                  className="text-emerald-400 hover:text-emerald-300 p-1.5 font-bold text-xs"
                                  title="Approve Document"
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                                <button
                                  onClick={async () => {
                                    await adminApi.deleteDocument(d.id);
                                    notify('Document deleted');
                                    await loadData(true);
                                  }}
                                  className="text-red-400 hover:text-red-300 p-1.5"
                                  title="Delete Document"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Chunks Inspection Modal */}
                  {inspectingDoc && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                      <div className={`${card} max-w-3xl w-full p-6 sm:p-8 space-y-5 max-h-[85vh] overflow-y-auto bg-[#141C33]`}>
                        <div className="flex items-center justify-between border-b border-[#263052] pb-4">
                          <h3 className="text-lg font-bold text-white">Document Chunks: {inspectingDoc.name}</h3>
                          <button onClick={() => setInspectingDoc(null)} className="text-[#9AA6C9] hover:text-white p-1"><X size={20} /></button>
                        </div>
                        {inspectLoading ? (
                          <div className="py-12 text-center text-sm text-[#9AA6C9]">Loading chunks...</div>
                        ) : (
                          <div className="space-y-4">
                            {inspectChunks.map((chunk, idx) => (
                              <div key={chunk.id} className="p-4 rounded-xl border border-[#263052] bg-[#0B1020] space-y-3">
                                <div className="flex items-center justify-between text-xs text-[#9AA6C9] font-bold">
                                  <span>Chunk #{idx + 1} ({chunk.chunkId})</span>
                                  <div className="flex items-center gap-2.5">
                                    <Badge tone={chunk.status === 'approved' ? 'green' : chunk.status === 'pending' ? 'yellow' : 'red'}>{chunk.status}</Badge>
                                    <span>Domain: {chunk.domain}</span>
                                  </div>
                                </div>
                                <textarea
                                  className={input + ' text-xs font-mono'}
                                  rows={3}
                                  defaultValue={chunk.text}
                                  onBlur={async (e) => {
                                    try {
                                      await adminApi.updateDocumentChunk(chunk.id, { text: e.target.value });
                                      notify('Chunk updated successfully.');
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    }
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Section>
              )}

              {/* ── AI PLAYGROUND TAB ── */}
              {tab === 'playground' && (
                <Section title="AI RAG & Dataset Knowledge Playground" hint="Test live AI responses using deployed dataset knowledge adapters and Knowledge Base citations.">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
                    <div className={`${card} p-6 sm:p-8 space-y-5 min-w-0`}>
                      <Field label="Test Question / Task">
                        <textarea
                          rows={4}
                          className={input}
                          value={pgQ}
                          onChange={(e) => setPgQ(e.target.value)}
                          placeholder="Ask a question about your indexed documents, forms, or rubrics..."
                        />
                      </Field>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field label="Knowledge Base">
                          <select className={input} value={pgKb} onChange={(e) => setPgKb(e.target.value)}>
                            <option value="">All Knowledge Bases</option>
                            {kbs.map((kb) => (
                              <option key={kb.id} value={kb.id}>{kb.name}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Active Model">
                          <select className={input} value={pgModel} onChange={(e) => setPgModel(e.target.value)}>
                            <option value="">Auto (Latest Dataset-grounded Prompt Adapter / Primary)</option>
                            {models.map((m) => (
                              <option key={m.id} value={m.name}>{m.name}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <button
                        onClick={async () => {
                          if (!pgQ.trim()) return;
                          setPgLoading(true);
                          try {
                            const res = await adminApi.runPlayground({
                              question: pgQ,
                              knowledgeBaseId: pgKb || undefined,
                              model: pgModel || undefined,
                            });
                            setPgResult((res as any).data);
                            notify('Live RAG + prompt-adapter query completed');
                          } catch (err: any) {
                            notify(err.message, true);
                          } finally {
                            setPgLoading(false);
                          }
                        }}
                        className={btnPrimary + ' w-full py-3.5'}
                        disabled={pgLoading}
                      >
                        <FlaskConical size={18} /> {pgLoading ? 'Executing on GonkaRouter...' : 'Run Live Query'}
                      </button>
                    </div>

                    <div className={`${card} p-6 sm:p-8 space-y-5 min-w-0 overflow-y-auto max-h-[650px]`}>
                      <h3 className="font-bold text-white text-base">Model Output &amp; Retrieved Chunks</h3>
                      {pgResult ? (
                        <div className="space-y-5 text-sm min-w-0">
                          <div className="flex items-center justify-between text-xs text-[#7CC4EE] font-bold">
                            <span>Model: {pgResult.modelUsed || 'GonkaRouter'}</span>
                            <span>Latency: {pgResult.latencyMs || 180}ms</span>
                          </div>
                          <div className="p-4 bg-[#0F1424] rounded-2xl border border-[#2E3A63] min-w-0 shadow-inner">
                            <p className="font-bold text-white mb-1.5">Answer:</p>
                            <p className="text-[#E8EAF2] break-words whitespace-pre-wrap leading-relaxed">{pgResult.answer}</p>
                          </div>
                          <div>
                            <p className="font-bold text-white mb-2.5">Verified Citations:</p>
                            <div className="space-y-2">
                              {pgResult.citations?.map((c: any, idx: number) => (
                                <div key={idx} className="p-3 bg-[#18213D] rounded-xl border border-[#263052] text-xs min-w-0">
                                  <span className="text-[#3FA7E0] font-bold break-words">{c.sourceFilename}</span> (Page {c.pageNumber}, {c.section})
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Correction Workbench Button & Form */}
                          <div className="pt-3 border-t border-[#263052]">
                            {!correcting ? (
                              <button
                                onClick={() => {
                                  setCorrecting(true);
                                  setCorrectedText(pgResult.answer);
                                }}
                                className={btnGhost + ' w-full text-xs py-3'}
                              >
                                ✏️ Correct this answer (Learning Signal)
                              </button>
                            ) : (
                              <div className="space-y-4 p-4 bg-[#141C33] rounded-2xl border border-[#3FA7E0]/40 shadow-xl">
                                <p className="text-xs font-bold text-[#3FA7E0] uppercase tracking-wider">Submit Human Correction</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <Field label="Error Type">
                                    <select className={input + ' text-xs py-2'} value={correctionErrorType} onChange={(e) => setCorrectionErrorType(e.target.value)}>
                                      <option value="wrong_fact">Wrong Fact</option>
                                      <option value="outdated">Outdated</option>
                                      <option value="unnatural_rw">Unnatural Kinyarwanda</option>
                                      <option value="wrong_lang">Wrong Language</option>
                                      <option value="missing_info">Missing Info</option>
                                    </select>
                                  </Field>
                                  <Field label="Severity">
                                    <select className={input + ' text-xs py-2'} value={correctionSeverity} onChange={(e) => setCorrectionSeverity(e.target.value)}>
                                      <option value="minor">Minor</option>
                                      <option value="major">Major</option>
                                      <option value="harmful">Harmful</option>
                                    </select>
                                  </Field>
                                </div>
                                <Field label="Corrected Answer">
                                  <textarea
                                    className={input + ' text-xs'}
                                    rows={3}
                                    value={correctedText}
                                    onChange={(e) => setCorrectedText(e.target.value)}
                                  />
                                </Field>
                                <div className="flex justify-end gap-2.5">
                                  <button onClick={() => setCorrecting(false)} className={btnGhost + ' py-2 px-3 text-xs'}>Cancel</button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        await adminApi.submitCorrection({
                                          question: pgQ,
                                          aiAnswer: pgResult.answer,
                                          correctedAnswer: correctedText,
                                          errorType: correctionErrorType,
                                          severity: correctionSeverity,
                                          domain: correctionDomain,
                                          sourcesUsed: JSON.stringify(pgResult.citations || []),
                                          retrievedChunks: JSON.stringify(pgResult.chunks || []),
                                          modelUsed: pgResult.modelUsed,
                                        });
                                        notify('Correction submitted to Review Queue successfully.');
                                        setCorrecting(false);
                                        await loadData(true);
                                      } catch (err: any) {
                                        notify(err.message, true);
                                      }
                                    }}
                                    className={btnPrimary + ' py-2 px-4 text-xs'}
                                  >
                                    Submit Correction
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <EmptyState title="No Query Executed" desc="Run a prompt on the left to test the RAG engine and view citations." icon={<FlaskConical size={28} />} />
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {/* ── REVIEW QUEUE TAB ── */}
              {tab === 'review' && (
                <Section title="Live Query Review Queue" hint="Review user questions, AI responses, and human corrections. Approved corrections instantly enter the Verified Answers store.">
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[760px]">
                      <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Question</th>
                          <th className="p-4">AI Answer vs Corrected</th>
                          <th className="p-4">Error Type / Severity</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {corrections.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-sm text-[#9AA6C9]">No corrections in the review queue.</td>
                          </tr>
                        ) : (
                          corrections.map((item) => (
                            <tr key={item.id} className="hover:bg-[#18213D]/60 transition-colors align-top">
                              <td className="p-4 font-bold text-white max-w-[220px] truncate" title={item.question}>{item.question}</td>
                              <td className="p-4 space-y-1.5 max-w-[320px]">
                                <p className="text-xs text-red-300 line-clamp-2">AI: {item.aiAnswer || '(None)'}</p>
                                <p className="text-xs text-emerald-300 font-bold line-clamp-3">Corrected: {item.correctedAnswer}</p>
                              </td>
                              <td className="p-4">
                                <Badge tone="yellow">{item.errorType}</Badge>
                                <span className="block text-xs font-semibold text-[#9AA6C9] mt-1">Severity: {item.severity}</span>
                              </td>
                              <td className="p-4">
                                <Badge tone={item.status === 'approved_2' ? 'green' : item.status === 'pending' ? 'yellow' : 'red'}>{item.status}</Badge>
                              </td>
                              <td className="p-4 flex flex-wrap gap-2">
                                {item.status !== 'approved_2' && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await adminApi.approveCorrection(item.id);
                                        notify('Correction approved & added to verified answers.');
                                        await loadData(true);
                                      } catch (err: any) {
                                        notify(err.message, true);
                                      }
                                    }}
                                    className={btnPrimary + ' py-1.5 px-3 text-xs'}
                                  >
                                    Approve
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    try {
                                      await adminApi.rejectCorrection(item.id, 'Rejected by admin');
                                      notify('Correction rejected.');
                                      await loadData(true);
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    }
                                  }}
                                  className={btnGhost + ' py-1.5 px-3 text-xs text-red-300'}
                                >
                                  Reject
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── VERIFIED ANSWERS TAB ── */}
              {tab === 'verified' && (
                <Section title="Verified Answers Store" hint="Authoritative answers injected ahead of normal RAG retrieval for instant learning from human corrections.">
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[760px]">
                      <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Question</th>
                          <th className="p-4">Verified Answer</th>
                          <th className="p-4">Domain / Lang</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {verifiedAnswers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-sm text-[#9AA6C9]">No verified answers stored yet.</td>
                          </tr>
                        ) : (
                          verifiedAnswers.map((va) => (
                            <tr key={va.id} className="hover:bg-[#18213D]/60 transition-colors align-top">
                              <td className="p-4 font-bold text-white max-w-[240px] truncate" title={va.question}>{va.question}</td>
                              <td className="p-4 text-[#E8EAF2] text-xs max-w-[360px] line-clamp-3 font-medium">{va.answer}</td>
                              <td className="p-4 text-xs font-bold text-[#7CC4EE]">{va.domain} ({va.language})</td>
                              <td className="p-4"><Badge tone="green">{va.status}</Badge></td>
                              <td className="p-4 text-xs text-[#9AA6C9]">{new Date(va.createdAt).toLocaleDateString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── RETRIEVAL SETTINGS TAB ── */}
              {tab === 'retrieval' && retrievalSet && (
                <Section title="Retrieval & Chunking Settings" hint="Configure chunk size, overlap, top-K, and similarity thresholds per environment.">
                  <div className={`${card} p-6 sm:p-8 max-w-xl space-y-5 w-full min-w-0`}>
                    <Field label="Chunk Size (characters)">
                      <input type="number" className={input} value={retrievalSet.chunkSize} onChange={(e) => setRetrievalSet({ ...retrievalSet, chunkSize: Number(e.target.value) })} />
                    </Field>
                    <Field label="Chunk Overlap (characters)">
                      <input type="number" className={input} value={retrievalSet.overlap} onChange={(e) => setRetrievalSet({ ...retrievalSet, overlap: Number(e.target.value) })} />
                    </Field>
                    <Field label="Top-K Chunks Retrieved">
                      <input type="number" className={input} value={retrievalSet.topK} onChange={(e) => setRetrievalSet({ ...retrievalSet, topK: Number(e.target.value) })} />
                    </Field>
                    <Field label="Similarity Threshold">
                      <input type="number" step="0.05" className={input} value={retrievalSet.threshold} onChange={(e) => setRetrievalSet({ ...retrievalSet, threshold: Number(e.target.value) })} />
                    </Field>
                    <button
                      onClick={async () => {
                        await adminApi.updateRetrievalSettings({ ...retrievalSet, environment: env });
                        notify('Retrieval settings saved to database');
                      }}
                      className={btnPrimary + ' w-full py-3.5'}
                    >
                      Save Retrieval Settings
                    </button>
                  </div>
                </Section>
              )}

              {/* ── SYSTEM PROMPTS TAB ── */}
              {tab === 'prompts' && (
                <Section title="System Prompts & Active Directives" hint="Create and promote system prompts that directly govern live AI behavior.">
                  <div className={`${card} p-6 space-y-4`}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field label="Prompt Name">
                        <input
                          className={input}
                          value={newPromptName}
                          onChange={(e) => setNewPromptName(e.target.value)}
                          placeholder="e.g. Strict STEM Rubric Grader"
                        />
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="System Directive Text">
                          <input
                            className={input}
                            value={newPromptText}
                            onChange={(e) => setNewPromptText(e.target.value)}
                            placeholder="Execute grading and dataset analysis concisely without filler prose..."
                          />
                        </Field>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!newPromptName.trim() || !newPromptText.trim()) {
                          notify('Enter both prompt name and directive text.', true);
                          return;
                        }
                        await adminApi.createPrompt({
                          name: newPromptName.trim(),
                          text: newPromptText.trim(),
                          environment: env,
                        });
                        setNewPromptName('');
                        setNewPromptText('');
                        notify('Prompt saved as an inactive draft. Promote it after review.');
                        await loadData(true);
                      }}
                      className={btnPrimary}
                    >
                      <Plus size={16} /> Save Prompt Draft
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {prompts.map((p) => (
                      <div key={p.id} className={`${card} p-6 space-y-4 min-w-0`}>
                        <h3 className="font-bold text-white text-base truncate">{p.name}</h3>
                        {p.versions?.map((v: any) => (
                          <div key={v.id} className="p-4 bg-[#0F1424] rounded-xl border border-[#2E3A63] text-xs space-y-3 min-w-0 shadow-inner">
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-bold text-white truncate">Version {v.version} ({v.environment})</span>
                              {v.active && <Badge tone="green">Active</Badge>}
                            </div>
                            <p className="text-[#9AA6C9] line-clamp-3 break-words font-mono">{v.text}</p>
                            <button
                              onClick={async () => {
                                const confirmed = window.confirm(`Promote version ${v.version} of “${p.name}” to production? This changes instructions used by live AI requests.`);
                                if (!confirmed) return;
                                await adminApi.promotePrompt(p.id, v.id, 'production', true);
                                notify('Prompt promoted to production');
                                await loadData(true);
                              }}
                              className={btnGhost + ' text-xs py-2 px-3.5 font-bold'}
                            >
                              Promote to Production
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── PROVIDERS TAB ── */}
              {tab === 'providers' && (
                <Section title="AI Connections & Providers" hint="Manage provider model and gateway settings. Credentials stay in server or deployment secrets; status confirms credentials are present, not that a live request succeeds.">
                  <form
                    className={`${card} grid grid-cols-1 gap-4 p-5 md:grid-cols-2`}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!newProviderModel.trim()) {
                        notify('Enter a model name before saving.', true);
                        return;
                      }
                      setSavingProvider(true);
                      try {
                        await adminApi.updateProvider({
                          provider: newProvider,
                          model: newProviderModel.trim(),
                          baseUrl: newProviderBaseUrl.trim() || null,
                        });
                        await loadData(true);
                        setNewProviderModel('');
                        setNewProviderBaseUrl('');
                        notify(`${newProvider} connection saved`);
                      } catch (err: any) {
                        notify(err.message, true);
                      } finally {
                        setSavingProvider(false);
                      }
                    }}
                  >
                    <Field label="Provider">
                      <select className={input} value={newProvider} onChange={(event) => setNewProvider(event.target.value)}>
                        {['GONKAROUTER', 'GEMINI', 'OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'OPENROUTER', 'NVIDIA NIM', 'OLLAMA'].map((provider) => (
                          <option key={provider} value={provider}>{provider}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Model">
                      <input className={input} value={newProviderModel} onChange={(event) => setNewProviderModel(event.target.value)} maxLength={200} required placeholder="Provider model identifier" />
                    </Field>
                    <Field label="Gateway URL" tip="Optional. Keep credentials in deployment secrets, never in this form.">
                      <input className={input} value={newProviderBaseUrl} onChange={(event) => setNewProviderBaseUrl(event.target.value)} maxLength={2000} placeholder="Use provider default" />
                    </Field>
                    <div className="flex items-end">
                      <button type="submit" className={btnPrimary} disabled={savingProvider}>
                        <Plus size={15} /> {savingProvider ? 'Saving connection…' : 'Add or update connection'}
                      </button>
                    </div>
                  </form>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {providers.map((prv, idx) => (
                      <form
                        key={idx}
                        className={`${card} p-6 space-y-4 min-w-0`}
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const settings = providerForms[prv.provider];
                          if (!settings?.model.trim()) {
                            notify('Enter a model name before saving.', true);
                            return;
                          }
                          try {
                            await adminApi.updateProvider({
                              provider: prv.provider,
                              model: settings.model.trim(),
                              baseUrl: settings.baseUrl.trim() || null,
                            });
                            await loadData(true);
                            notify(`${prv.provider} connection settings saved`);
                          } catch (err: any) {
                            notify(err.message, true);
                          }
                        }}
                      >
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-bold text-white text-base truncate">{prv.provider}</h3>
                          <Badge tone={prv.configured ? 'green' : 'yellow'}>{prv.configured ? 'Configured' : 'Not configured'}</Badge>
                        </div>
                        <Field label="Model">
                          <input
                            className={input}
                            value={providerForms[prv.provider]?.model ?? prv.model}
                            onChange={(event) => setProviderForms((current) => ({
                              ...current,
                              [prv.provider]: { ...current[prv.provider], model: event.target.value, baseUrl: current[prv.provider]?.baseUrl ?? '' },
                            }))}
                            maxLength={200}
                          />
                        </Field>
                        <Field label="Gateway URL" tip="Leave blank to use the provider default. Keep credentials in deployment secrets, never in this form.">
                          <input
                            className={input}
                            value={providerForms[prv.provider]?.baseUrl ?? ''}
                            onChange={(event) => setProviderForms((current) => ({
                              ...current,
                              [prv.provider]: { ...current[prv.provider], model: current[prv.provider]?.model ?? prv.model, baseUrl: event.target.value },
                            }))}
                            maxLength={2000}
                            placeholder="Use provider default"
                          />
                        </Field>
                        <button type="submit" className={btnPrimary}><CheckCircle2 size={15} /> Save connection settings</button>
                      </form>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── ANALYTICS TAB ── */}
              {tab === 'analytics' && analytics && (
                <Section title="Live Usage & Adapter Analytics" hint="Computed from UsageEvents, ApplicationForms, and dataset-grounded prompt adapter jobs.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Total AI Queries" value={analytics.totalQuestions} detail="Logged in database" />
                    <Stat label="Knowledge Grounded" value={`${analytics.answeredRate}%`} detail="Verified context rate" />
                    <Stat label="Avg Inference Latency" value={`${analytics.avgLatencyMs} ms`} detail="GonkaRouter streaming" />
                    <Stat label="Estimated Cost" value={`$${analytics.costUsd}`} detail="Estimate from configured token rates" />
                  </div>
                </Section>
              )}

              {/* ── AI QUALITY TAB ── */}
              {tab === 'quality' && quality && (
                <Section title="AI Quality Baseline" hint="Deterministic offline evaluation snapshot from the local benchmark harness for retrieval, grounding, extraction, JSON validity, and DOCX generation.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <Stat label="Success Rate" value={`${Math.round((quality.metrics?.successRate ?? 0) * 100)}%`} detail={`${quality.metrics?.passCount ?? 0}/${quality.metrics?.caseCount ?? 0} cases passed`} />
                    <Stat label="95% CI" value={quality.metrics?.confidenceInterval95 ? `${Math.round((quality.metrics.confidenceInterval95[0] ?? 0) * 100)}%-${Math.round((quality.metrics.confidenceInterval95[1] ?? 0) * 100)}%` : 'n/a'} detail="Wilson interval" />
                    <Stat label="Instability" value={`${Math.round((quality.metrics?.instabilityRate ?? 0) * 100)}%`} detail="Repeated-run variance" />
                    <Stat label="Report Time" value={quality.generatedAt ? new Date(quality.generatedAt).toLocaleDateString() : 'n/a'} detail={quality.reportFile ? quality.reportFile : 'Latest offline run'} />
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-5">
                    <div className={`${card} p-6 space-y-4`}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-white">Capability breakdown</h3>
                        <Badge tone={quality.status === 'healthy' ? 'green' : quality.status === 'watch' ? 'yellow' : 'red'}>{quality.status}</Badge>
                      </div>
                      <div className="space-y-4">
                        {quality.capabilityBreakdown?.map((item: any) => (
                          <div key={item.capability} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-semibold text-white">Capability {item.capability}</span>
                              <span className="text-[#9AA6C9]">{item.passed}/{item.total} passed</span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-[#10193A]">
                              <div className="h-full rounded-full bg-gradient-to-r from-[#3FA7E0] to-[#3DB27A]" style={{ width: `${Math.max(0, Math.min(100, item.successRate * 100))}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className={`${card} p-6 space-y-4`}>
                      <h3 className="text-base font-bold text-white">Evaluation notes</h3>
                      <p className="text-sm leading-6 text-[#9AA6C9]">{quality.notMeasured || 'No live provider calls are made by this benchmark; the evaluator remains deterministic and offline-only.'}</p>
                      <div className="rounded-xl border border-[#263052] bg-[#0B1020] p-4 text-xs text-[#C8D2F1] font-mono break-words">
                        <div>{quality.evaluationMode || 'offline deterministic component evaluation'}</div>
                        <div className="mt-2 text-[#7CC4EE]">{quality.split ? `Split: ${quality.split}` : 'Split: dev'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <h3 className="text-base font-bold text-white">Live request traces (last 7 days; up to 500 newest)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                      <Stat label="Traces" value={quality.traceMetrics?.traceCount ?? 0} detail="Recent agent requests" />
                      <Stat label="Trace Success" value={quality.traceMetrics?.successRate == null ? 'n/a' : `${(quality.traceMetrics.successRate * 100).toFixed(1)}%`} detail="Successful final status" />
                      <Stat label="Tool Error Rate" value={quality.traceMetrics?.toolErrorRate == null ? 'n/a' : `${(quality.traceMetrics.toolErrorRate * 100).toFixed(1)}%`} detail="Failed tool calls / all calls" />
                      <Stat label="Retries" value={quality.traceMetrics?.retries ?? 0} detail={`${quality.traceMetrics?.averageRetries == null ? 'n/a' : quality.traceMetrics.averageRetries.toFixed(2)} average per trace`} />
                      <Stat label="Request Latency p50 / p95" value={`${quality.traceMetrics?.latencyP50Ms ?? 'n/a'} / ${quality.traceMetrics?.latencyP95Ms ?? 'n/a'} ms`} detail="Agent runtime" />
                      <Stat label="Average Cost / Request" value={quality.traceMetrics?.averageCostUsd == null ? 'NOT MEASURED' : `$${quality.traceMetrics.averageCostUsd.toFixed(4)}`} detail="Provider cost metadata unavailable" />
                    </div>
                    {quality.traceMetrics?.capabilityStats?.length > 0 && (
                      <div className={`${card} p-5 space-y-3`}>
                        <h4 className="font-bold text-white">Observed request success by capability</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                          {quality.traceMetrics.capabilityStats.map((item) => (
                            <div key={item.capability} className="rounded-xl border border-[#263052] bg-[#0B1020] p-4">
                              <p className="text-xs uppercase tracking-wide text-[#9AA6C9]">{item.capability}</p>
                              <p className="mt-1 text-lg font-bold text-white">{item.successRate == null ? 'n/a' : `${(item.successRate * 100).toFixed(1)}%`}</p>
                              <p className="text-xs text-[#7C8CB8]">{item.successes}/{item.traces} traces successful</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {quality.traceMetrics?.toolStats?.length > 0 && (
                      <div className={`${card} p-5 space-y-3`}>
                        <h4 className="font-bold text-white">Tool reliability</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[460px] text-left text-xs">
                            <thead className="text-[#9AA6C9] uppercase border-b border-[#263052]">
                              <tr>
                                <th className="p-3">Tool</th>
                                <th className="p-3">Calls</th>
                                <th className="p-3">Errors</th>
                                <th className="p-3">Error rate</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#263052]">
                              {quality.traceMetrics.toolStats.map((item) => (
                                <tr key={item.name}>
                                  <td className="p-3 font-mono text-white">{item.name}</td>
                                  <td className="p-3 text-[#C8D2F1]">{item.calls}</td>
                                  <td className="p-3 text-[#FF8798]">{item.errors}</td>
                                  <td className="p-3 text-[#9AA6C9]">{item.calls ? `${((item.errors / item.calls) * 100).toFixed(1)}%` : 'n/a'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {quality.traceMetrics?.topFailureClasses?.length > 0 && (
                      <div className={`${card} p-5 space-y-3`}>
                        <h4 className="font-bold text-white">Top failure classes</h4>
                        <div className="flex flex-wrap gap-2">
                          {quality.traceMetrics.topFailureClasses.map((item) => (
                            <Badge key={item.failureClass} tone="red">{item.failureClass}: {item.count}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className={`${card} p-5 space-y-3`}>
                      <h4 className="font-bold text-white">Recent failing traces</h4>
                      <p className="text-xs text-[#9AA6C9]">Trace summaries omit prompts, model outputs, and tool arguments. Replay is not available because request content is not retained.</p>
                      {quality.traceMetrics?.failingTraces?.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[620px] text-left text-xs">
                            <thead className="text-[#9AA6C9] uppercase border-b border-[#263052]">
                              <tr>
                                <th className="p-3">Time</th>
                                <th className="p-3">Capability</th>
                                <th className="p-3">Status / failure</th>
                                <th className="p-3">Model / provider</th>
                                <th className="p-3">Latency</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#263052]">
                              {quality.traceMetrics.failingTraces.map((trace) => (
                                <tr key={trace.id}>
                                  <td className="p-3 text-[#9AA6C9] whitespace-nowrap">{new Date(trace.createdAt).toLocaleString()}</td>
                                  <td className="p-3 text-white">{trace.capability}</td>
                                  <td className="p-3 text-[#FF8798]">{trace.finalStatus}{trace.failureClass ? ` · ${trace.failureClass}` : ''}</td>
                                  <td className="p-3 text-[#C8D2F1]">{trace.model} · {trace.provider}</td>
                                  <td className="p-3 text-[#9AA6C9]">{trace.latencyMs} ms</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-[#9AA6C9]">No failing traces recorded in the last 7 days.</p>
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {/* ── RESPONSE FEEDBACK & SUPPORT TAB ── */}
              {tab === 'feedback' && (
                <Section
                  title="Feedback & Support"
                  hint="Review ratings and the follow-up notes users leave on AI responses. Feedback only becomes a learning example after user consent and human review."
                  actions={<Badge tone="blue">{feedbackItems.length} responses</Badge>}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Stat label="New feedback" value={feedbackItems.filter((item) => item.status === 'new').length} detail="Waiting for review" />
                    <Stat label="Opted in for improvement" value={feedbackItems.filter((item) => item.consentForImprovement).length} detail="Human review still required" />
                    <Stat label="Prepared examples" value={feedbackItems.filter((item) => item.status === 'used').length} detail="Pending dataset quality checks" />
                  </div>

                  <div className={`${card} p-4 sm:p-5 space-y-2`}>
                    <Field label="Learning dataset" tip="Only feedback whose author opted in can be used to prepare a pending dataset example.">
                      <select className={input} value={feedbackDatasetId} onChange={(event) => setFeedbackDatasetId(event.target.value)}>
                        {datasets.length === 0 && <option value="">Create a dataset first</option>}
                        {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                      </select>
                    </Field>
                    <p className="text-xs leading-relaxed text-[#9AA6C9]">
                      Feedback never changes model behavior automatically. An opted-in response can be prepared as a pending example; an administrator must check the correction, consent, and personal information before approving it in Datasets.
                    </p>
                  </div>

                  {feedbackItems.length === 0 ? (
                    <EmptyState title="No response feedback yet" desc="Thumbs-up ratings and submitted improvement notes will appear here." icon={<MessageSquare size={26} />} />
                  ) : (
                    <div className="space-y-4">
                      {feedbackItems.map((item) => (
                        <article key={item.id} className={`${card} space-y-4 p-5`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone={item.rating === 'up' ? 'green' : 'red'}>{item.rating === 'up' ? 'HELPFUL' : 'NEEDS WORK'}</Badge>
                                <Badge tone={item.status === 'used' ? 'blue' : item.status === 'reviewed' ? 'green' : 'yellow'}>{item.status}</Badge>
                                {item.consentForImprovement && <Badge tone="blue">IMPROVEMENT CONSENT</Badge>}
                              </div>
                              <p className="mt-2 text-xs text-[#9AA6C9]">
                                {item.user?.name || 'User'} · {item.user?.email || 'account unavailable'} · {new Date(item.createdAt).toLocaleString()}
                              </p>
                            </div>
                            {item.status !== 'used' && (
                              <button
                                type="button"
                                className={btnGhost}
                                onClick={async () => {
                                  try {
                                    await adminApi.updateFeedbackStatus(item.id, item.status === 'reviewed' ? 'new' : 'reviewed');
                                    await loadData(true);
                                    notify(item.status === 'reviewed' ? 'Feedback moved back to new' : 'Feedback marked as reviewed');
                                  } catch (err: any) {
                                    notify(err.message, true);
                                  }
                                }}
                              >
                                Mark {item.status === 'reviewed' ? 'new' : 'reviewed'}
                              </button>
                            )}
                          </div>

                          {displayFeedbackReasons(item.reasons) && (
                            <p className="text-sm text-[#F4A185]"><span className="font-semibold text-[#B7C1DE]">Reason: </span>{displayFeedbackReasons(item.reasons)}</p>
                          )}
                          {item.question && (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9AA6C9]">User prompt</p>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white">{item.question}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#9AA6C9]">AI response</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#D5D9E8]">{item.response}</p>
                          </div>
                          {item.details && (
                            <div className="rounded-xl border border-[#2A3760] bg-[#0D1220] p-3">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-[#9AA6C9]">User note</p>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white">{item.details}</p>
                            </div>
                          )}

                          {item.consentForImprovement && item.status !== 'used' && (
                            <div className="space-y-3 border-t border-[#263052] pt-4">
                              <Field label="Reviewed correction" tip="Write the corrected answer. It will remain pending until a human reviews consent and PII in Datasets.">
                                <textarea
                                  className={input}
                                  rows={3}
                                  maxLength={20_000}
                                  value={feedbackCorrections[item.id] || ''}
                                  onChange={(event) => setFeedbackCorrections((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder="Enter a corrected answer or the response you would expect instead."
                                />
                              </Field>
                              <button
                                type="button"
                                className={btnPrimary}
                                disabled={!feedbackDatasetId || !feedbackCorrections[item.id]?.trim()}
                                onClick={async () => {
                                  try {
                                    await adminApi.addFeedbackDatasetExample(item.id, {
                                      datasetId: feedbackDatasetId,
                                      correctedAnswer: feedbackCorrections[item.id].trim(),
                                    });
                                    await loadData(true);
                                    notify('Added as a pending dataset example. Review it before approval.');
                                  } catch (err: any) {
                                    notify(err.message, true);
                                  }
                                }}
                              >
                                <Plus size={15} /> Prepare learning example
                              </button>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── BILLING, UPGRADES & SUBSCRIPTIONS TAB ── */}
              {tab === 'billing' && (
                <Section
                  title="Upgrades & Subscriptions"
                  hint="Review institutional upgrade requests, inspect payment records, and manage a user's subscription. Manual subscription changes are audited; payment statuses are read-only and remain controlled by verified payment-provider callbacks."
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Stat label="Active subscriptions" value={billingData.subscriptions.filter((subscription) => subscription.status === 'ACTIVE').length} detail="Across BUSINESS, PRO, and ORGANIZATION" />
                    <Stat label="Pending payments" value={billingData.payments.filter((payment) => payment.status === 'PENDING').length} detail="Awaiting provider confirmation" />
                    <Stat label="Open upgrade requests" value={billingData.requests.filter((request) => request.status !== 'closed').length} detail="Institutional pricing enquiries" />
                  </div>

                  <Section title="Manage an account subscription" hint="Grant or update access after confirming the request or payment. Free/pay-as-you-go users have no subscription record.">
                    <form
                      className={`${card} grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-5`}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (!billingUserId) {
                          notify('Select an account first.', true);
                          return;
                        }
                        if (!window.confirm(`Save ${billingPlan} · ${billingStatus} for the selected account?`)) return;
                        try {
                          await adminApi.updateSubscription(billingUserId, {
                            planType: billingPlan,
                            status: billingStatus,
                            endDate: billingEndDate ? new Date(`${billingEndDate}T23:59:59.999Z`).toISOString() : null,
                          });
                          await loadData(true);
                          notify('Subscription updated');
                        } catch (err: any) {
                          notify(err.message, true);
                        }
                      }}
                    >
                      <Field label="Account">
                        <select className={input} value={billingUserId} onChange={(event) => {
                          const userId = event.target.value;
                          setBillingUserId(userId);
                          const current = billingData.subscriptions.find((subscription) => subscription.userId === userId);
                          setBillingPlan(current?.planType || 'PRO');
                          setBillingStatus(current?.status || 'ACTIVE');
                          setBillingEndDate(current?.endDate ? new Date(current.endDate).toISOString().slice(0, 10) : '');
                        }}>
                          {users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
                        </select>
                      </Field>
                      <Field label="Plan">
                        <select className={input} value={billingPlan} onChange={(event) => setBillingPlan(event.target.value)}>
                          <option value="BUSINESS">BUSINESS</option>
                          <option value="PRO">PRO</option>
                          <option value="ORGANIZATION">ORGANIZATION</option>
                        </select>
                      </Field>
                      <Field label="Access status">
                        <select className={input} value={billingStatus} onChange={(event) => setBillingStatus(event.target.value)}>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="EXPIRED">EXPIRED</option>
                          <option value="CANCELED">CANCELED</option>
                        </select>
                      </Field>
                      <Field label="Expiry date" tip="Leave blank for no scheduled expiry. The app stores the selected date through the end of that day (UTC).">
                        <input className={input} type="date" value={billingEndDate} onChange={(event) => setBillingEndDate(event.target.value)} />
                      </Field>
                      <div className="flex items-end">
                        <button type="submit" className={btnPrimary} disabled={!billingUserId}>
                          <CheckCircle2 size={15} /> Save subscription
                        </button>
                      </div>
                    </form>
                  </Section>

                  <Section title="Customer subscriptions" hint="Search current entitlements and see when they next expire.">
                    <input className={`${input} max-w-sm`} value={billingSearch} onChange={(event) => setBillingSearch(event.target.value)} placeholder="Search accounts or plans" aria-label="Search subscriptions" />
                    <div className={`${card} overflow-x-auto`}>
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="border-b border-[#263052] bg-[#141C36] text-xs font-bold uppercase text-[#9AA6C9]">
                          <tr>
                            <th className="p-4">Account</th><th className="p-4">Plan</th><th className="p-4">Status</th><th className="p-4">Expires</th><th className="p-4">Updated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#263052]">
                          {users
                            .filter((user) => {
                              const subscription = billingData.subscriptions.find((entry) => entry.userId === user.id);
                              return `${user.name} ${user.email} ${subscription?.planType || 'FREE'}`.toLowerCase().includes(billingSearch.toLowerCase());
                            })
                            .map((user) => {
                              const subscription = billingData.subscriptions.find((entry) => entry.userId === user.id);
                              return (
                                <tr key={user.id} className="hover:bg-[#18213D]/60">
                                  <td className="p-4"><p className="font-semibold text-white">{user.name}</p><p className="text-xs text-[#9AA6C9]">{user.email}</p></td>
                                  <td className="p-4 text-white">{subscription?.planType || 'FREE'}</td>
                                  <td className="p-4"><Badge tone={subscription?.status === 'ACTIVE' ? 'green' : subscription ? 'yellow' : 'gray'}>{subscription?.status || 'FREE'}</Badge></td>
                                  <td className="p-4 text-[#9AA6C9]">{subscription?.endDate ? new Date(subscription.endDate).toLocaleDateString() : subscription ? 'No expiry' : '—'}</td>
                                  <td className="p-4 text-[#9AA6C9]">{subscription?.updatedAt ? new Date(subscription.updatedAt).toLocaleDateString() : '—'}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </Section>

                  <Section title="Institution upgrade requests" hint="Requests from the Organisation upgrade option are saved here for follow-up.">
                    {billingData.requests.length === 0 ? (
                      <EmptyState title="No organization upgrade requests" desc="New requests for institutional pricing and setup will appear here." icon={<Users size={26} />} />
                    ) : (
                      <div className="space-y-3">
                        {billingData.requests.map((request) => (
                          <article key={request.id} className={`${card} flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between`}>
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-bold text-white">{request.organizationName}</h3>
                                <Badge tone={request.status === 'closed' ? 'gray' : request.status === 'contacted' ? 'blue' : 'yellow'}>{request.status}</Badge>
                              </div>
                              <p className="text-xs text-[#9AA6C9]">{request.user?.name} · {request.user?.email} · {new Date(request.createdAt).toLocaleString()}</p>
                              <p className="text-sm text-[#D5D9E8]">
                                {request.faculty ? `${request.faculty} · ` : ''}{request.estimatedSeats ? `${request.estimatedSeats} estimated seats` : 'Seats not specified'}
                              </p>
                              <p className="text-xs text-[#9AA6C9]">Contact: {request.contactEmail}</p>
                              {request.message && <p className="whitespace-pre-wrap text-sm text-white">{request.message}</p>}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <a
                                className={btnGhost}
                                href={`mailto:${encodeURIComponent(request.contactEmail)}?subject=${encodeURIComponent(`Bwenge organization plan: ${request.organizationName}`)}`}
                              >
                                <Mail size={15} /> Email contact
                              </a>
                              <select
                                aria-label={`Status for ${request.organizationName} upgrade request`}
                                className={`${input} min-h-[42px] w-auto`}
                                value={request.status}
                                onChange={async (event) => {
                                  try {
                                    await adminApi.updateUpgradeRequestStatus(request.id, event.target.value as 'pending' | 'contacted' | 'closed');
                                    await loadData(true);
                                    notify('Upgrade request updated');
                                  } catch (err: any) {
                                    notify(err.message, true);
                                  }
                                }}
                              >
                                <option value="pending">Pending</option>
                                <option value="contacted">Contacted</option>
                                <option value="closed">Closed</option>
                              </select>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section title="Recent payment records" hint="Provider-confirmed payment history is read-only here. Initiate or refund transactions through the payment provider; this console never fabricates payment success.">
                    {billingData.payments.length === 0 ? (
                      <EmptyState title="No payments recorded" desc="Successful and pending upgrade or usage payments will appear here." icon={<BarChart3 size={26} />} />
                    ) : (
                      <div className={`${card} overflow-x-auto`}>
                        <table className="w-full min-w-[800px] text-left text-sm">
                          <thead className="border-b border-[#263052] bg-[#141C36] text-xs font-bold uppercase text-[#9AA6C9]">
                            <tr><th className="p-4">Date</th><th className="p-4">Account</th><th className="p-4">Reference</th><th className="p-4">Amount</th><th className="p-4">Provider</th><th className="p-4">Status</th></tr>
                          </thead>
                          <tbody className="divide-y divide-[#263052]">
                            {billingData.payments.map((payment) => (
                              <tr key={payment.id} className="hover:bg-[#18213D]/60">
                                <td className="p-4 whitespace-nowrap text-[#9AA6C9]">{new Date(payment.createdAt).toLocaleString()}</td>
                                <td className="p-4"><p className="text-white">{payment.user?.name || 'Account unavailable'}</p><p className="text-xs text-[#9AA6C9]">{payment.user?.email || payment.userId}</p></td>
                                <td className="p-4 text-xs text-[#9AA6C9]">{payment.externalRef || payment.batchId}</td>
                                <td className="p-4 text-white">{payment.amountRwf.toLocaleString()} RWF</td>
                                <td className="p-4 text-[#9AA6C9]">{payment.provider}</td>
                                <td className="p-4"><Badge tone={payment.status === 'SUCCESS' ? 'green' : payment.status === 'FAILED' ? 'red' : 'yellow'}>{payment.status}</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>
                </Section>
              )}

              {/* ── EMAIL COMMUNICATION TAB ── */}
              {tab === 'communication' && (
                <Section title="Email Communication" hint="Write and send an announcement to every enabled account. Emails are delivered individually, not as a shared recipient list.">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Stat label="Enabled recipients" value={users.filter((user) => !user.disabledAt).length} detail="Disabled accounts are excluded" />
                    <Stat label="Delivery" value="Email" detail="Uses the configured server email provider" />
                  </div>
                  <form
                    className={`${card} max-w-3xl space-y-5 p-5 sm:p-7`}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const recipientCount = users.filter((user) => !user.disabledAt).length;
                      if (!broadcastSubject.trim() || !broadcastText.trim()) {
                        notify('Enter both an email subject and message.', true);
                        return;
                      }
                      if (!window.confirm(`Send this email to ${recipientCount} enabled user accounts?`)) return;
                      setBroadcasting(true);
                      try {
                        const result = await adminApi.broadcastEmail({ subject: broadcastSubject, text: broadcastText });
                        notify(`Broadcast finished: ${result.data.delivered} delivered, ${result.data.failed} failed.`, result.data.failed > 0);
                        if (result.data.failed === 0) {
                          setBroadcastSubject('');
                          setBroadcastText('');
                        }
                      } catch (err: any) {
                        notify(err.message, true);
                      } finally {
                        setBroadcasting(false);
                      }
                    }}
                  >
                    <Field label="Subject">
                      <input className={input} value={broadcastSubject} onChange={(event) => setBroadcastSubject(event.target.value)} maxLength={180} required placeholder="A clear subject for your announcement" />
                    </Field>
                    <Field label="Message">
                      <textarea className={input} value={broadcastText} onChange={(event) => setBroadcastText(event.target.value)} rows={10} maxLength={10_000} required placeholder="Write your message to users..." />
                    </Field>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-[#9AA6C9]">{broadcastText.length.toLocaleString()} / 10,000 characters</span>
                      <button className={btnPrimary} type="submit" disabled={broadcasting || users.filter((user) => !user.disabledAt).length === 0}>
                        <Send size={15} /> {broadcasting ? 'Sending emails…' : `Send to ${users.filter((user) => !user.disabledAt).length} users`}
                      </button>
                    </div>
                  </form>
                </Section>
              )}

              {/* ── USERS TAB ── */}
              {tab === 'users' && (
                <Section title="User & Role Management" hint="Manage platform roles and account access. Disabling an account also revokes its active refresh sessions.">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-[#9AA6C9]">{users.filter((user) => !user.disabledAt).length} enabled · {users.length} total accounts</p>
                    <input
                      className={`${input} max-w-sm`}
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      placeholder="Search users by name or email"
                      aria-label="Search users by name or email"
                    />
                  </div>
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[760px]">
                      <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Email</th>
                          <th className="p-4">Role</th>
                          <th className="p-4">Account</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(userSearch.toLowerCase())).map((u) => (
                          <tr key={u.id} className="hover:bg-[#18213D]/60 transition-colors">
                            <td className="p-4 font-bold text-white truncate max-w-[160px]">{u.name}</td>
                            <td className="p-4 text-[#9AA6C9] truncate max-w-[220px]">{u.email}</td>
                            <td className="p-4"><Badge tone={u.role === 'ADMIN' ? 'green' : 'blue'}>{u.role}</Badge></td>
                            <td className="p-4">
                              <Badge tone={u.disabledAt ? 'red' : 'green'}>{u.disabledAt ? 'DISABLED' : 'ENABLED'}</Badge>
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <select
                                  className="bg-[#0B1020] text-xs font-bold text-white border border-[#2E3A63] rounded-xl px-3 py-2 cursor-pointer shadow-inner"
                                  value={u.role}
                                  onChange={async (e) => {
                                    try {
                                      await adminApi.updateUserRole(u.id, e.target.value);
                                      notify('User role updated');
                                      await loadData(true);
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    }
                                  }}
                                >
                                  <option value="ADMIN">ADMIN</option>
                                  <option value="INSTRUCTOR">INSTRUCTOR</option>
                                  <option value="STUDENT">STUDENT</option>
                                </select>
                                <button
                                  type="button"
                                  disabled={u.id === currentAdminId}
                                  title={u.id === currentAdminId ? 'You cannot disable your own administrator account.' : undefined}
                                  className={`${btnGhost} min-h-9 px-3 py-1.5 text-xs disabled:cursor-not-allowed`}
                                  onClick={async () => {
                                    try {
                                      await adminApi.updateUserStatus(u.id, !u.disabledAt);
                                      notify(u.disabledAt ? 'User account enabled' : 'User account disabled and sessions revoked');
                                      await loadData(true);
                                    } catch (err: any) {
                                      notify(err.message, true);
                                    }
                                  }}
                                >
                                  {u.disabledAt ? 'Enable' : 'Disable'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── AUDIT LOGS TAB ── */}
              {tab === 'logs' && (
                <Section title="System Audit Logs" hint="Immutable database audit trail of administrative and adapter actions.">
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm font-mono text-xs min-w-[760px]">
                      <thead className="bg-[#141C36] text-[#9AA6C9] uppercase border-b border-[#263052] font-bold">
                        <tr>
                          <th className="p-4">Timestamp</th>
                          <th className="p-4">Actor ID</th>
                          <th className="p-4">Action</th>
                          <th className="p-4">Resource Type</th>
                          <th className="p-4">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {auditLogs.map((l) => (
                          <tr key={l.id} className="hover:bg-[#18213D]/60 transition-colors">
                            <td className="p-4 text-[#6C789E] whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                            <td className="p-4 text-[#7CC4EE] truncate max-w-[130px]">{l.actorId}</td>
                            <td className="p-4 text-white font-bold truncate max-w-[180px]">{l.action}</td>
                            <td className="p-4 text-[#9AA6C9] truncate max-w-[130px]">{l.resourceType}</td>
                            <td className="p-4 text-[#6C789E] truncate max-w-[280px]" title={l.details}>{l.details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── SETTINGS TAB ── */}
              {tab === 'settings' && (
                <Section title="Control Plane Settings" hint="Database synchronization and system control actions.">
                  <div className={`${card} p-8 max-w-xl space-y-6 min-w-0`}>
                    <p className="text-sm text-[#9AA6C9] leading-relaxed">
                      Bwenge AI Admin Console is connected to live Forms, Submissions, Student Scripts, Knowledge Chunks, Datasets, and prompt adapters.
                    </p>
                    <button
                      onClick={async () => {
                        await loadData();
                        notify('Synchronized all tables with live database');
                      }}
                      className={btnPrimary + ' w-full py-3.5'}
                    >
                      <RefreshCw size={16} /> Force Full Database Sync
                    </button>
                  </div>
                </Section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function statusTone(s: string) {
  return s === 'active' || s === 'ONLINE' ? 'green' : s === 'WARNING' ? 'yellow' : 'gray';
}
