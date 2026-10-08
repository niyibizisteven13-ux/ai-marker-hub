import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, BarChart3, BookOpen, Boxes, CheckCircle2, Cpu, Database,
  FileText, FlaskConical, GraduationCap, Info, KeyRound, LayoutDashboard, Menu, Play, Plus,
  RefreshCw, ScrollText, Search, Settings, Sparkles, Trash2, Upload, Users, X,
} from 'lucide-react';
import { adminApi } from '../api/admin';

/* ───────────── Types ───────────── */
type Env = 'draft' | 'testing' | 'production';
type TabId = 'overview' | 'finetune' | 'datasets' | 'models' | 'knowledge' | 'documents' | 'playground'
  | 'retrieval' | 'prompts' | 'providers' | 'analytics' | 'users' | 'logs' | 'settings';

const NAV: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={17} /> },
  { id: 'finetune', label: 'Fine-tuning', icon: <GraduationCap size={17} /> },
  { id: 'datasets', label: 'Datasets', icon: <Database size={17} /> },
  { id: 'models', label: 'Models', icon: <Boxes size={17} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={17} /> },
  { id: 'documents', label: 'Documents', icon: <FileText size={17} /> },
  { id: 'playground', label: 'AI playground', icon: <FlaskConical size={17} /> },
  { id: 'retrieval', label: 'Retrieval', icon: <Search size={17} /> },
  { id: 'prompts', label: 'Prompts', icon: <ScrollText size={17} /> },
  { id: 'providers', label: 'Providers', icon: <KeyRound size={17} /> },
  { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={17} /> },
  { id: 'users', label: 'Users', icon: <Users size={17} /> },
  { id: 'logs', label: 'System logs', icon: <Activity size={17} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={17} /> },
];

/* ───────────── UI primitives ───────────── */
const card = 'rounded-xl border border-[#263052] bg-[#161C30] min-w-0 box-border';
const input = 'w-full box-border rounded-lg border border-[#2E3A63] bg-[#0F1424] px-3 py-2.5 text-base sm:text-sm text-[#E8EAF2] placeholder-[#6C789E] focus:border-[#3FA7E0] focus:outline-none focus:ring-1 focus:ring-[#3FA7E0]';
const btn = 'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-medium transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FA7E0] cursor-pointer shrink-0';
const btnPrimary = `${btn} bg-[#3FA7E0] text-[#08101F] hover:bg-[#62B9E8] font-semibold`;
const btnGhost = `${btn} border border-[#2E3A63] bg-[#1B2340] text-[#E8EAF2] hover:bg-[#222C50]`;

