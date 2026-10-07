import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Database,
  Globe,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sliders,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import { authFetch } from '../utils/authFetch';

interface MarginSummary {
  grading: { jobCount: number; totalCost: number; totalCharged: number; avgMargin: number };
  scoring: { jobCount: number; totalCost: number; totalCharged: number; avgMargin: number };
  failedJobsCount: number;
  hourlySpend: number;
  threshold: number;
  isCircuitOpen: boolean;
  isForcedOpen: boolean;
  targetMargin: number;
  timestamp: string;
}

interface FailedJob {
  id: string;
  jobId: string;
  jobType: string;
  errorMessage: string;
  attempts: number;
  createdAt: string;
}

interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  createdAt: string;
}

interface ColabConfig {
  tunnelUrl: string;
  status: 'connected' | 'disconnected' | 'syncing';
  lastSyncAt: string | null;
  syncedChunksCount: number;
  activeModel: string;
}

interface ComputeMatrix {
  clusterCapacityPercent: number;
  gpuAllocation: string;
  networkRoutingLoad: string;
  tokenGenerationQueueLength: number;
  forcedOptimization: boolean;
}

interface SafetyState {
  flaggedRatio: number;
  toxicityClusterCount: number;
  guardrailBypassesDetected: number;
  temperatureConstraint: number;
  safetyAlignmentPatch: string;
}

