import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, BarChart3, BookOpen, Boxes, Database,
  FileText, FlaskConical, GraduationCap, Info, KeyRound, LayoutDashboard, Menu, Plus,
  RefreshCw, ScrollText, Search, Settings, Trash2, Upload, Users, X,
} from 'lucide-react';
import { adminApi } from '../api/admin';

/* ───────────── Types ───────────── */
type Env = 'draft' | 'testing' | 'production';
type TabId = 'overview' | 'knowledge' | 'documents' | 'datasets' | 'playground' | 'models' | 'finetune'
  | 'retrieval' | 'prompts' | 'providers' | 'analytics' | 'users' | 'logs' | 'settings';

const NAV: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={17} /> },
  { id: 'knowledge', label: 'Knowledge', icon: <BookOpen size={17} /> },
  { id: 'documents', label: 'Documents', icon: <FileText size={17} /> },
  { id: 'datasets', label: 'Datasets', icon: <Database size={17} /> },
  { id: 'playground', label: 'AI playground', icon: <FlaskConical size={17} /> },
  { id: 'models', label: 'Models', icon: <Boxes size={17} /> },
  { id: 'finetune', label: 'Fine-tuning', icon: <GraduationCap size={17} /> },
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
const btn = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FA7E0] cursor-pointer shrink-0';
const btnPrimary = `${btn} bg-[#3FA7E0] text-[#08101F] hover:bg-[#62B9E8]`;
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

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
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
  return <span className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
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
  const [env, setEnv] = useState<Env>('draft');
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

  // Playground state
  const [pgQ, setPgQ] = useState('');
  const [pgKb, setPgKb] = useState('');
  const [pgResult, setPgResult] = useState<any>(null);
  const [pgLoading, setPgLoading] = useState(false);

  // Dataset inspection & approval state
  const [inspectDataset, setInspectDataset] = useState<any | null>(null);
  const [datasetExamples, setDatasetExamples] = useState<any[]>([]);
  const [datasetExamplesLoading, setDatasetExamplesLoading] = useState(false);

  const notify = (msg: string, bad = false) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
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
    } catch (err: any) {
      setError(err.message || 'Failed to connect to backend server.');
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const go = (id: TabId) => { setTab(id); setDrawer(false); };

  return (
    <div className="h-dvh min-h-screen bg-[#0B0F19] text-[#E8EAF2] flex flex-col overflow-hidden">
      {toast && (
        <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium shadow-xl border ${toast.bad ? 'bg-red-950/90 border-red-500/40 text-red-200' : 'bg-[#161C30] border-[#3FA7E0]/40 text-[#7CC4EE]'}`}>
          {toast.msg}
        </div>
      )}

      {/* Backdrop for mobile drawer */}
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
            <span className="text-[#3FA7E0] shrink-0">Bwenge AI</span> <span className="truncate">Admin Console</span>
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
              <p className="text-sm text-[#9AA6C9] mt-0.5">Live database and server connected control plane.</p>
            </div>
            <button onClick={loadData} className={btnGhost}>
              <RefreshCw size={15} /> Refresh Data
            </button>
          </div>

          {loading ? (
            <div className={`${card} p-12 text-center text-[#9AA6C9]`}>Loading live data from server...</div>
          ) : error ? (
            <ErrorBanner message={error} onRetry={loadData} />
          ) : (
            <>
              {tab === 'overview' && overview && (
                <div className="space-y-6 min-w-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Knowledge Bases" value={overview.counts.knowledgeBases} detail="Active stores" />
                    <Stat label="Total Documents" value={overview.counts.documents} detail="Indexed files" />
                    <Stat label="Dataset Examples" value={overview.counts.datasetExamples} detail="Curated samples" />
                    <Stat label="Questions Answered" value={overview.counts.questionsAnswered} detail="Lifetime RAG" />
                    <Stat label="Active Models" value={overview.counts.activeModels} detail="Deployment ready" />
                    <Stat label="Fine-Tune Jobs" value={overview.counts.fineTuneJobs} detail="Custom weights" />
                    <Stat label="Tokens Used" value={overview.counts.tokensUsed.toLocaleString()} detail="Input + Output" />
                    <Stat label="Storage Used" value={`${overview.counts.storageUsedGb} GB`} detail="Object store" />
                  </div>

                  <Section title="Live Service Health" hint="Real-time ping status of connected backend services.">
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
                </div>
              )}

              {tab === 'knowledge' && (
                <Section title="Knowledge Bases" hint="Manage document repositories and vector stores." actions={
                  <button onClick={async () => {
                    const name = prompt('Knowledge Base Name:');
                    if (!name) return;
                    try {
                      await adminApi.createKnowledgeBase({ name, description: 'Created from admin console' });
                      notify('Knowledge base created');
                      await loadData();
                    } catch (e: any) { notify(e.message, true); }
                  }} className={btnPrimary}>
                    <Plus size={16} /> New Knowledge Base
                  </button>
                }>
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
                          <span className="truncate">{kb.chunks} Chunks</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {tab === 'documents' && (
                <Section title="Document Ingestion & Pipeline" hint="Upload PDFs, spreadsheets, and text files for RAG indexing." actions={
                  <label className={btnPrimary + ' cursor-pointer'}>
                    <Upload size={16} /> Upload Document
                    <input type="file" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const kbId = kbs[0]?.id;
                      if (!kbId) { notify('Create a knowledge base first.', true); return; }
                      const form = new FormData();
                      form.append('file', file);
                      form.append('knowledgeBaseId', kbId);
                      try {
                        notify('Uploading and processing document...');
                        await adminApi.uploadDocument(form);
                        notify('Document uploaded successfully.');
                        await loadData();
                      } catch (err: any) { notify(err.message, true); }
                    }} />
                  </label>
                }>
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[650px]">
                      <thead className="bg-[#1B2340] text-xs text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Name</th>
                          <th className="p-4">Type</th>
                          <th className="p-4">Size</th>
                          <th className="p-4">Knowledge Base</th>
                          <th className="p-4">Stage</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {docs.map((d) => (
                          <tr key={d.id} className="hover:bg-[#1B2340]/50">
                            <td className="p-4 font-medium text-white max-w-[200px] truncate" title={d.name}>{d.name}</td>
                            <td className="p-4"><Badge tone="blue">{d.type}</Badge></td>
                            <td className="p-4 text-[#9AA6C9]">{d.size}</td>
                            <td className="p-4 text-[#9AA6C9] max-w-[150px] truncate">{d.kb}</td>
                            <td className="p-4"><Badge tone={d.status === 'READY' ? 'green' : 'yellow'}>Stage {d.stage} ({d.status})</Badge></td>
                            <td className="p-4">
                              <button onClick={async () => {
                                if (confirm(`Delete document ${d.name}?`)) {
                                  await adminApi.deleteDocument(d.id);
                                  notify('Document deleted');
                                  await loadData();
                                }
                              }} className="text-red-400 hover:text-red-300 p-1" title="Delete Document"><Trash2 size={16} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {tab === 'datasets' && (
                inspectDataset ? (
                  <Section title={`Dataset Examples: ${inspectDataset.name}`} hint="Review and approve examples before starting a fine-tuning job." actions={
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        try {
                          await Promise.all(datasetExamples.map(ex => adminApi.updateDatasetExample(ex.id, { status: 'approved' })));
                          const res = await adminApi.getDatasetExamples(inspectDataset.id);
                          setDatasetExamples(res.data);
                          notify('All dataset examples approved');
                        } catch (err: any) { notify(err.message, true); }
                      }} className={btnPrimary}>Approve All</button>
                      <button onClick={() => setInspectDataset(null)} className={btnGhost}>Back to Datasets</button>
                    </div>
                  }>
                    {datasetExamplesLoading ? (
                      <p className="text-sm text-[#9AA6C9]">Loading examples...</p>
                    ) : datasetExamples.length === 0 ? (
                      <p className="text-sm text-[#9AA6C9]">No examples found. Click "Generate from Knowledge" in the datasets list.</p>
                    ) : (
                      <div className="space-y-4">
                        {datasetExamples.map((ex) => (
                          <div key={ex.id} className={`${card} p-4 space-y-3 min-w-0`}>
                            <div className="flex justify-between items-center">
                              <Badge tone={ex.status === 'approved' ? 'success' : ex.status === 'rejected' ? 'danger' : 'warning'}>{ex.status}</Badge>
                              <div className="flex gap-2">
                                {ex.status !== 'approved' && (
                                  <button onClick={async () => {
                                    await adminApi.updateDatasetExample(ex.id, { status: 'approved' });
                                    const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                    setDatasetExamples(res.data);
                                    notify('Example approved');
                                  }} className="px-3 py-1 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 rounded text-xs hover:bg-emerald-600/30">Approve</button>
                                )}
                                {ex.status !== 'rejected' && (
                                  <button onClick={async () => {
                                    await adminApi.updateDatasetExample(ex.id, { status: 'rejected' });
                                    const res = await adminApi.getDatasetExamples(inspectDataset.id);
                                    setDatasetExamples(res.data);
                                    notify('Example rejected');
                                  }} className="px-3 py-1 bg-rose-600/20 text-rose-400 border border-rose-500/30 rounded text-xs hover:bg-rose-600/30">Reject</button>
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-[#9AA6C9]">Prompt:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3 rounded border border-[#2E3A63] mt-1 whitespace-pre-wrap">{ex.prompt}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-[#9AA6C9]">Completion:</p>
                              <p className="text-sm text-white bg-[#0F1424] p-3 rounded border border-[#2E3A63] mt-1 whitespace-pre-wrap">{ex.completion}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>
                ) : (
                  <Section title="Datasets & Fine-Tuning Curations" hint="Manage training datasets and verified examples." actions={
                    <button onClick={async () => {
                      const name = prompt('Dataset Name:');
                      if (!name) return;
                      await adminApi.createDataset({ name });
                      notify('Dataset created');
                      await loadData();
                    }} className={btnPrimary}>
                      <Plus size={16} /> New Dataset
                    </button>
                  }>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {datasets.map((ds) => (
                        <div key={ds.id} className={`${card} p-5 space-y-3 min-w-0`}>
                          <h3 className="font-semibold text-white truncate">{ds.name}</h3>
                          <p className="text-xs text-[#9AA6C9] break-words">{ds.description || 'Curated dataset for fine-tuning.'}</p>
                          <div className="flex flex-wrap gap-2 pt-2">
                            <button onClick={async () => {
                              await adminApi.generateDatasetExamples(ds.id);
                              notify('Generated pending candidates from knowledge base.');
                              await loadData();
                            }} className={btnGhost}>Generate from Knowledge</button>
                            <button onClick={async () => {
                              setInspectDataset(ds);
                              setDatasetExamplesLoading(true);
                              try {
                                const res = await adminApi.getDatasetExamples(ds.id);
                                setDatasetExamples(res.data);
                              } catch (err: any) { notify(err.message, true); }
                              finally { setDatasetExamplesLoading(false); }
                            }} className={btnGhost}>Inspect Examples</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )
              )}

              {tab === 'playground' && (
                <Section title="AI RAG Playground" hint="Test the retrieval pipeline and model response with live citations.">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
                    <div className={`${card} p-4 sm:p-6 space-y-4 min-w-0`}>
                      <Field label="Test Question">
                        <textarea rows={4} className={input} value={pgQ} onChange={(e) => setPgQ(e.target.value)} placeholder="Ask a question about uploaded documents..." />
                      </Field>
                      <Field label="Knowledge Base">
                        <select className={input} value={pgKb} onChange={(e) => setPgKb(e.target.value)}>
                          <option value="">All Knowledge Bases</option>
                          {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
                        </select>
                      </Field>
                      <button onClick={async () => {
                        if (!pgQ) return;
                        setPgLoading(true);
                        try {
                          const res = await adminApi.runPlayground({ question: pgQ, knowledgeBaseId: pgKb || undefined });
                          setPgResult((res as any).data);
                          notify('RAG query executed successfully');
                        } catch (err: any) { notify(err.message, true); }
                        finally { setPgLoading(false); }
                      }} className={btnPrimary} disabled={pgLoading}>
                        <FlaskConical size={16} /> {pgLoading ? 'Running RAG...' : 'Run Playground Query'}
                      </button>
                    </div>

                    <div className={`${card} p-4 sm:p-6 space-y-4 min-w-0 overflow-y-auto max-h-[600px]`}>
                      <h3 className="font-semibold text-white">Response & Citations</h3>
                      {pgResult ? (
                        <div className="space-y-4 text-sm min-w-0">
                          <div className="p-3 bg-[#0F1424] rounded-lg border border-[#2E3A63] min-w-0">
                            <p className="font-medium text-white mb-1">Answer:</p>
                            <p className="text-[#E8EAF2] break-words">{pgResult.answer}</p>
                          </div>
                          <div>
                            <p className="font-medium text-white mb-2">Citations:</p>
                            <div className="space-y-2">
                              {pgResult.citations?.map((c: any, idx: number) => (
                                <div key={idx} className="p-2 bg-[#1B2340] rounded border border-[#263052] text-xs min-w-0">
                                  <span className="text-[#3FA7E0] font-medium break-words">{c.sourceFilename}</span> (Page {c.pageNumber}, Section {c.section})
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-[#9AA6C9]">Run a query to inspect real model output, citations, and retrieved chunks.</p>
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {tab === 'models' && (
                <Section title="Model Registry" hint="Active AI models and provider deployments." actions={
                  <button onClick={async () => {
                    const name = prompt('Model Name:');
                    if (!name) return;
                    await adminApi.createModel({ name, provider: 'Anthropic', baseModel: 'Claude Sonnet', version: 'v1' });
                    notify('Model registered');
                    await loadData();
                  }} className={btnPrimary}>
                    <Plus size={16} /> Register Model
                  </button>
                }>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {models.map(m => (
                      <div key={m.id} className={`${card} p-5 space-y-3 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-semibold text-white truncate">{m.name}</h3>
                          <Badge tone={statusTone(m.status)}>{m.status}</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] truncate">Provider: {m.provider} · Base: {m.baseModel}</p>
                        <div className="flex justify-between items-center text-xs text-[#6C789E] pt-2 border-t border-[#263052]">
                          <span className="truncate">Env: {m.environment}</span>
                          <button onClick={async () => { await adminApi.deleteModel(m.id); notify('Model deleted'); await loadData(); }} className="text-red-400 hover:text-red-300 p-1">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {tab === 'finetune' && (
                <Section title="Fine-Tuning Jobs" hint="Manage custom model fine-tuning jobs." actions={
                  <button onClick={async () => {
                    const dsId = datasets[0]?.id;
                    if (!dsId) { notify('Create a dataset first.', true); return; }
                    try {
                      await adminApi.createFineTuneJob(dsId);
                      notify('Fine-tune job queued');
                      await loadData();
                    } catch (e: any) { notify(e.message, true); }
                  }} className={btnPrimary}>
                    <Plus size={16} /> Start Fine-Tune Job
                  </button>
                }>
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-left text-sm min-w-[600px]">
                      <thead className="bg-[#1B2340] text-xs text-[#9AA6C9] uppercase border-b border-[#263052]">
                        <tr>
                          <th className="p-4">Job ID</th>
                          <th className="p-4">Status</th>
                          <th className="p-4">Token Estimate</th>
                          <th className="p-4">Cost Estimate ($)</th>
                          <th className="p-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#263052]">
                        {fineTuneJobs.map((j) => (
                          <tr key={j.id} className="hover:bg-[#1B2340]/50">
                            <td className="p-4 font-mono text-xs text-white truncate max-w-[150px]">{j.id}</td>
                            <td className="p-4"><Badge tone={j.status === 'COMPLETED' ? 'green' : 'yellow'}>{j.status}</Badge></td>
                            <td className="p-4 text-[#9AA6C9]">{j.tokenEstimate}</td>
                            <td className="p-4 text-[#9AA6C9]">${j.costEstimate}</td>
                            <td className="p-4">
                              <button onClick={async () => { await adminApi.cancelFineTuneJob(j.id); notify('Job cancelled'); await loadData(); }} className="text-red-400 hover:text-red-300 text-xs font-medium p-1">Cancel</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {tab === 'retrieval' && retrievalSet && (
                <Section title="Retrieval Settings" hint="Configure chunking, top-K, and hybrid search parameters per environment.">
                  <div className={`${card} p-4 sm:p-6 max-w-xl space-y-4 w-full min-w-0`}>
                    <Field label="Chunk Size">
                      <input type="number" className={input} value={retrievalSet.chunkSize} onChange={(e) => setRetrievalSet({ ...retrievalSet, chunkSize: Number(e.target.value) })} />
                    </Field>
                    <Field label="Overlap">
                      <input type="number" className={input} value={retrievalSet.overlap} onChange={(e) => setRetrievalSet({ ...retrievalSet, overlap: Number(e.target.value) })} />
                    </Field>
                    <Field label="Top-K">
                      <input type="number" className={input} value={retrievalSet.topK} onChange={(e) => setRetrievalSet({ ...retrievalSet, topK: Number(e.target.value) })} />
                    </Field>
                    <Field label="Threshold">
                      <input type="number" step="0.05" className={input} value={retrievalSet.threshold} onChange={(e) => setRetrievalSet({ ...retrievalSet, threshold: Number(e.target.value) })} />
                    </Field>
                    <button onClick={async () => {
                      await adminApi.updateRetrievalSettings({ ...retrievalSet, environment: env });
                      notify('Retrieval settings saved');
                    }} className={btnPrimary}>Save Retrieval Settings</button>
                  </div>
                </Section>
              )}

              {tab === 'prompts' && (
                <Section title="System Prompts & Versions" hint="Manage prompt versions across environments.">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {prompts.map(p => (
                      <div key={p.id} className={`${card} p-5 space-y-3 min-w-0`}>
                        <h3 className="font-semibold text-white truncate">{p.name}</h3>
                        {p.versions?.map((v: any) => (
                          <div key={v.id} className="p-3 bg-[#0F1424] rounded border border-[#2E3A63] text-xs space-y-2 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <span className="font-medium text-white truncate">Version {v.version} ({v.environment})</span>
                              {v.active && <Badge tone="green">Active</Badge>}
                            </div>
                            <p className="text-[#9AA6C9] line-clamp-3 break-words">{v.text}</p>
                            <button onClick={async () => {
                              const confirmPromote = confirm(`Promote version ${v.version} to production?`);
                              await adminApi.promotePrompt(p.id, v.id, 'production', confirmPromote);
                              notify('Prompt promoted successfully');
                              await loadData();
                            }} className={btnGhost + ' text-xs py-1.5 px-3'}>Promote to Production</button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {tab === 'providers' && (
                <Section title="AI Provider Configurations" hint="Secure API keys and model backend settings.">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {providers.map((prv, idx) => (
                      <div key={idx} className={`${card} p-5 space-y-3 min-w-0`}>
                        <div className="flex justify-between items-start gap-2 min-w-0">
                          <h3 className="font-semibold text-white truncate">{prv.provider}</h3>
                          <Badge tone="green">Configured</Badge>
                        </div>
                        <p className="text-xs text-[#9AA6C9] truncate">Model: {prv.model}</p>
                        <p className="text-xs font-mono text-[#6C789E] truncate">Secret: {prv.secretRef}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {tab === 'analytics' && analytics && (
                <Section title="Usage & Cost Analytics" hint="Computed in real-time from database usage events.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Stat label="Total Questions" value={analytics.totalQuestions} />
                    <Stat label="Answered from KB" value={`${analytics.answeredRate}%`} />
                    <Stat label="Avg Latency" value={`${analytics.avgLatencyMs} ms`} />
                    <Stat label="Estimated Cost" value={`$${analytics.costUsd}`} />
                  </div>
                </Section>
              )}

              {tab === 'users' && (
                <Section title="User & Role Management" hint="Manage platform users and administrator permissions.">
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
                              <select className="bg-[#0F1424] text-xs text-white border border-[#2E3A63] rounded p-1.5 cursor-pointer" value={u.role} onChange={async (e) => {
                                try {
                                  await adminApi.updateUserRole(u.id, e.target.value);
                                  notify('User role updated');
                                  await loadData();
                                } catch (err: any) { notify(err.message, true); }
                              }}>
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

              {tab === 'logs' && (
                <Section title="System Audit Logs" hint="Immutable audit trail of all administrative actions.">
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
                            <td className="p-3 text-[#7CC4EE] truncate max-w-[100px]">{l.actorId}</td>
                            <td className="p-3 text-white font-semibold truncate max-w-[120px]">{l.action}</td>
                            <td className="p-3 text-[#9AA6C9] truncate max-w-[100px]">{l.resourceType}</td>
                            <td className="p-3 text-[#6C789E] truncate max-w-[200px]" title={l.details}>{l.details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {tab === 'settings' && (
                <Section title="Console Settings" hint="Global administration preferences.">
                  <div className={`${card} p-6 max-w-xl space-y-4 min-w-0`}>
                    <p className="text-sm text-[#9AA6C9] break-words">Bwenge AI enterprise administration console is fully connected to PostgreSQL database & secure backend services.</p>
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
