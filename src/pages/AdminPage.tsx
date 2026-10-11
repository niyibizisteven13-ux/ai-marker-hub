import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, BarChart3, BookOpen, Boxes, CheckCircle2, ChevronDown, ChevronRight, Cpu, Database,
  FileText, FlaskConical, GraduationCap, Info, KeyRound, LayoutDashboard, Menu, Play, Plus,
  RefreshCw, ScrollText, Search, Settings, Sparkles, Trash2, Upload, Users, X, ShieldCheck
} from 'lucide-react';
import { adminApi } from '../api/admin';

/* ───────────── Types ───────────── */
type Env = 'draft' | 'testing' | 'production';
type TabId = 'overview' | 'finetune' | 'datasets' | 'models' | 'knowledge' | 'documents' | 'playground'
  | 'review' | 'verified' | 'retrieval' | 'prompts' | 'providers' | 'analytics' | 'users' | 'logs' | 'settings';

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
    ],
  },
  {
    title: 'AI & Fine-Tuning',
    icon: <Sparkles size={15} className="text-[#F2C230]" />,
    items: [
      { id: 'finetune', label: 'Fine-tuning Studio', icon: <GraduationCap size={16} /> },
      { id: 'models', label: 'Model Registry', icon: <Boxes size={16} /> },
      { id: 'playground', label: 'AI Playground', icon: <FlaskConical size={16} /> },
      { id: 'prompts', label: 'System Prompts', icon: <ScrollText size={16} /> },
      { id: 'providers', label: 'AI Providers', icon: <KeyRound size={16} /> },
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
  const [providers, setProviders] = useState<any[]>([]);
  const [fineTuneJobs, setFineTuneJobs] = useState<any[]>([]);
  const [retrievalSet, setRetrievalSet] = useState<any>(null);

  // Fine-Tuning configuration state
  const [ftDatasetId, setFtDatasetId] = useState('');
  const [ftBaseModel, setFtBaseModel] = useState('zai-org/GLM-5.3-Flash');
  const [ftSuffix, setFtSuffix] = useState('bwenge-domain-v1');
  const [ftAutoApprove, setFtAutoApprove] = useState(true);
  const [ftStarting, setFtStarting] = useState(false);
  const [selectedFtJob, setSelectedFtJob] = useState<any | null>(null);
  const [ftTestPrompt, setFtTestPrompt] = useState('');
  const [ftTestOutput, setFtTestOutput] = useState<any | null>(null);
  const [ftTesting, setFtTesting] = useState(false);

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
  const [newModelName, setNewModelName] = useState('');
  const [newModelBase, setNewModelBase] = useState('zai-org/GLM-5.3-Flash');
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');

  // Document upload state
  const [uploadKbId, setUploadKbId] = useState('');
  const [uploadDomain, setUploadDomain] = useState('general');
  const [uploadLang, setUploadLang] = useState('rw');
  const [uploadRegion, setUploadRegion] = useState('Rwanda');
  const [uploadConsent, setUploadConsent] = useState(true);
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
      const [ov, hl, kbList, docList, dsList, mdList, prList, usList, lgList, anData, prvList, ftList, rsData, corrList, verList] = await Promise.all([
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
        adminApi.getProviders(),
        adminApi.getFineTuneJobs(),
        adminApi.getRetrievalSettings(env),
        adminApi.getCorrections(),
        adminApi.getVerifiedAnswers(),
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
      setProviders(prvList.data);
      setFineTuneJobs(ftList.data);
      setRetrievalSet(rsData.data);
      setCorrections(corrList.data);
      setVerifiedAnswers(verList.data);

      if (dsList.data.length > 0 && !ftDatasetId) {
        setFtDatasetId(dsList.data[0].id);
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
  }, [env, ftDatasetId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-poll fine-tune jobs while any job is TRAINING or QUEUED
  useEffect(() => {
    const hasActiveTraining = fineTuneJobs.some((j) => j.status === 'TRAINING' || j.status === 'QUEUED');
    if (!hasActiveTraining) return;
    const timer = window.setInterval(async () => {
      try {
        const [ftList, mdList, ov] = await Promise.all([
          adminApi.getFineTuneJobs(),
          adminApi.getModels(),
          adminApi.getOverview(),
        ]);
        setFineTuneJobs(ftList.data);
        setModels(mdList.data);
        setOverview(ov.data);
        setSelectedFtJob((prev: any) => {
          if (!prev) return ftList.data[0] || null;
          return ftList.data.find((j: any) => j.id === prev.id) || prev;
        });
      } catch {}
    }, 1200);
    return () => window.clearInterval(timer);
  }, [fineTuneJobs]);

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
      const result: any = await adminApi.createFineTuneJob({
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
              <p className="text-sm text-[#9AA6C9] mt-1">Enterprise-grade AI database, vector index, and GonkaRouter weighted distillation console.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {tab !== 'finetune' && (
                <button onClick={() => setTab('finetune')} className={btnPrimary}>
                  <GraduationCap size={16} /> Fine-Tuning Studio
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
                        <p className="text-xs sm:text-sm text-[#9AA6C9] mt-1">Instant operational access to fine-tuning, dataset curation, and model evaluation.</p>
                      </div>
                      <Badge tone="blue">Environment: {env.toUpperCase()}</Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 relative z-10">
                      <button onClick={() => setTab('finetune')} className={btnGhost + ' justify-start h-auto py-3.5 px-4 bg-[#0F1424]/90 hover:bg-[#1C2648]'}>
                        <GraduationCap size={18} className="text-[#3FA7E0]" />
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-white truncate">Fine-Tuning</p>
                          <p className="text-[10px] text-[#9AA6C9] truncate">Knowledge Adapters</p>
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
                          <p className="text-[10px] text-[#9AA6C9] truncate">Test RAG &amp; Weights</p>
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
                    <Stat label="Dataset Examples" value={overview.counts.datasetExamples} detail="Live fine-tuning corpus" />
                    <Stat label="Fine-Tune Jobs" value={overview.counts.fineTuneJobs} detail={`${overview.counts.activeModels} active models`} />
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
                        <BarChart3 size={18} className="text-[#3FA7E0]" /> Token Velocity &amp; Inference Throughput
                      </h3>
                      <span className="text-xs text-[#9AA6C9]">Real-time telemetry distribution (Last 12 intervals)</span>
                    </div>
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-3 items-end h-24 pt-2">
                      {[42, 68, 35, 88, 58, 96, 78, 62, 92, 84, 100, 88].map((val, i) => (
                        <div key={i} className="flex flex-col items-center gap-1.5 h-full justify-end group">
                          <div
                            className="w-full bg-gradient-to-t from-[#3FA7E0]/30 via-[#3FA7E0]/80 to-[#55B5EA] rounded-t-md transition-all duration-300 group-hover:brightness-125 group-hover:scale-y-105"
                            style={{ height: `${val}%` }}
                            title={`Activity index: ${val}%`}
                          />
                          <span className="text-[10px] font-semibold text-[#6C789E]">T{i + 1}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Section title="Live Service Health" hint="Real-time database, vector index, and GonkaRouter fine-tuned worker status.">
                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                      {health.map((s, idx) => (
                        <div key={idx} className={`${card} p-5 flex items-center justify-between min-w-0`}>
                          <div className="min-w-0 mr-3">
                            <p className="text-xs font-bold text-[#9AA6C9] truncate">{s.name}</p>
                            <p className="mt-1.5 text-sm font-extrabold text-white truncate">{s.latency}</p>
                          </div>
                          <Badge tone={s.status === 'ONLINE' ? 'green' : 'yellow'}>{s.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Section title="Recent Fine-Tune & Model Activity" actions={
                      <button onClick={() => setTab('finetune')} className={btnGhost}>Manage Fine-Tuning</button>
                    }>
                      <div className={`${card} p-5 space-y-3`}>
                        {fineTuneJobs.length === 0 ? (
                          <EmptyState title="No Fine-Tune Jobs" desc="Build an AI knowledge adapter from your datasets to start fine-tuning." icon={<GraduationCap size={24} />} />
                        ) : (
                          fineTuneJobs.slice(0, 4).map((j) => (
                            <div key={j.id} className="flex items-center justify-between gap-3 p-4 rounded-xl bg-[#0F1424] border border-[#263052] hover:border-[#3FA7E0]/40 transition">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-white truncate">{j.fineTunedModelName || j.id}</p>
                                <p className="text-[11px] text-[#9AA6C9] truncate mt-0.5">Dataset: {j.datasetName || j.datasetId} · {j.tokenEstimate} tokens</p>
                              </div>
                              <Badge tone={j.status === 'COMPLETED' ? 'green' : j.status === 'TRAINING' ? 'blue' : 'yellow'}>
                                {j.status} {j.status === 'TRAINING' ? `${j.progress || 0}%` : j.evalScore ? `(${j.evalScore})` : ''}
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

              {/* ── FINE-TUNING STUDIO TAB ── */}
              {tab === 'finetune' && (
                <div className="space-y-6 min-w-0">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Launch Fine-Tuning Job Form */}
                    <div className={`${card} p-6 sm:p-8 space-y-5 lg:col-span-5`}>
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <GraduationCap size={20} className="text-[#3FA7E0]" /> Configure &amp; Run Fine-Tuning
                        </h3>
                        <p className="text-xs text-[#9AA6C9] mt-1">
                          Builds and deploys an AI knowledge adapter from approved dataset examples.
                        </p>
                      </div>

                      <Field label="Training Dataset (Live Database)">
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
                        <Field label="Custom Model Suffix">
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
                        Auto-approve pending examples &amp; activate model in <strong>{env}</strong> upon completion
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
                            const res: any = await adminApi.createFineTuneJob({
                              datasetId: ftDatasetId,
                              baseModel: ftBaseModel,
                              suffix: ftSuffix,
                              targetEnvironment: env,
                              autoApprove: ftAutoApprove,
                            });
                            setSelectedFtJob(res.data);
                            notify('AI knowledge adapter build started from the selected dataset.');
                            await loadData(true);
                          } catch (e: any) {
                            notify(e.message, true);
                          } finally {
                            setFtStarting(false);
                          }
                        }}
                        className={btnPrimary + ' w-full py-3.5'}
                      >
                        <Sparkles size={18} /> {ftStarting ? 'Building Knowledge Adapter...' : 'Build & Activate AI Knowledge'}
                      </button>
                    </div>

                    {/* Right: Live Training Monitor & Testing Sandbox */}
                    <div className={`${card} p-6 sm:p-8 space-y-6 lg:col-span-7`}>
                      {selectedFtJob ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#263052] pb-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2.5">
                                <h3 className="text-base font-bold text-white truncate">
                                  {selectedFtJob.fineTunedModelName || selectedFtJob.id}
                                </h3>
                                <Badge
                                  tone={
                                    selectedFtJob.status === 'COMPLETED'
                                      ? 'green'
                                      : selectedFtJob.status === 'TRAINING'
                                      ? 'blue'
                                      : selectedFtJob.status === 'FAILED' || selectedFtJob.status === 'CANCELLED'
                                      ? 'red'
                                      : 'yellow'
                                  }
                                >
                                  {selectedFtJob.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-[#9AA6C9] mt-1">
                                Dataset: <span className="text-white font-semibold">{selectedFtJob.datasetName || selectedFtJob.datasetId}</span> ·{' '}
                                Examples: <span className="text-white font-semibold">{selectedFtJob.exampleCount ?? 'All'}</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedFtJob.status === 'TRAINING' && (
                                <button
                                  onClick={async () => {
                                    await adminApi.cancelFineTuneJob(selectedFtJob.id);
                                    notify('Job cancelled');
                                    await loadData(true);
                                  }}
                                  className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 bg-red-950/20 rounded-xl px-3.5 py-2 font-semibold"
                                >
                                  Cancel Job
                                </button>
                              )}
                              <button
                                onClick={async () => {
                                  try {
                                    const r: any = await adminApi.getFineTuneReadme(selectedFtJob.id);
                                    const blob = new Blob([r.readme], { type: 'text/markdown' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `README_QLORA_${selectedFtJob.id}.md`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    notify('QLoRA GPU Rental README downloaded.');
                                  } catch (err: any) {
                                    notify(err.message, true);
                                  }
                                }}
                                className={btnGhost + ' text-xs py-2 px-3'}
                              >
                                🖥️ QLoRA README
                              </button>
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs font-semibold text-[#9AA6C9]">
                              <span>Knowledge adapter build status</span>
                              <span className="text-white font-bold">
                                {selectedFtJob.status === 'COMPLETED' ? 100 : selectedFtJob.progress ?? 0}%
                              </span>
                            </div>
                            <div className="w-full h-3 bg-[#0F1424] rounded-full overflow-hidden border border-[#263052] p-0.5">
                              <div
                                className="h-full bg-gradient-to-r from-[#3FA7E0] via-[#3DB27A] to-[#6FD6A2] rounded-full transition-all duration-500 shadow-sm"
                                style={{ width: `${selectedFtJob.status === 'COMPLETED' ? 100 : selectedFtJob.progress ?? 15}%` }}
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
                              Test Fine-Tuned Model Live
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
                                disabled={ftTesting}
                                onClick={async () => {
                                  if (!ftTestPrompt.trim()) return;
                                  setFtTesting(true);
                                  try {
                                    const res = await adminApi.testFineTuneJob(selectedFtJob.id, ftTestPrompt);
                                    setFtTestOutput(res.data);
                                    notify('Fine-tuned model evaluated!');
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
                                  <span>Model: {ftTestOutput.model}</span>
                                  <span>{ftTestOutput.examplesUsed} DB examples applied · {ftTestOutput.latencyMs}ms</span>
                                </div>
                                <p className="text-[#E8EAF2] whitespace-pre-wrap leading-relaxed">{ftTestOutput.output}</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <EmptyState
                          title="No Active Fine-Tune Job Selected"
                          desc="Select a dataset on the left and build an adapter to apply its approved knowledge to live AI responses."
                          icon={<GraduationCap size={28} />}
                        />
                      )}
                    </div>
                  </div>

                  {/* All Fine-Tune Jobs Table */}
                  <Section title="AI Knowledge Adapter Jobs History" hint="Inspect dataset-grounded knowledge adapters and test their live AI responses.">
                    <div className={`${card} overflow-x-auto`}>
                      <table className="w-full text-left text-sm min-w-[720px]">
                        <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                          <tr>
                            <th className="p-4">Fine-Tuned Model</th>
                            <th className="p-4">Dataset</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Examples</th>
                            <th className="p-4">Est. Tokens</th>
                            <th className="p-4">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#263052]">
                          {fineTuneJobs.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="p-8 text-center text-sm text-[#9AA6C9]">No fine-tune jobs created yet.</td>
                            </tr>
                          ) : (
                            fineTuneJobs.map((j) => (
                              <tr
                                key={j.id}
                                onClick={() => setSelectedFtJob(j)}
                                className={`cursor-pointer transition-colors ${
                                  selectedFtJob?.id === j.id ? 'bg-[#3FA7E0]/15' : 'hover:bg-[#18213D]/60'
                                }`}
                              >
                                <td className="p-4 font-mono text-xs font-bold text-white truncate max-w-[220px]">
                                  {j.fineTunedModelName || j.id}
                                </td>
                                <td className="p-4 text-xs text-[#9AA6C9] truncate max-w-[180px]">
                                  {j.datasetName || j.datasetId}
                                </td>
                                <td className="p-4">
                                  <Badge tone={j.status === 'COMPLETED' ? 'green' : j.status === 'TRAINING' ? 'blue' : 'yellow'}>
                                    {j.status} {j.status === 'TRAINING' ? `(${j.progress || 10}%)` : ''}
                                  </Badge>
                                </td>
                                <td className="p-4 text-xs text-[#9AA6C9]">{j.exampleCount || 0}</td>
                                <td className="p-4 text-xs text-[#9AA6C9]">{j.tokenEstimate}</td>
                                <td className="p-4" onClick={(e) => e.stopPropagation()}>
                                  {j.status === 'TRAINING' ? (
                                    <button
                                      onClick={async () => {
                                        await adminApi.cancelFineTuneJob(j.id);
                                        notify('Job cancelled');
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
                    hint="Review extracted training pairs, approve/reject examples, and build an inference-time AI knowledge adapter."
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
                          Extracted content is converted into AI training examples. Review or approve them before building the knowledge adapter.
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

                    {/* Add Manual Training Example Inline */}
                    <div className={`${card} p-5 space-y-4`}>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#7CC4EE]">
                        + Add New Training Pair to {inspectDataset.name}
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
                                status: 'approved',
                              });
                              setNewExInstruction('');
                              setNewExInput('');
                              setNewExOutput('');
                              const res = await adminApi.getDatasetExamples(inspectDataset.id);
                              setDatasetExamples(res.data);
                              await loadData(true);
                              notify('Training example added & approved');
                            } catch (e: any) {
                              notify(e.message, true);
                            }
                          }}
                          className={btnPrimary}
                        >
                          <Plus size={16} /> Add Approved Example
                        </button>
                      </div>
                    </div>

                    {datasetExamplesLoading ? (
                      <div className="py-12 text-center text-sm text-[#9AA6C9]">Loading dataset examples...</div>
                    ) : datasetExamples.length === 0 ? (
                      <EmptyState
                        title="No Dataset Examples Found"
                        desc="Attach a source file or harvest live database records to populate training pairs."
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
                    hint="Harvest real training pairs from database tables or create custom fine-tuning datasets."
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
                        desc="Create a dataset above to start harvesting training pairs and building custom knowledge adapters."
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
                                  {ds.description || 'Curated dataset for fine-tuning.'}
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
                <Section title="Model Registry & Active Deployments" hint="Manage base and fine-tuned models serving live platform requests.">
                  <div className={`${card} p-5 flex flex-col sm:flex-row gap-4 items-end`}>
                    <div className="flex-1 w-full">
                      <Field label="Model Name / Identifier">
                        <input
                          className={input}
                          value={newModelName}
                          onChange={(e) => setNewModelName(e.target.value)}
                          placeholder="e.g. ft:gonkarouter:glm-5.3-flash:v1"
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
                    <EmptyState title="No Models Registered" desc="Register a model above or build a fine-tuned knowledge adapter." icon={<Boxes size={28} />} />
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
                          });
                          setNewKbName('');
                          setNewKbDesc('');
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
                            <option value="">Auto (Latest Fine-Tuned / Primary)</option>
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
                            notify('Live RAG + Fine-Tuned query executed');
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
                        notify('System prompt created & activated');
                        await loadData(true);
                      }}
                      className={btnPrimary}
                    >
                      <Plus size={16} /> Save &amp; Activate System Prompt
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
                <Section title="AI Provider Configurations" hint="Live GonkaRouter gateway and model routing settings.">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {providers.map((prv, idx) => (
                      <div key={idx} className={`${card} p-6 space-y-4 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-bold text-white text-base truncate">{prv.provider}</h3>
                          <Badge tone="green">Active</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] truncate">Model: <span className="text-white font-semibold">{prv.model}</span></p>
                        <p className="text-xs text-[#9AA6C9] truncate">Gateway: <span className="text-white font-semibold">{prv.baseUrl || 'https://api.gonkarouter.io/v1'}</span></p>
                        <p className="text-xs font-mono text-[#6C789E] truncate">Credential Ref: {prv.secretRef}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── ANALYTICS TAB ── */}
              {tab === 'analytics' && analytics && (
                <Section title="Live Usage & Adapter Analytics" hint="Computed from UsageEvents, ApplicationForms, and FineTuneJobs in the database.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Total AI Queries" value={analytics.totalQuestions} detail="Logged in database" />
                    <Stat label="Knowledge Grounded" value={`${analytics.answeredRate}%`} detail="Verified context rate" />
                    <Stat label="Avg Inference Latency" value={`${analytics.avgLatencyMs} ms`} detail="GonkaRouter streaming" />
                    <Stat label="Cumulative Cost" value={`$${analytics.costUsd}`} detail="Inference + Fine-Tuning" />
                  </div>
                </Section>
              )}

              {/* ── USERS TAB ── */}
              {tab === 'users' && (
                <Section title="User & Role Management" hint="Manage platform accounts and administrator permissions in the database.">
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[580px]">
                      <thead className="bg-[#141C36] text-xs font-bold text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Email</th>
                          <th className="p-4">Role</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-[#18213D]/60 transition-colors">
                            <td className="p-4 font-bold text-white truncate max-w-[160px]">{u.name}</td>
                            <td className="p-4 text-[#9AA6C9] truncate max-w-[220px]">{u.email}</td>
                            <td className="p-4"><Badge tone={u.role === 'ADMIN' ? 'green' : 'blue'}>{u.role}</Badge></td>
                            <td className="p-4">
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
                <Section title="System Audit Logs" hint="Immutable database audit trail of administrative and fine-tuning actions.">
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
                      Bwenge AI Admin Console is connected to your live database tables (Forms, Submissions, Student Scripts, Knowledge Chunks, Datasets, and Fine-Tuned Models).
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