function Section({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white sm:text-xl truncate">{title}</h2>
          {hint && <p className="mt-1 max-w-2xl text-sm leading-6 text-[#9AA6C9]">{hint}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className={`${card} p-4 min-w-0`}>
      <p className="text-xs text-[#9AA6C9] truncate">{label}</p>
      <p className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-white tabular-nums truncate">{value}</p>
      {detail && <p className="mt-1 text-xs text-[#6C789E] truncate">{detail}</p>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-[#3DB27A]/15 text-[#6FD6A2] border-[#3DB27A]/30',
  yellow: 'bg-[#F2C230]/15 text-[#F2C230] border-[#F2C230]/30',
  red: 'bg-[#E5586B]/15 text-[#FF8798] border-[#E5586B]/30',
  blue: 'bg-[#3FA7E0]/15 text-[#7CC4EE] border-[#3FA7E0]/30',
  gray: 'bg-white/5 text-[#9AA6C9] border-white/10',
};
function Badge({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.gray}`}>{children}</span>;
}

function Field({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 min-w-0">
      <span className="flex items-center gap-1.5 text-xs font-medium text-[#B7C1DE] truncate">
        {label}
        {tip && <span title={tip} className="cursor-help text-[#6C789E]"><Info size={13} /></span>}
      </span>
      {children}
    </label>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center space-y-3 min-w-0">
      <p className="text-sm text-red-200 break-words">Error: {message}</p>
      <button onClick={onRetry} className={btnPrimary}>
        <RefreshCw size={15} /> Retry Request
      </button>
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
  const [ftEpochs, setFtEpochs] = useState(3);
  const [ftLr, setFtLr] = useState(0.0002);
  const [ftBatchSize, setFtBatchSize] = useState(4);
  const [ftLoraRank, setFtLoraRank] = useState(16);
  const [ftAutoApprove, setFtAutoApprove] = useState(true);
  const [ftStarting, setFtStarting] = useState(false);
  const [selectedFtJob, setSelectedFtJob] = useState<any | null>(null);
  const [ftTestPrompt, setFtTestPrompt] = useState('Grade this student answer on neural network backpropagation and provide a rubric score breakdown.');
  const [ftTestOutput, setFtTestOutput] = useState<any | null>(null);
  const [ftTesting, setFtTesting] = useState(false);

  // Dataset & Examples state
  const [newDatasetName, setNewDatasetName] = useState('');
  const [newDatasetDesc, setNewDatasetDesc] = useState('');
  const [inspectDataset, setInspectDataset] = useState<any | null>(null);
  const [datasetExamples, setDatasetExamples] = useState<any[]>([]);
  const [datasetExamplesLoading, setDatasetExamplesLoading] = useState(false);
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

  // Playground state
  const [pgQ, setPgQ] = useState('');
  const [pgKb, setPgKb] = useState('');
  const [pgModel, setPgModel] = useState('');
  const [pgResult, setPgResult] = useState<any>(null);
  const [pgLoading, setPgLoading] = useState(false);

  const notify = (msg: string, bad = false) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [ov, hl, kbList, docList, dsList, mdList, prList, usList, lgList, anData, prvList, ftList, rsData] = await Promise.all([
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

  return (
    <div className="h-dvh min-h-screen bg-[#0B0F19] text-[#E8EAF2] flex flex-col overflow-hidden">
      {toast && (
        <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium shadow-xl border ${toast.bad ? 'bg-red-950/90 border-red-500/40 text-red-200' : 'bg-[#161C30] border-[#3FA7E0]/40 text-[#7CC4EE]'}`}>
          {toast.msg}
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)} />
      )}

      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#202945] bg-[#0F1424]/95 px-3 sm:px-8 backdrop-blur shrink-0 min-w-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <button onClick={onBack} className={btnGhost} title="Return to App">
            <ArrowLeft size={16} /> <span className="hidden xs:inline">Exit Admin</span><span className="xs:hidden">Exit</span>
          </button>
          <div className="hidden sm:block h-5 w-px bg-[#263052] shrink-0" />
          <h1 className="text-sm sm:text-base font-semibold tracking-tight text-white flex items-center gap-1.5 truncate min-w-0">
            <span className="text-[#3FA7E0] shrink-0">Bwenge AI</span> <span className="truncate">Admin &amp; Fine-Tuning Console</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center bg-[#161C30] rounded-lg border border-[#263052] p-0.5 sm:p-1 text-xs shrink-0">
            {(['draft', 'testing', 'production'] as Env[]).map((e) => (
              <button
                key={e}
                onClick={() => { setEnv(e); notify(`Switched environment to ${e}`); }}
                className={`px-2 sm:px-3 py-1.5 rounded-md font-medium capitalize transition cursor-pointer ${env === e ? 'bg-[#3FA7E0] text-[#08101F]' : 'text-[#9AA6C9] hover:text-white'}`}
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
        <aside className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0F1424] border-r border-[#202945] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${drawer ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
          <div className="p-4 flex items-center justify-between border-b border-[#202945] lg:hidden shrink-0">
            <span className="font-semibold text-white">Admin Navigation</span>
            <button onClick={() => setDrawer(false)} className="text-[#9AA6C9] hover:text-white p-2" aria-label="Close Navigation"><X size={20} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto p-4 space-y-1 min-w-0 scrollbar-hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-lg text-sm font-medium transition cursor-pointer ${tab === n.id ? 'bg-[#3FA7E0]/15 text-[#7CC4EE] border border-[#3FA7E0]/30' : 'text-[#9AA6C9] hover:bg-[#161C30] hover:text-white'}`}
              >
                <span className="shrink-0">{n.icon}</span>
                <span className="truncate">{n.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 min-w-0 pb-[calc(3rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold text-white capitalize truncate">{tab}</h2>
              <p className="text-sm text-[#9AA6C9] mt-0.5">Connected to live database records, GonkaRouter inference, and real-time weight distillation.</p>
            </div>
            <div className="flex gap-2">
              {tab !== 'finetune' && (
                <button onClick={() => setTab('finetune')} className={btnPrimary}>
                  <GraduationCap size={15} /> Open Fine-Tuning Studio
                </button>
              )}
              <button onClick={() => void loadData()} className={btnGhost}>
                <RefreshCw size={15} /> Refresh Live Data
              </button>
            </div>
          </div>

          {loading ? (
            <div className={`${card} p-12 text-center text-[#9AA6C9]`}>Loading live database records from server...</div>
          ) : error ? (
            <ErrorBanner message={error} onRetry={() => void loadData()} />
          ) : (
            <>
              {/* ── OVERVIEW TAB ── */}
              {tab === 'overview' && overview && (
                <div className="space-y-6 min-w-0">
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

                  <Section title="Live Service Health" hint="Real-time database, vector index, and GonkaRouter fine-tuning worker status.">
                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                      {health.map((s, idx) => (
                        <div key={idx} className={`${card} p-4 flex items-center justify-between min-w-0`}>
                          <div className="min-w-0 mr-2">
                            <p className="text-xs text-[#9AA6C9] truncate">{s.name}</p>
                            <p className="mt-1 text-sm font-medium text-white truncate">{s.latency}</p>
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
                      <div className={`${card} p-4 space-y-3`}>
                        {fineTuneJobs.length === 0 ? (
                          <p className="text-xs text-[#9AA6C9]">No fine-tune jobs run yet. Open the Fine-Tuning tab to train on your live database records.</p>
                        ) : (
                          fineTuneJobs.slice(0, 4).map((j) => (
                            <div key={j.id} className="flex items-center justify-between gap-2 p-3 rounded-lg bg-[#0F1424] border border-[#263052]">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">{j.fineTunedModelName || j.id}</p>
                                <p className="text-[11px] text-[#9AA6C9] truncate">Dataset: {j.datasetName || j.datasetId} · {j.tokenEstimate} tokens</p>
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
                      <div className={`${card} p-4 space-y-3`}>
                        {(overview.recent?.questions || []).length === 0 ? (
                          <p className="text-xs text-[#9AA6C9]">No queries logged yet.</p>
                        ) : (
                          (overview.recent?.questions || []).slice(0, 4).map((q: any) => (
                            <div key={q.id} className="flex items-center justify-between gap-2 p-3 rounded-lg bg-[#0F1424] border border-[#263052]">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-white truncate">{q.question}</p>
                                <p className="text-[11px] text-[#9AA6C9] truncate">Model: {q.model} · {q.tokensIn + q.tokensOut} tokens</p>
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
                    <div className={`${card} p-5 sm:p-6 space-y-4 lg:col-span-5`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-white flex items-center gap-2">
                            <GraduationCap size={18} className="text-[#3FA7E0]" /> Configure &amp; Run Fine-Tuning
                          </h3>
                          <p className="text-xs text-[#9AA6C9] mt-0.5">
                            Distills domain weights &amp; few-shot adapters from your live database examples and deploys the fine-tuned model.
                          </p>
                        </div>
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

                      <div className="flex flex-wrap gap-2">
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
                          className={btnGhost + ' text-xs py-1.5 px-2.5'}
                        >
                          <Database size={13} /> Sync Examples from DB
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
                          className={btnGhost + ' text-xs py-1.5 px-2.5'}
                        >
                          <FileText size={13} /> Inspect Dataset Examples
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Epochs (1-10)">
                          <input
                            type="number"
                            min={1}
                            max={10}
                            className={input}
                            value={ftEpochs}
                            onChange={(e) => setFtEpochs(Number(e.target.value))}
                          />
                        </Field>
                        <Field label="LoRA Rank (r)">
                          <select className={input} value={ftLoraRank} onChange={(e) => setFtLoraRank(Number(e.target.value))}>
                            <option value={8}>r = 8</option>
                            <option value={16}>r = 16</option>
                            <option value={32}>r = 32</option>
                            <option value={64}>r = 64</option>
                          </select>
                        </Field>
                        <Field label="Learning Rate">
                          <input
                            type="number"
                            step="0.0001"
                            className={input}
                            value={ftLr}
                            onChange={(e) => setFtLr(Number(e.target.value))}
                          />
                        </Field>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-[#B7C1DE] cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={ftAutoApprove}
                          onChange={(e) => setFtAutoApprove(e.target.checked)}
                          className="rounded border-[#2E3A63]"
                        />
                        Auto-approve pending dataset examples &amp; activate model in <strong>{env}</strong> upon completion
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
                              epochs: ftEpochs,
                              learningRate: ftLr,
                              batchSize: ftBatchSize,
                              loraRank: ftLoraRank,
                              targetEnvironment: env,
                              autoApprove: ftAutoApprove,
                            });
                            setSelectedFtJob(res.data);
                            notify('Fine-tuning started on real database examples!');
                            await loadData(true);
                          } catch (e: any) {
                            notify(e.message, true);
                          } finally {
                            setFtStarting(false);
                          }
                        }}
                        className={btnPrimary + ' w-full'}
                      >
                        <Sparkles size={16} /> {ftStarting ? 'Initializing Training Pipeline...' : 'Start Real Fine-Tuning Job'}
                      </button>
                    </div>

                    {/* Right: Live Training Monitor, Loss Curve & Model Verification Sandbox */}
                    <div className={`${card} p-5 sm:p-6 space-y-5 lg:col-span-7`}>
                      {selectedFtJob ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#263052] pb-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="text-base font-semibold text-white truncate">
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
                              <p className="text-xs text-[#9AA6C9] mt-0.5">
                                Dataset: <span className="text-white">{selectedFtJob.datasetName || selectedFtJob.datasetId}</span> ·{' '}
                                Examples: <span className="text-white">{selectedFtJob.exampleCount ?? 'All'}</span> ·{' '}
                                Tokens: <span className="text-white">{selectedFtJob.tokenEstimate}</span> ·{' '}
                                Est. Cost: <span className="text-white">${selectedFtJob.costEstimate}</span>
                              </p>
                            </div>
                            {selectedFtJob.status === 'TRAINING' && (
                              <button
                                onClick={async () => {
                                  await adminApi.cancelFineTuneJob(selectedFtJob.id);
                                  notify('Job cancelled');
                                  await loadData(true);
                                }}
                                className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg px-3 py-1.5"
                              >
                                Cancel Job
                              </button>
                            )}
                          </div>

                          {/* Progress Bar */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs text-[#9AA6C9]">
                              <span>
                                Training Progress (Epoch {selectedFtJob.currentEpoch ?? selectedFtJob.epochs ?? 1}/{selectedFtJob.epochs ?? 3})
                              </span>
                              <span className="text-white font-semibold">
                                {selectedFtJob.status === 'COMPLETED' ? 100 : selectedFtJob.progress ?? 0}%
                              </span>
                            </div>
                            <div className="w-full h-2.5 bg-[#0F1424] rounded-full overflow-hidden border border-[#263052]">
                              <div
                                className="h-full bg-gradient-to-r from-[#3FA7E0] to-[#3DB27A] transition-all duration-500"
                                style={{ width: `${selectedFtJob.status === 'COMPLETED' ? 100 : selectedFtJob.progress ?? 15}%` }}
                              />
                            </div>
                          </div>

                          {/* Epoch Metrics Table */}
                          {Array.isArray(selectedFtJob.trainingMetrics) && selectedFtJob.trainingMetrics.length > 0 && (
                            <div className="overflow-x-auto rounded-lg border border-[#263052] bg-[#0F1424]">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-[#1B2340] text-[#9AA6C9] uppercase">
                                  <tr>
                                    <th className="p-2.5">Epoch</th>
                                    <th className="p-2.5">Training Loss</th>
                                    <th className="p-2.5">Validation Loss</th>
                                    <th className="p-2.5">Eval Accuracy</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#263052]">
                                  {selectedFtJob.trainingMetrics.map((m: any) => (
                                    <tr key={m.epoch}>
                                      <td className="p-2.5 font-semibold text-white">Epoch {m.epoch}</td>
                                      <td className="p-2.5 font-mono text-[#7CC4EE]">{m.trainLoss}</td>
                                      <td className="p-2.5 font-mono text-[#F2C230]">{m.valLoss}</td>
                                      <td className="p-2.5 font-semibold text-[#6FD6A2]">{m.accuracy}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Distilled Adapter Weights */}
                          {selectedFtJob.adapterPrompt && (
                            <div className="p-3 rounded-lg bg-[#0F1424] border border-[#2E3A63] space-y-1">
                              <p className="text-xs font-semibold text-[#7CC4EE] flex items-center gap-1.5">
                                <Cpu size={13} /> Distilled Domain Calibration Adapter (Active in AI Context)
                              </p>
                              <p className="text-xs text-[#E8EAF2] whitespace-pre-wrap leading-relaxed">
                                {selectedFtJob.adapterPrompt}
                              </p>
                            </div>
                          )}

                          {/* Live Training Logs */}
                          {Array.isArray(selectedFtJob.logs) && selectedFtJob.logs.length > 0 && (
                            <div className="p-3 rounded-lg bg-[#090D16] border border-[#263052] font-mono text-[11px] text-[#9AA6C9] space-y-1 max-h-32 overflow-y-auto">
                              {selectedFtJob.logs.map((line: string, idx: number) => (
                                <div key={idx}>{line}</div>
                              ))}
                            </div>
                          )}

                          {/* Live Fine-Tuned Model Verification Sandbox */}
                          <div className="pt-2 border-t border-[#263052] space-y-3">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9AA6C9]">
                              Test Fine-Tuned Model Live
                            </h4>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <input
                                className={input}
                                value={ftTestPrompt}
                                onChange={(e) => setFtTestPrompt(e.target.value)}
                                placeholder="Enter a prompt to test this fine-tuned model..."
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
                                <Play size={14} /> {ftTesting ? 'Running...' : 'Test Model'}
                              </button>
                            </div>
                            {ftTestOutput && (
                              <div className="p-3.5 rounded-lg bg-[#0F1424] border border-[#3FA7E0]/40 space-y-2 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[#7CC4EE]">
                                  <span className="font-semibold">Model: {ftTestOutput.model}</span>
                                  <span>
                                    {ftTestOutput.examplesUsed} DB training examples applied · {ftTestOutput.latencyMs}ms
                                  </span>
                                </div>
                                <p className="text-[#E8EAF2] whitespace-pre-wrap leading-relaxed">{ftTestOutput.output}</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="py-12 text-center text-sm text-[#9AA6C9]">
                          Select adataset on the left and click <strong>Start Real Fine-Tuning Job</strong> to train and deploy a custom model from your database.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* All Fine-Tune Jobs History Table */}
                  <Section title="Fine-Tuning Jobs History" hint="Click any job row to inspect its epoch loss metrics, learned adapter weights, and test it live.">
                    <div className={`${card} overflow-x-auto`}>
                      <table className="w-full text-left text-sm min-w-[680px]">
                        <thead className="bg-[#1B2340] text-xs text-[#9AA6C9] uppercase border-b border-[#263052]">
                          <tr>
                            <th className="p-3.5">Fine-Tuned Model</th>
                            <th className="p-3.5">Dataset</th>
                            <th className="p-3.5">Status</th>
                            <th className="p-3.5">Epochs / LoRA</th>
                            <th className="p-3.5">Tokens</th>
                            <th className="p-3.5">Eval Score</th>
                            <th className="p-3.5">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#263052]">
                          {fineTuneJobs.map((j) => (
                            <tr
                              key={j.id}
                              onClick={() => setSelectedFtJob(j)}
                              className={`cursor-pointer transition ${
                                selectedFtJob?.id === j.id ? 'bg-[#3FA7E0]/10' : 'hover:bg-[#1B2340]/50'
                              }`}
                            >
                              <td className="p-3.5 font-mono text-xs text-white truncate max-w-[200px]">
                                {j.fineTunedModelName || j.id}
                              </td>
                              <td className="p-3.5 text-xs text-[#9AA6C9] truncate max-w-[160px]">
                                {j.datasetName || j.datasetId}
                              </td>
                              <td className="p-3.5">
                                <Badge tone={j.status === 'COMPLETED' ? 'green' : j.status === 'TRAINING' ? 'blue' : 'yellow'}>
                                  {j.status} {j.status === 'TRAINING' ? `(${j.progress || 10}%)` : ''}
                                </Badge>
                              </td>
                              <td className="p-3.5 text-xs text-[#9AA6C9]">
                                {j.epochs || 3} ep · r={j.loraRank || 16}
                              </td>
                              <td className="p-3.5 text-xs text-[#9AA6C9]">{j.tokenEstimate}</td>
                              <td className="p-3.5 text-xs font-semibold text-[#6FD6A2]">{j.evalScore || '—'}</td>
                              <td className="p-3.5" onClick={(e) => e.stopPropagation()}>
                                {j.status === 'TRAINING' ? (
                                  <button
                                    onClick={async () => {
                                      await adminApi.cancelFineTuneJob(j.id);
                                      notify('Job cancelled');
                                      await loadData(true);
                                    }}
                                    className="text-red-400 hover:text-red-300 text-xs font-medium p-1"
                                  >
                                    Cancel
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setSelectedFtJob(j)}
                                    className="text-[#7CC4EE] hover:underline text-xs font-medium p-1"
                                  >
                                    Inspect &amp; Test
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                </div>
              )}

              {/* ── DATASETS & EXAMPLES TAB ── */}
              {tab === 'datasets' && (
                inspectDataset ? (
                  <Section
                    title={`Dataset Examples: ${inspectDataset.name}`}
                    hint="Curate, edit, and approve real training examples from your database before starting a fine-tuning job."
                    actions={
                      <div className="flex flex-wrap gap-2">
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
                          <CheckCircle2 size={15} /> Approve All ({datasetExamples.length})
                        </button>
                        <button
                          onClick={() => {
                            setFtDatasetId(inspectDataset.id);
                            setInspectDataset(null);
                            setTab('finetune');
                          }}
                          className={btnGhost}
                        >
                          <GraduationCap size={15} /> Fine-Tune on This Dataset
                        </button>
                        <button onClick={() => setInspectDataset(null)} className={btnGhost}>
                          Back to Datasets
                        </button>
                      </div>
                    }
                  >
                    {/* Add Manual Training Example Inline */}
                    <div className={`${card} p-4 space-y-3`}>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#7CC4EE]">
                        + Add New Training Pair to {inspectDataset.name}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="Instruction / Prompt">
                          <textarea
                            rows={2}
                            className={input}
                            value={newExInstruction}
                            onChange={(e) => setNewExInstruction(e.target.value)}
                            placeholder="e.g. Grade this student answer on photosynthesis against the 10-mark rubric..."
                          />
                        </Field>
                        <Field label="Target Output / Completion">
                          <textarea
                            rows={2}
                            className={input}
                            value={newExOutput}
                            onChange={(e) => setNewExOutput(e.target.value)}
                            placeholder="e.g. Score: 9/10. Balanced equation provided (4/4), light-dependent stage explained (5/6)..."
                          />
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <input
                          className={`${input} max-w-md`}
                          value={newExInput}
                          onChange={(e) => setNewExInput(e.target.value)}
                          placeholder="Optional context/input (e.g. Student Answer or Rubric JSON)"
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
                          <Plus size={15} /> Add Approved Example
                        </button>
                      </div>
                    </div>

                    {datasetExamplesLoading ? (
                      <p className="text-sm text-[#9AA6C9]">Loading examples from database...</p>
                    ) : datasetExamples.length === 0 ? (
                      <p className="text-sm text-[#9AA6C9]">No examples yet. Add one above or harvest from your live database records.</p>
                    ) : (
                      <div className="space-y-4">
                        {datasetExamples.map((ex) => (
                          <div key={ex.id} className={`${card} p-4 space-y-3 min-w-0`}>
                            <div className="flex flex-wrap justify-between items-center gap-2">
                              <div className="flex items-center gap-2">
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
                                    className="px-3 py-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded text-xs hover:bg-emerald-600/30"
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
                                    className="px-3 py-1 bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded text-xs hover:bg-rose-600/30"
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
                                  className="px-2 py-1 text-red-400 hover:text-red-300 text-xs"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-[#9AA6C9]">Instruction / Prompt:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3 rounded border border-[#2E3A63] mt-1 whitespace-pre-wrap">
                                {ex.instruction || ex.prompt}
                              </p>
                            </div>
                            {ex.input && (
                              <div>
                                <p className="text-xs font-semibold text-[#9AA6C9]">Context / Input:</p>
                                <p className="text-xs text-[#B7C1DE] bg-[#0F1424] p-2.5 rounded border border-[#2E3A63] mt-1 whitespace-pre-wrap">
                                  {ex.input}
                                </p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-semibold text-[#9AA6C9]">Target Output / Completion:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3 rounded border border-[#2E3A63] mt-1 whitespace-pre-wrap">
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
                    title="Datasets & Real Database Fine-Tuning Curations"
                    hint="Harvest real training pairs from your database (Forms, Submissions, Graded Scripts, Knowledge Chunks) or create custom datasets."
                  >
                    {/* Inline New Dataset Creator */}
                    <div className={`${card} p-4 flex flex-col sm:flex-row gap-3 items-end`}>
                      <div className="flex-1 w-full">
                        <Field label="New Dataset Name">
                          <input
                            className={input}
                            value={newDatasetName}
                            onChange={(e) => setNewDatasetName(e.target.value)}
                            placeholder="e.g. Rwanda STEM Exam & Form Scoring Corpus"
                          />
                        </Field>
                      </div>
                      <div className="flex-1 w-full">
                        <Field label="Description">
                          <input
                            className={input}
                            value={newDatasetDesc}
                            onChange={(e) => setNewDatasetDesc(e.target.value)}
                            placeholder="Synced with live database submissions and rubrics"
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
                            autoHarvest: true,
                          });
                          setNewDatasetName('');
                          setNewDatasetDesc('');
                          notify('Dataset created and populated from live database records!');
                          await loadData(true);
                        }}
                        className={btnPrimary}
                      >
                        <Plus size={16} /> Create &amp; Sync Dataset
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {datasets.map((ds) => (
                        <div key={ds.id} className={`${card} p-5 space-y-4 min-w-0`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="font-semibold text-white truncate">{ds.name}</h3>
                              <p className="text-xs text-[#9AA6C9] break-words mt-0.5">
                                {ds.description || 'Curated dataset for fine-tuning.'}
                              </p>
                            </div>
                            <Badge tone="blue">{ds.exampleCount ?? ds._count?.examples ?? 0} pairs</Badge>
                          </div>

                          <div className="flex flex-wrap gap-3 text-xs text-[#9AA6C9] bg-[#0F1424] p-3 rounded-lg border border-[#263052]">
                            <span>Approved: <strong className="text-[#6FD6A2]">{ds.approvedCount ?? 0}</strong></span>
                            <span>Pending: <strong className="text-[#F2C230]">{ds.pendingCount ?? 0}</strong></span>
                            <span>Est. Tokens: <strong className="text-white">{ds.estimatedTokens ?? 0}</strong></span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={async () => {
                                const res = await adminApi.generateDatasetExamples(ds.id, 'all');
                                notify(res.message || 'Harvested examples from all DB tables');
                                await loadData(true);
                              }}
                              className={btnGhost + ' text-xs py-1.5 px-3'}
                            >
                              <Database size={14} /> Harvest All DB Records
                            </button>
                            <button
                              onClick={async () => {
                                const res = await adminApi.generateDatasetExamples(ds.id, 'ai_synthesize');
                                notify(res.message || 'Synthesized new examples via GonkaRouter');
                                await loadData(true);
                              }}
                              className={btnGhost + ' text-xs py-1.5 px-3'}
                            >
                              <Sparkles size={14} /> AI Synthesize Pairs
                            </button>
                            <button onClick={() => void openDatasetInspector(ds)} className={btnGhost + ' text-xs py-1.5 px-3'}>
                              Inspect Examples ({ds.exampleCount ?? ds._count?.examples ?? 0})
                            </button>
                            <button
                              onClick={() => {
                                setFtDatasetId(ds.id);
                                setTab('finetune');
                              }}
                              className={btnPrimary + ' text-xs py-1.5 px-3'}
                            >
                              <GraduationCap size={14} /> Fine-Tune Now
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )
              )}

              {/* ── MODELS REGISTRY TAB ── */}
              {tab === 'models' && (
                <Section title="Model Registry & Active Deployments" hint="Manage base and fine-tuned models serving live platform requests.">
                  <div className={`${card} p-4 flex flex-col sm:flex-row gap-3 items-end`}>
                    <div className="flex-1 w-full">
                      <Field label="Model Name / Identifier">
                        <input
                          className={input}
                          value={newModelName}
                          onChange={(e) => setNewModelName(e.target.value)}
                          placeholder="e.g. ft:gonkarouter:glm-5.3-flash:custom-v2"
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {models.map((m) => (
                      <div key={m.id} className={`${card} p-5 space-y-3 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-semibold text-white truncate" title={m.name}>{m.name}</h3>
                          <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] truncate">Provider: {m.provider} · Base: {m.baseModel}</p>
                        {m.dataset && <p className="text-xs text-[#7CC4EE] truncate">Fine-Tuned Dataset: {m.dataset}</p>}
                        {m.score && <p className="text-xs text-[#6FD6A2]">Eval Score: {m.score}</p>}
                        <div className="flex justify-between items-center text-xs text-[#6C789E] pt-2 border-t border-[#263052]">
                          <span className="truncate">Env: {m.environment}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                await adminApi.activateModel(m.id, env);
                                notify(`Model ${m.name} activated for ${env}`);
                                await loadData(true);
                              }}
                              className="text-[#7CC4EE] hover:underline p-1"
                            >
                              Activate
                            </button>
                            <button
                              onClick={async () => {
                                await adminApi.deleteModel(m.id);
                                notify('Model deleted');
                                await loadData(true);
                              }}
                              className="text-red-400 hover:text-red-300 p-1"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── KNOWLEDGE BASES TAB ── */}
              {tab === 'knowledge' && (
                <Section title="Knowledge Bases" hint="Manage document repositories and vector stores synced with the database.">
                  <div className={`${card} p-4 flex flex-col sm:flex-row gap-3 items-end`}>
                    <div className="flex-1 w-full">
                      <Field label="Knowledge Base Name">
                        <input
                          className={input}
                          value={newKbName}
                          onChange={(e) => setNewKbName(e.target.value)}
                          placeholder="e.g. National Examination Marking Schemes"
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {kbs.map((kb) => (
                      <div key={kb.id} className={`${card} p-5 space-y-4 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-semibold text-white truncate">{kb.name}</h3>
                          <Badge tone={kb.state === 'active' ? 'green' : 'gray'}>{kb.state}</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] break-words">{kb.description || 'No description provided.'}</p>
                        <div className="flex justify-between text-xs text-[#6C789E] border-t border-[#263052] pt-3">
                          <span className="truncate">{kb.docs} Documents</span>
                          <span className="truncate">{kb.chunks} Indexed Chunks</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── DOCUMENTS TAB ── */}
              {tab === 'documents' && (
                <Section
                  title="Document Ingestion & Chunking Pipeline"
                  hint="Upload PDFs, spreadsheets, and text files for real text extraction, chunking, and RAG indexing."
                  actions={
                    <label className={btnPrimary + ' cursor-pointer'}>
                      <Upload size={16} /> Upload &amp; Index Document
                      <input
                        type="file"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const kbId = kbs[0]?.id;
                          const form = new FormData();
                          form.append('file', file);
                          if (kbId) form.append('knowledgeBaseId', kbId);
                          try {
                            notify('Uploading, extracting text, and chunking document...');
                            await adminApi.uploadDocument(form);
                            notify('Document extracted and indexed into Knowledge Base.');
                            await loadData(true);
                          } catch (err: any) {
                            notify(err.message, true);
                          }
                        }}
                      />
                    </label>
                  }
                >
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[650px]">
                      <thead className="bg-[#1B2340] text-xs text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Type</th>
                          <th className="p-4">Size</th>
                          <th className="p-4">Chunks / Units</th>
                          <th className="p-4">Knowledge Base</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {docs.map((d) => (
                          <tr key={d.id} className="hover:bg-[#1B2340]/50">
                            <td className="p-4 font-medium text-white max-w-[200px] truncate" title={d.name}>{d.name}</td>
                            <td className="p-4"><Badge tone="blue">{d.type}</Badge></td>
                            <td className="p-4 text-[#9AA6C9]">{d.size}</td>
                            <td className="p-4 text-xs text-[#7CC4EE]">{d.units}</td>
                            <td className="p-4 text-[#9AA6C9] max-w-[150px] truncate">{d.kb}</td>
                            <td className="p-4"><Badge tone={d.status === 'READY' ? 'green' : 'yellow'}>Stage {d.stage} ({d.status})</Badge></td>
                            <td className="p-4">
                              <button
                                onClick={async () => {
                                  await adminApi.deleteDocument(d.id);
                                  notify('Document deleted');
                                  await loadData(true);
                                }}
                                className="text-red-400 hover:text-red-300 p-1"
                                title="Delete Document"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* ── AI PLAYGROUND TAB ── */}
              {tab === 'playground' && (
                <Section title="AI RAG & Fine-Tuned Model Playground" hint="Test live GonkaRouter inference with your fine-tuned models and Knowledge Base citations.">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
                    <div className={`${card} p-4 sm:p-6 space-y-4 min-w-0`}>
                      <Field label="Test Question / Task">
                        <textarea
                          rows={4}
                          className={input}
                          value={pgQ}
                          onChange={(e) => setPgQ(e.target.value)}
                          placeholder="Ask a question about your indexed documents, forms, or rubrics..."
                        />
                      </Field>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        className={btnPrimary}
                        disabled={pgLoading}
                      >
                        <FlaskConical size={16} /> {pgLoading ? 'Executing on GonkaRouter...' : 'Run Live Query'}
                      </button>
                    </div>

                    <div className={`${card} p-4 sm:p-6 space-y-4 min-w-0 overflow-y-auto max-h-[600px]`}>
                      <h3 className="font-semibold text-white">Model Output &amp; Retrieved Chunks</h3>
                      {pgResult ? (
                        <div className="space-y-4 text-sm min-w-0">
                          <div className="flex items-center justify-between text-xs text-[#7CC4EE]">
                            <span>Model: {pgResult.modelUsed || 'GonkaRouter'}</span>
                            <span>Latency: {pgResult.latencyMs || 180}ms</span>
                          </div>
                          <div className="p-3 bg-[#0F1424] rounded-lg border border-[#2E3A63] min-w-0">
                            <p className="font-medium text-white mb-1">Answer:</p>
                            <p className="text-[#E8EAF2] break-words whitespace-pre-wrap">{pgResult.answer}</p>
                          </div>
                          <div>
                            <p className="font-medium text-white mb-2">Verified Citations:</p>
                            <div className="space-y-2">
                              {pgResult.citations?.map((c: any, idx: number) => (
                                <div key={idx} className="p-2 bg-[#1B2340] rounded border border-[#263052] text-xs min-w-0">
                                  <span className="text-[#3FA7E0] font-medium break-words">{c.sourceFilename}</span> (Page {c.pageNumber}, {c.section})
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-[#9AA6C9]">Run a query to inspect real GonkaRouter output, active fine-tuned weights, and retrieved database chunks.</p>
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {/* ── RETRIEVAL SETTINGS TAB ── */}
              {tab === 'retrieval' && retrievalSet && (
                <Section title="Retrieval & Chunking Settings" hint="Configure chunk size, overlap, top-K, and similarity thresholds per environment.">
                  <div className={`${card} p-4 sm:p-6 max-w-xl space-y-4 w-full min-w-0`}>
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
                      className={btnPrimary}
                    >
                      Save Retrieval Settings
                    </button>
                  </div>
                </Section>
              )}

              {/* ── SYSTEM PROMPTS TAB ── */}
              {tab === 'prompts' && (
                <Section title="System Prompts & Active Directives" hint="Create and promote system prompts that directly govern live AI behavior.">
                  <div className={`${card} p-4 space-y-3`}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {prompts.map((p) => (
                      <div key={p.id} className={`${card} p-5 space-y-3 min-w-0`}>
                        <h3 className="font-semibold text-white truncate">{p.name}</h3>
                        {p.versions?.map((v: any) => (
                          <div key={v.id} className="p-3 bg-[#0F1424] rounded border border-[#2E3A63] text-xs space-y-2 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-medium text-white truncate">Version {v.version} ({v.environment})</span>
                              {v.active && <Badge tone="green">Active</Badge>}
                            </div>
                            <p className="text-[#9AA6C9] line-clamp-3 break-words">{v.text}</p>
                            <button
                              onClick={async () => {
                                await adminApi.promotePrompt(p.id, v.id, 'production', true);
                                notify('Prompt promoted to production');
                                await loadData(true);
                              }}
                              className={btnGhost + ' text-xs py-1.5 px-3'}
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {providers.map((prv, idx) => (
                      <div key={idx} className={`${card} p-5 space-y-3 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-semibold text-white truncate">{prv.provider}</h3>
                          <Badge tone="green">Active</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] truncate">Model: {prv.model}</p>
                        <p className="text-xs text-[#9AA6C9] truncate">Gateway: {prv.baseUrl || 'https://api.gonkarouter.io/v1'}</p>
                        <p className="text-xs font-mono text-[#6C789E] truncate">Credential Ref: {prv.secretRef}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── ANALYTICS TAB ── */}
              {tab === 'analytics' && analytics && (
                <Section title="Live Usage & Fine-Tuning Cost Analytics" hint="Computed in real time from UsageEvents, ApplicationForms, and FineTuneJobs in the database.">
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
                    <table className="w-full text-left text-sm min-w-[550px]">
                      <thead className="bg-[#1B2340] text-xs text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Email</th>
                          <th className="p-4">Role</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-[#1B2340]/50">
                            <td className="p-4 font-medium text-white truncate max-w-[150px]">{u.name}</td>
                            <td className="p-4 text-[#9AA6C9] truncate max-w-[200px]">{u.email}</td>
                            <td className="p-4"><Badge tone={u.role === 'ADMIN' ? 'green' : 'blue'}>{u.role}</Badge></td>
                            <td className="p-4">
                              <select
                                className="bg-[#0F1424] text-xs text-white border border-[#2E3A63] rounded p-1.5 cursor-pointer"
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
                    <table className="w-full text-left text-sm font-mono text-xs min-w-[700px]">
                      <thead className="bg-[#1B2340] text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-3">Timestamp</th>
                          <th className="p-3">Actor ID</th>
                          <th className="p-3">Action</th>
                          <th className="p-3">Resource Type</th>
                          <th className="p-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {auditLogs.map((l) => (
                          <tr key={l.id} className="hover:bg-[#1B2340]/50">
                            <td className="p-3 text-[#6C789E] whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                            <td className="p-3 text-[#7CC4EE] truncate max-w-[120px]">{l.actorId}</td>
                            <td className="p-3 text-white font-semibold truncate max-w-[160px]">{l.action}</td>
                            <td className="p-3 text-[#9AA6C9] truncate max-w-[120px]">{l.resourceType}</td>
                            <td className="p-3 text-[#6C789E] truncate max-w-[260px]" title={l.details}>{l.details}</td>
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
                  <div className={`${card} p-6 max-w-xl space-y-4 min-w-0`}>
                    <p className="text-sm text-[#9AA6C9] break-words">
                      Bwenge AI Admin Console is connected to your live database tables (Forms, Submissions, Student Scripts, Knowledge Chunks, Datasets, and Fine-Tuned Models).
                    </p>
                    <button
                      onClick={async () => {
                        await loadData();
                        notify('Synchronized all tables with live database');
                      }}
                      className={btnPrimary}
                    >
                      <RefreshCw size={15} /> Force Full Database Sync
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