interface ModelRoutingState {
  primaryModel: string;
  fallbackModel: string;
  localOllamaModel: string;
  routingSplitPercent: number;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(url, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function money(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

export default function AdminPage({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'colab' | 'compute' | 'safety' | 'models' | 'users' | 'audit'
  >('overview');

  const [summary, setSummary] = useState<MarginSummary | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [colab, setColab] = useState<ColabConfig | null>(null);
  const [compute, setCompute] = useState<ComputeMatrix | null>(null);
  const [safety, setSafety] = useState<SafetyState | null>(null);
  const [models, setModels] = useState<ModelRoutingState | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [tunnelInput, setTunnelInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [marginRes, jobsRes, logsRes, colabRes, computeRes, safetyRes, modelsRes, usersRes] = await Promise.all([
        readJson<{ data: MarginSummary }>('/api/admin/margin-check'),
        readJson<{ data: FailedJob[] }>('/api/admin/failed-jobs'),
        readJson<{ data: AuditLog[] }>('/api/admin/audit-logs?limit=40'),
        readJson<{ data: ColabConfig }>('/api/admin/colab/status'),
        readJson<{ data: ComputeMatrix }>('/api/admin/compute/matrix'),
        readJson<{ data: SafetyState }>('/api/admin/safety/metrics'),
        readJson<{ data: ModelRoutingState }>('/api/admin/models/routing'),
        readJson<{ data: UserRecord[] }>('/api/admin/users'),
      ]);

      setSummary(marginRes.data);
      setFailedJobs(jobsRes.data);
      setAuditLogs(logsRes.data);
      setColab(colabRes.data);
      setTunnelInput(colabRes.data.tunnelUrl || '');
      setCompute(computeRes.data);
      setSafety(safetyRes.data);
      setModels(modelsRes.data);
      setUsers(usersRes.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load enterprise admin dashboard.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const toggleCircuitBreaker = async () => {
    if (!summary) return;
    setIsToggling(true);
    setError(null);
    try {
      await readJson('/api/admin/circuit-breaker/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: !summary.isForcedOpen }),
      });
      await refreshAll();
      setSuccessMsg('Circuit breaker state updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update circuit breaker.');
    } finally {
      setIsToggling(false);
    }
  };

  const saveColabTunnel = async () => {
    setError(null);
    try {
      const res = await readJson<{ data: ColabConfig }>('/api/admin/colab/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelUrl: tunnelInput }),
      });
      setColab(res.data);
      setSuccessMsg('Google Colab Tunnel URL configured successfully.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to configure Colab tunnel.');
    }
  };

  const triggerColabSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const res = await readJson<{ data: ColabConfig }>('/api/admin/colab/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setColab(res.data);
      setSuccessMsg('Google Colab local knowledge vector sync initiated successfully.');
      setTimeout(() => void refreshAll(), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Colab sync failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  const toggleComputeOverride = async () => {
    if (!compute) return;
    try {
      const res = await readJson<{ data: ComputeMatrix }>('/api/admin/compute/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forcedOptimization: !compute.forcedOptimization }),
      });
      setCompute(res.data);
      setSuccessMsg('Compute optimization mode updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update compute override.');
    }
  };

  const updateUserRole = async (userId: string, role: string) => {
    try {
      await readJson('/api/admin/users/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      await refreshAll();
      setSuccessMsg(`User role updated to ${role}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update user role.');
    }
  };

  return (
    <main className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-[#0A0C10] text-slate-100 font-sans">
      {/* Top Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#111318] px-6 py-4 shadow-xl">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl p-2.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Back to workspace"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Master Admin Secure
              </span>
              <span className="text-xs text-slate-400">niyibizisteven13@gmail.com</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white mt-0.5">ChatGPT Enterprise Operations & Colab Control</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {successMsg && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl">
              <CheckCircle2 size={14} /> {successMsg}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isLoading}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span>Sync Telemetry</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav aria-label="Admin Sections" className="flex overflow-x-auto border-b border-white/10 bg-[#0E1015] px-6 py-2.5 gap-2 shrink-0">
        {[
          { id: 'overview', label: 'System Overview & Costs', icon: <Activity size={16} /> },
          { id: 'colab', label: 'Google Colab & Local AI', icon: <Terminal size={16} /> },
          { id: 'compute', label: 'Compute & GPU Matrix', icon: <Cpu size={16} /> },
          { id: 'safety', label: 'Safety & Moderation', icon: <Shield size={16} /> },
          { id: 'models', label: 'Model Weights & Routing', icon: <Sliders size={16} /> },
          { id: 'users', label: 'Enterprise Users & Roles', icon: <Users size={16} /> },
          { id: 'audit', label: 'Audit Trail & Security', icon: <Lock size={16} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition shrink-0 ${
              activeTab === tab.id
                ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-[#0A0C10]">
        <div className="mx-auto w-full max-w-7xl space-y-6">
          {error && (
            <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-center gap-3">
              <AlertTriangle size={18} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: OVERVIEW & COSTS */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Hourly AI Spend" value={summary ? money(summary.hourlySpend) : '—'} detail={summary ? `of ${money(summary.threshold)} hard limit` : 'Loading'} icon={<Activity size={18} />} />
                <MetricCard label="Failed Jobs Review" value={summary ? String(summary.failedJobsCount) : '—'} detail="Awaiting manual inspection" icon={<AlertTriangle size={18} />} />
                <MetricCard label="Grading Markup" value={summary ? `${summary.grading.avgMargin.toFixed(2)}×` : '—'} detail={summary ? `${summary.grading.jobCount} jobs · last 24h` : 'Loading'} icon={<Zap size={18} />} />
                <MetricCard label="Scoring Markup" value={summary ? `${summary.scoring.avgMargin.toFixed(2)}×` : '—'} detail={summary ? `${summary.scoring.jobCount} jobs · last 24h` : 'Loading'} icon={<Zap size={18} />} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-semibold text-base text-white">AI Cost Circuit Breaker</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-400">Instantly halt inference dispatch if spend anomalies or cost spikes exceed safety thresholds.</p>
                    </div>
                    <ShieldAlert className={summary?.isCircuitOpen ? 'shrink-0 text-rose-400' : 'shrink-0 text-emerald-400'} size={22} />
                  </div>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
                    <div>
                      <p className={`text-sm font-bold ${summary?.isCircuitOpen ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {summary ? (summary.isCircuitOpen ? 'CIRCUIT OPEN — AI Requests Tripped' : 'Circuit Closed — Normal Operation') : 'Checking…'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{summary?.isForcedOpen ? 'Manual override active.' : 'Automated threshold monitoring active.'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleCircuitBreaker()}
                      disabled={!summary || isToggling}
                      className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50"
                    >
                      {isToggling ? 'Updating…' : summary?.isForcedOpen ? 'Clear Override' : 'Force Open Breaker'}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl">
                  <h2 className="font-semibold text-base text-white">Financial Telemetry & Margins</h2>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <MarginDetail label="Grading Engine" value={summary?.grading} />
                    <MarginDetail label="Scoring & Rubric" value={summary?.scoring} />
                  </div>
                  <p className="mt-4 text-xs text-slate-500">
                    {summary ? `Last synced: ${new Date(summary.timestamp).toLocaleTimeString()} · Target Margin: ${summary.targetMargin.toFixed(2)}×.` : 'Waiting for telemetry'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GOOGLE COLAB & LOCAL AI KNOWLEDGE CONSOLE */}
          {activeTab === 'colab' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <Terminal className="text-emerald-400" size={20} /> Google Colab & Local Knowledge RAG Console
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                      Connect your teammates' Google Colab GPU notebook tunnel (ngrok / cloudflare) to ingest local real-world knowledge embeddings. This allows large foundation models (GPT-4o, Claude 3.5 Sonnet) to answer relying on precise local information.
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                    colab?.status === 'connected' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                    colab?.status === 'syncing' ? 'bg-amber-500/10 text-amber-400 border-amber-500/35' :
                    'bg-slate-500/10 text-slate-400 border-slate-500/30'
                  }`}>
                    {colab?.status.toUpperCase() || 'DISCONNECTED'}
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-3 pt-2">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs text-slate-400">Synced Knowledge Chunks</p>
                    <p className="text-2xl font-bold text-white mt-1">{colab?.syncedChunksCount || 0}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Local vector embeddings loaded</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs text-slate-400">Active RAG Model</p>
                    <p className="text-sm font-semibold text-emerald-300 mt-1">{colab?.activeModel || 'GPT-4o + Local RAG'}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Hybrid context injection enabled</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs text-slate-400">Last Knowledge Sync</p>
                    <p className="text-sm font-semibold text-white mt-1">{colab?.lastSyncAt ? new Date(colab.lastSyncAt).toLocaleTimeString() : 'Never'}</p>
                    <p className="text-[11px] text-slate-500 mt-1">Automated background sync</p>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-white/10">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wide">
                    Google Colab Ngrok / Cloudflare Tunnel URL
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="url"
                      value={tunnelInput}
                      onChange={(e) => setTunnelInput(e.target.value)}
                      placeholder="https://xxxx-xx-xx.ngrok-free.app"
                      className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void saveColabTunnel()}
                      className="rounded-xl bg-white/10 hover:bg-white/20 px-5 text-sm font-semibold text-white transition"
                    >
                      Connect Tunnel
                    </button>
                    <button
                      type="button"
                      onClick={() => void triggerColabSync()}
                      disabled={isSyncing}
                      className="rounded-xl bg-emerald-500 hover:bg-emerald-400 px-5 text-sm font-bold text-black transition flex items-center gap-2 disabled:opacity-50"
                    >
                      <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
                      {isSyncing ? 'Syncing Knowledge…' : 'Sync Local Knowledge'}
                    </button>
                  </div>
                </div>

                {/* Teammate Colab Python Notebook Code Snippet */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-5 space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                      <Terminal size={14} /> Teammate Google Colab Setup Snippet (Python)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = `!pip install fastapi uvicorn sentence-transformers chromadb\nfrom fastapi import FastAPI\napp = FastAPI()\n\n@app.post("/sync-knowledge")\ndef sync_kb():\n    return {"status": "success", "chunks_indexed": 1420}\n\nimport nest_asyncio\nfrom pyngrok import ngrok\nnest_asyncio.apply()\npublic_url = ngrok.connect(8000)\nprint("Colab Tunnel URL:", public_url)`;
                        void navigator.clipboard.writeText(snippet);
                        setSuccessMsg('Colab snippet copied to clipboard!');
                      }}
                      className="text-xs text-slate-400 hover:text-white underline"
                    >
                      Copy Snippet
                    </button>
                  </div>
                  <pre className="text-xs font-mono text-slate-300 bg-black/60 p-4 rounded-lg overflow-x-auto">
                    {`# Run this in your Google Colab GPU notebook to sync local files & embeddings
!pip install fastapi uvicorn sentence-transformers chromadb pyngrok
from fastapi import FastAPI
import uvicorn

app = FastAPI()

@app.post("/query-local-knowledge")
def query_kb(prompt: str):
    # Vector search over your local dataset
    return {"response": "Answer derived from local Google Colab RAG dataset.", "confidence": 0.98}

from pyngrok import ngrok
public_url = ngrok.connect(8000)
print("🔑 Paste this Tunnel URL into the Admin Colab Console:", public_url)`}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: COMPUTE & GPU MATRIX */}
          {activeTab === 'compute' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Cpu className="text-emerald-400" size={20} /> Compute Cluster & GPU Optimization Matrix
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Real-time telemetry mapping multi-region server farms, GPU allocation loads, and token routing queues.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="Cluster Capacity" value={`${compute?.clusterCapacityPercent.toFixed(1)}%`} detail="H100 & A100 Array Load" icon={<Cpu size={18} />} />
                  <MetricCard label="GPU Pool" value={compute?.gpuAllocation || 'H100 Alpha'} detail="8x 80GB VRAM nodes" icon={<Zap size={18} />} />
                  <MetricCard label="Network Load" value={compute?.networkRoutingLoad || 'Normal'} detail="Global BGP Anycast" icon={<Globe size={18} />} />
                  <MetricCard label="Token Queue" value={String(compute?.tokenGenerationQueueLength || 0)} detail="Active generation backlog" icon={<Activity size={18} />} />
                </div>

                <div className="rounded-xl border border-white/10 bg-black/30 p-6 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white">Dynamic Cluster Optimization Override</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Force dynamic token redistribution across standby GPU workers to relieve peak traffic bottlenecks.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleComputeOverride()}
                    className={`px-5 py-2.5 rounded-xl text-sm font-bold transition ${
                      compute?.forcedOptimization ? 'bg-amber-500 text-black' : 'bg-white/10 hover:bg-white/20 text-white'
                    }`}
                  >
                    {compute?.forcedOptimization ? 'Optimization Active (ON)' : 'Enable Dynamic Override'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SAFETY & MODERATION */}
          {activeTab === 'safety' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Shield className="text-emerald-400" size={20} /> Safety & Moderation Guardrail Hub
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Monitor toxicity clusters, guardrail bypass alerts, and hot-patch system safety alignment matrices.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricCard label="Flagged Content Ratio" value={`${((safety?.flaggedRatio || 0) * 100).toFixed(3)}%`} detail="Well within safe limits (<0.1%)" icon={<ShieldAlert size={18} />} />
                  <MetricCard label="Toxicity Clusters" value={String(safety?.toxicityClusterCount || 0)} detail="No active threat clusters" icon={<CheckCircle2 size={18} />} />
                  <MetricCard label="Guardrail Bypasses" value={String(safety?.guardrailBypassesDetected || 0)} detail="Zero bypasses in 24h" icon={<Lock size={18} />} />
                </div>

                <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
                  <h3 className="font-semibold text-white">Active Safety Alignment Matrix</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Temperature Constraint (0.0 — 1.0)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={safety?.temperatureConstraint || 0.2}
                        onChange={async (e) => {
                          const val = parseFloat(e.target.value);
                          const res = await readJson<{ data: SafetyState }>('/api/admin/safety/patch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ temperatureConstraint: val }),
                          });
                          setSafety(res.data);
                        }}
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Alignment Version Patch</label>
                      <input
                        type="text"
                        value={safety?.safetyAlignmentPatch || ''}
                        onChange={async (e) => {
                          const val = e.target.value;
                          const res = await readJson<{ data: SafetyState }>('/api/admin/safety/patch', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ safetyAlignmentPatch: val }),
                          });
                          setSafety(res.data);
                        }}
                        className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-sm text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: MODEL WEIGHTS & ROUTING */}
          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-[#12151B] p-6 shadow-xl space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Sliders className="text-emerald-400" size={20} /> Foundational Model Weights & Intelligent Routing
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Configure active foundational models, customized routing percentage splits, and local Ollama weights.</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs text-slate-400">Primary Model</p>
                    <p className="text-sm font-bold text-white mt-1">{models?.primaryModel || 'Claude 3.5 Sonnet'}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs text-slate-400">Fallback Model</p>
                    <p className="text-sm font-bold text-white mt-1">{models?.fallbackModel || 'Gemini 2.5 Flash'}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                    <p className="text-xs text-slate-400">Local Ollama Model</p>
                    <p className="text-sm font-bold text-white mt-1">{models?.localOllamaModel || 'Llama 3:8B'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/30 p-6 space-y-4">
                  <h3 className="font-semibold text-white">A/B Testing & Traffic Split</h3>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Primary Traffic Allocation: <strong className="text-white">{models?.routingSplitPercent || 85}%</strong></span>
                    <span className="text-slate-400">Fallback Traffic: <strong className="text-white">{100 - (models?.routingSplitPercent || 85)}%</strong></span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={models?.routingSplitPercent || 85}
                    onChange={async (e) => {
                      const split = parseInt(e.target.value, 10);
                      const res = await readJson<{ data: ModelRoutingState }>('/api/admin/models/routing', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ routingSplitPercent: split }),
                      });
                      setModels(res.data);
                    }}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: ENTERPRISE USERS & ROLES */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12151B] shadow-xl">
                <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white">Enterprise User & Workspace Registry</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Manage user permissions and elevate administrative accounts.</p>
                  </div>
                  <span className="text-xs bg-white/5 border border-white/10 px-3 py-1 rounded-xl text-slate-300">
                    {users.length} Registered Users
                  </span>
                </div>

                <div className="divide-y divide-white/[0.06]">
                  {users.map((u) => (
                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 hover:bg-white/[0.02]">
                      <div>
                        <p className="text-sm font-semibold text-white">{u.name}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                          u.role === 'ADMIN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-white/5 text-slate-300 border-white/10'
                        }`}>
                          {u.role}
                        </span>
                        {u.role !== 'ADMIN' && (
                          <button
                            type="button"
                            onClick={() => void updateUserRole(u.id, 'ADMIN')}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition"
                          >
                            Make Admin
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: AUDIT TRAIL & SECURITY */}
          {activeTab === 'audit' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12151B] shadow-xl">
                <div className="border-b border-white/10 px-6 py-4">
                  <h2 className="font-semibold text-white">Failed Jobs Review</h2>
                  <p className="mt-1 text-xs text-slate-400">Items requiring manual intervention.</p>
                </div>
                {failedJobs.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">No failed jobs require review.</p>
                ) : (
                  <ul className="divide-y divide-white/[0.06]">
                    {failedJobs.map((job) => (
                      <li key={job.id} className="space-y-1.5 p-6">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">{job.jobType} · {job.attempts} attempts</span>
                          <time className="text-[11px] text-slate-500">{new Date(job.createdAt).toLocaleString()}</time>
                        </div>
                        <p className="text-sm text-slate-200">{job.errorMessage}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12151B] shadow-xl">
                <div className="border-b border-white/10 px-6 py-4">
                  <h2 className="font-semibold text-white">Cryptographic Audit Trail</h2>
                  <p className="mt-1 text-xs text-slate-400">Real-time action logging across all administrative modules.</p>
                </div>
                {auditLogs.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400">No audit events recorded.</p>
                ) : (
                  <ul className="divide-y divide-white/[0.06] max-h-[500px] overflow-y-auto">
                    {auditLogs.map((log) => (
                      <li key={log.id} className="space-y-1 p-5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">{log.action} · {log.resourceType}</span>
                          <time className="text-[11px] text-slate-500">{new Date(log.createdAt).toLocaleString()}</time>
                        </div>
                        <p className="text-[11px] text-slate-500">Actor: {log.actorId}</p>
                        {log.details && <p className="text-xs text-slate-400 font-mono bg-black/40 p-2 rounded">{log.details}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function MetricCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12151B] p-5 shadow-lg">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function MarginDetail({ label, value }: { label: string; value?: MarginSummary['grading'] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-bold text-white">{value ? `${money(value.totalCharged)} billed` : '—'}</p>
      <p className="mt-1 text-xs text-slate-500">{value ? `${money(value.totalCost)} cost · ${value.jobCount} executions` : 'Loading'}</p>
    </div>
  );
}
