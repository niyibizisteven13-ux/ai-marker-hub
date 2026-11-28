import { featureBuilderEndpoint, isChatAppProject } from '../../shared/chatAppBuilder';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, Code2, Download, Monitor, Smartphone } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import { requestBuilderRun, type BuilderProgress } from '../utils/builderStream';

const workspaces = {
  business: { label: 'Bwenge4Biz', example: 'Build a restaurant menu with lunch and dinner filters.' },
  profile: { label: 'Bwenge4Profile', example: 'Build a portfolio with education, skills and project cards.' },
  research: { label: 'Bwenge4Research', example: 'Build a research library with searchable articles and abstracts.' },
  custom: { label: 'Custom app', example: 'Build a booking dashboard with a form and a list of appointments.' },
} as const;
type Workspace = keyof typeof workspaces;
type Project = {
  revision: number;
  files: Record<'App.jsx' | 'styles.css', string>;
  preview: string;
  summary: string;
  changed?: string[];
  history: { revision: number; summary: string }[];
  publishedRevision: number | null;
  publicRelease: { path: string; revision: number; previousRevision: number | null } | null;
  notes: string;
  usage?: { inputTokens: number; outputTokens: number };
};

type PreviewRevision = Pick<Project, 'revision' | 'preview'>;
type Selection = { tag: string; text: string };
type RevisionAction =
  | { action: 'edit'; files: Project['files'] }
  | { action: 'restore'; target: number }
  | { action: 'release'; target?: number }
  | { action: 'publish'; target: number }
  | { action: 'unpublish' }
  | { action: 'notes'; notes: string };

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium disabled:opacity-50';
const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

function Preview({ html, phone, selecting, onSelect, onError }: {
  html: string;
  phone: boolean;
  selecting?: boolean;
  onSelect?: (selection: Selection) => void;
  onError?: (message: string) => void;
}) {
  const sent = useRef(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== iframe.current?.contentWindow || event.origin !== 'null') return;
      const { type, detail } = event.data ?? {};
      if (type === 'bwenge:preview-error' && typeof detail === 'string') onError?.(detail.slice(0, 300));
      if (type === 'bwenge:selection' && selecting && typeof detail?.tag === 'string' && typeof detail?.text === 'string') {
        onSelect?.({ tag: detail.tag.slice(0, 32), text: detail.text.slice(0, 140) });
      }
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [selecting, onSelect, onError]);
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ type: 'bwenge:select-mode', enabled: selecting }, '*');
  }, [selecting]);

  return <iframe ref={iframe} src="/builder-preview.html" title="App preview" sandbox="allow-scripts"
    onLoad={event => {
      const frame = event.currentTarget.contentWindow;
      if (sent.current || !frame) return;
      sent.current = true;
      frame.postMessage({ type: 'bwenge:builder-preview', html }, '*');
      frame.postMessage({ type: 'bwenge:select-mode', enabled: !!selecting }, '*');
    }}
    className={`mx-auto block h-[65vh] w-full rounded-xl bg-white ${phone ? 'max-w-[390px]' : ''}`} />;
}

export default function FeatureBuilderPage({ signedIn, onLogin }: { signedIn: boolean; onLogin: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const requested = new URLSearchParams(window.location.search).get('workspace');
    return requested && Object.hasOwn(workspaces, requested) ? requested as Workspace : 'custom';
  });
  const [project, setProject] = useState<Project | null>(null);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'quick' | 'standard'>('standard');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BuilderProgress[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [screenshots, setScreenshots] = useState<{ url: string; viewport: 'desktop' | 'phone'; revision: number }[]>([]);
  const screenshotUrls = useRef(new Set<string>());
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<'desktop' | 'phone' | 'code'>('desktop');
  const [file, setFile] = useState<keyof Project['files']>('App.jsx');
  const [source, setSource] = useState<Project['files']>();
  const [notes, setNotes] = useState('');
  const [mutation, setMutation] = useState(false);
  const [comparison, setComparison] = useState<PreviewRevision>();
  const [compareTarget, setCompareTarget] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [previewError, setPreviewError] = useState('');
  const [notice, setNotice] = useState('');
  const [releaseReport, setReleaseReport] = useState('');
  const working = busy || capturing || mutation;
  const projectParam = new URLSearchParams(window.location.search).get('project');
  const endpoint = featureBuilderEndpoint(workspace, isChatAppProject(projectParam) ? projectParam : undefined);
  const example = workspaces[workspace].example;

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setProject(null);
    setComparison(undefined);
    setCompareTarget('');
    setSelection(undefined);
    setSelecting(false);
    setNotice('');
    setReleaseReport('');
    setScreenshots([]);
    setProgress([]);
    setError('');
    void (async () => {
      try {
        const response = await authFetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load this project.');
        const result: Project = await response.json();
        if (!controller.signal.aborted) updateProject(result);
      } catch {
        if (!controller.signal.aborted) setError('Could not load this project. Try reloading it.');
      }
    })();
    return () => controller.abort();
  }, [endpoint, reload, signedIn]);

  useEffect(() => {
    const visible = new Set(screenshots.map(item => item.url));
    for (const url of screenshotUrls.current) {
      if (visible.has(url)) continue;
      URL.revokeObjectURL(url);
      screenshotUrls.current.delete(url);
    }
  }, [screenshots]);
  useEffect(() => {
    const urls = screenshotUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  function updateProject(result: Project) {
    if (project?.revision !== result.revision) setPreviewError('');
    setProject(result);
    setSource(result.files);
    setNotes(result.notes);
  }

  function revisionUrl(path: string) {
    const url = new URL(endpoint, window.location.origin);
    return `${url.pathname}/${path}${url.search}`;
  }

  async function manage(action: RevisionAction) {
    if (!project || working) return;
    setMutation(true);
    setNotice('');
    setError('');
    try {
      const response = await authFetch(revisionUrl('revisions'), {
        method: 'POST', body: JSON.stringify({ ...action, revision: project.revision }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'Could not save the project.');
      updateProject(result);
      if (action.action === 'release' && compareTarget === 'release') {
        setCompareTarget('');
        setComparison(undefined);
      }
      if (action.action === 'publish' || action.action === 'unpublish') setReleaseReport('');
      setNotice(action.action === 'publish' ? 'Public app updated.' :
        action.action === 'unpublish' ? 'Public link disabled.' :
        action.action === 'release' ? 'Release saved in this workspace.' :
        action.action === 'restore' ? 'Restored as a new working revision.' : 'Saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the project.'); }
    finally { setMutation(false); }
  }

  async function checkRelease() {
    if (working) return;
    setMutation(true);
    setError('');
    setReleaseReport('');
    try {
      const response = await authFetch(revisionUrl('check-release'), {
        method: 'POST', body: JSON.stringify({ viewport: view === 'phone' ? 'phone' : 'desktop' }),
      });
      const report = await response.json().catch(() => null);
      if (!response.ok) throw new Error(report?.error || 'Could not check the public release.');
      setReleaseReport(`Revision ${report.revision} · ${report.viewport} · ${report.rendered ? 'Rendered' : 'Blank'} · ${report.runtimeErrors} runtime errors · ${report.horizontalOverflow ? 'Horizontal overflow' : 'Fits viewport'} · ${report.controlsWithoutNames} unnamed controls`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check the public release.'); }
    finally { setMutation(false); }
  }

  async function compare(revision: string) {
    setCompareTarget(revision);
    setComparison(undefined);
    if (!revision) return;
    setMutation(true);
    setError('');
    try {
      const response = await authFetch(revisionUrl(`revision/${revision}`));
      if (!response.ok) throw new Error('Could not load this revision.');
      setComparison(await response.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this revision.'); }
    finally { setMutation(false); }
  }

  async function capture(revision = project?.revision) {
    if (revision === undefined || working) return;
    const viewport: 'phone' | 'desktop' = view === 'phone' ? 'phone' : 'desktop';
    setCapturing(true);
    setError('');
    try {
      const response = await authFetch(revisionUrl('screenshot'), {
        method: 'POST', body: JSON.stringify({ viewport, revision }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(problem?.error || 'Could not capture preview.');
      }
      const url = URL.createObjectURL(await response.blob());
      screenshotUrls.current.add(url);
      setScreenshots(current => [...current.filter(item => item.revision !== revision || item.viewport !== viewport), { url, viewport, revision }].slice(-4));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not capture preview.'); }
    finally { setCapturing(false); }
  }

  async function requestBuild(event: FormEvent) {
    event.preventDefault();
    if (!project || !prompt.trim() || working) return;
    setBusy(true);
    setProgress([]);
    setScreenshots([]);
    setError('');
    try {
      const request = selection ? `Selected preview element: ${JSON.stringify(selection)}\n\n${prompt}`.slice(0, 4_000) : prompt;
      const result = await requestBuilderRun<Project>(endpoint, { prompt: request, revision: project.revision, mode }, event => {
        setProgress(current => {
          const prior = current.find(step => step.id === event.id);
          return prior ? current.map(step => step === prior ? { ...event, detail: event.detail ?? step.detail } : step) : [...current, event];
        });
      });
      updateProject(result);
      setSelection(undefined);
      setSelecting(false);
      setPrompt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The build could not finish.'); }
    finally { setBusy(false); }
  }

  async function downloadProject() {
    if (!project) return;
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      zip.file('package.json', JSON.stringify({
        name: 'bwenge-app', private: true, version: '1.0.0', type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.1', 'react-dom': '^19.0.1' },
        devDependencies: { vite: '^6.4.5', '@vitejs/plugin-react': '^4.7.0' },
      }, null, 2));
      zip.file('vite.config.js', "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n");
      zip.file('index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bwenge app</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
      zip.file('src/main.jsx', "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles.css';\ncreateRoot(document.getElementById('root')).render(<App />);\n");
      for (const [name, source] of Object.entries(project.files)) zip.file(`src/${name}`, source);
      zip.file('README.md', '# Bwenge app\n\nRun `npm install` and `npm run dev`. For a production build, run `npm run build`.\n');
      saveDownload(await zip.generateAsync({ type: 'blob' }), 'bwenge-app.zip');
    } catch { setError('Could not download the app project. Try again.'); }
  }

  function saveDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function download() {
    if (!project) return;
    saveDownload(new Blob([project.files[file]], { type: 'text/plain' }), file);
  }

  return <div className="min-h-[100dvh] bg-slate-100 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Bwenge</a>
        <h1 className="text-lg font-semibold">App Builder</h1>
        {signedIn && <select aria-label="Workspace" value={workspace} disabled={working}
          onChange={event => { setProject(null); setWorkspace(event.target.value as Workspace); setPrompt(''); }}
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
          {Object.entries(workspaces).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}
        </select>}
      </div>
    </header>
    {!signedIn ? <main className="mx-auto mt-20 max-w-lg rounded-2xl bg-white p-8">
      <h2 className="text-xl font-semibold">Build a feature from a prompt</h2>
      <p className="mb-6 mt-2 text-sm text-slate-600">Sign in to save your code and preview your app.</p>
      <button className={primary} onClick={onLogin}>Sign in</button>
    </main> : <main className="mx-auto grid max-w-screen-2xl gap-4 p-4 md:grid-cols-[minmax(240px,340px)_minmax(0,1fr)] sm:p-6">
      <section className="self-start rounded-2xl border border-slate-200 bg-white p-5">
        <form className="space-y-3" onSubmit={requestBuild}>
          <label htmlFor="feature-prompt" className="block text-lg font-semibold">What should the app do?</label>
          <p className="text-sm text-slate-600">Build a private prototype with sample data.</p>
          <textarea id="feature-prompt" rows={5} maxLength={4000} value={prompt} disabled={busy}
            onChange={event => setPrompt(event.target.value)} placeholder={example}
            className="w-full resize-y rounded-lg border border-slate-300 p-3 text-sm focus:outline-indigo-600" />
          {selection && <div className="flex items-center gap-2 text-sm">
            <span className="min-w-0 break-words">Selected {selection.tag} {selection.text && `· ${selection.text}`}</span>
            <button className={button} type="button" onClick={() => setSelection(undefined)}>Clear</button>
          </div>}
          <button type="button" className="text-left text-sm text-indigo-700 underline" disabled={busy} onClick={() => setPrompt(example)}>Use example</button>
          <label className="flex items-center justify-between gap-2 text-sm">
            Build mode
            <select className={button} value={mode} disabled={working} onChange={event => setMode(event.target.value === 'quick' ? 'quick' : 'standard')}>
              <option value="standard">Standard</option>
              <option value="quick">Quick edit</option>
            </select>
          </label>
          <button className={`${primary} w-full`} disabled={working || !project || !prompt.trim()}>{busy ? 'Writing and checking code…' : 'Build feature'}</button>
        </form>
        {error && <div className="mt-4 space-y-2 text-sm"><p role="alert" className="text-red-700">{error}</p>
          <button className={button} disabled={working} onClick={() => setReload(value => value + 1)}>Reload project</button></div>}
        {progress.length > 0 && <ol aria-label="Build progress" aria-live="polite" className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm">
          {progress.map(step => <li key={step.id} className="flex items-start justify-between gap-2">
            <span>{step.label}{step.detail && <code className="ml-1 break-all text-xs text-slate-500">{step.detail}</code>}</span>
            <span className={step.state === 'error' ? 'text-red-700' : 'text-slate-600'}>
              {step.state === 'running' ? 'Running' : step.state === 'done' ? 'Done' : 'Failed'}
            </span>
          </li>)}
        </ol>}
        {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
        {project?.usage && <p className="mt-3 text-sm text-slate-600">
          Last build used {project.usage.inputTokens.toLocaleString()} input tokens and {project.usage.outputTokens.toLocaleString()} output tokens.
        </p>}
        {project && <details className="mt-5 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer font-semibold">Project preferences</summary>
          <label className="mt-2 block text-sm text-slate-600" htmlFor="builder-notes">Brand, layout, and decisions the agent should remember</label>
          <textarea id="builder-notes" className="my-2 w-full rounded-lg border border-slate-300 p-2 text-sm"
            rows={4} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} disabled={working} />
          <button className={button} disabled={working || notes === project.notes} onClick={() => void manage({ action: 'notes', notes })}>Save preferences</button>
        </details>}
        {project?.summary && <div className="mt-5 border-t border-slate-200 pt-4">
          <h2 className="font-semibold">Build summary</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{project.summary}</p>
          {!!project.changed?.length && <p className="mt-3 text-sm text-slate-600">Files changed · {project.changed.join(', ')}</p>}
        </div>}
      </section>
      <section aria-label="Project output" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <button className={button} aria-pressed={view === 'desktop'} onClick={() => setView('desktop')}><Monitor size={16} /> Desktop</button>
          <button className={button} aria-pressed={view === 'phone'} onClick={() => setView('phone')}><Smartphone size={16} /> Phone</button>
          <button className={button} aria-pressed={view === 'code'} onClick={() => setView('code')}><Code2 size={16} /> Code</button>
          {project && view !== 'code' && <button className={button} onClick={() => void capture()} disabled={working}>
            <Camera size={16} /> {capturing ? 'Capturing…' : 'Take screenshot'}
          </button>}
          {project && view !== 'code' && <button className={button} aria-pressed={selecting} disabled={working}
            onClick={() => setSelecting(value => !value)}>{selecting ? 'Cancel selection' : 'Select in preview'}</button>}
          {project && <button className={button} onClick={() => void downloadProject()}><Download size={16} /> Download project</button>}
          {project && <span className="ml-auto text-xs text-slate-600">{project.revision ? `Revision ${project.revision}` : 'Starter'}</span>}
        </div>
        {project && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <label className="text-sm" htmlFor="builder-revision">Compare with</label>
          <select id="builder-revision" value={compareTarget} disabled={working} className={button} onChange={event => void compare(event.target.value)}>
            <option value="">Current draft only</option>
            {project.publishedRevision !== null && <option value="release">Workspace release · {project.publishedRevision}</option>}
            {project.history.map(item => <option key={item.revision} value={item.revision}>Revision {item.revision}</option>)}
          </select>
          {comparison && comparison.revision !== project.revision && <button className={button} disabled={working}
            onClick={() => void manage({ action: 'restore', target: comparison.revision })}>Restore revision {comparison.revision}</button>}
          {comparison && project.publishedRevision !== null && comparison.revision !== project.publishedRevision &&
            project.history.some(item => item.revision === comparison.revision) && <button className={button} disabled={working}
              onClick={() => void manage({ action: 'release', target: comparison.revision })}>Roll back workspace release</button>}
          <button className={button} disabled={working || project.publishedRevision === project.revision || !!previewError}
            onClick={() => void manage({ action: 'release' })}>Save workspace release</button>
        </div>}
        {project && project.revision > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          {project.publicRelease && <a className={button} href={project.publicRelease.path} target="_blank" rel="noopener noreferrer">
            Open public app · Revision {project.publicRelease.revision}
          </a>}
          <button className={button} disabled={working || project.publicRelease?.revision === project.revision || !!previewError}
            onClick={() => void manage({ action: 'publish', target: project.revision })}>{project.publicRelease ? 'Publish update' : 'Publish app'}</button>
          {project.publicRelease?.previousRevision != null && <button className={button} disabled={working}
            onClick={() => {
              const target = project.publicRelease?.previousRevision;
              if (target != null) void manage({ action: 'publish', target });
            }}>Roll back public app</button>}
          {project.publicRelease && comparison && comparison.revision > 0 && comparison.revision !== project.publicRelease.revision && comparison.revision !== project.revision &&
            <button className={button} disabled={working} onClick={() => void manage({ action: 'publish', target: comparison.revision })}>
              Publish revision {comparison.revision}
            </button>}
          {project.publicRelease && <button className={button} disabled={working} onClick={() => void manage({ action: 'unpublish' })}>Unpublish</button>}
          {project.publicRelease && <button className={button} disabled={working} onClick={() => void checkRelease()}>Check release in browser</button>}
          {releaseReport && <p role="status" className="basis-full text-sm text-slate-700">{releaseReport}</p>}
          <p className="basis-full text-xs text-slate-600">Anyone with the public link can open the published revision.</p>
        </div>}
        {previewError && <p role="alert" className="break-words px-3 pt-3 text-sm text-red-700">Preview error · {previewError}</p>}
        {!project ? <p className="p-6 text-sm text-slate-600">{error ? 'Preview unavailable.' : 'Loading project…'}</p>
          : view === 'code' ? <div className="p-3">
            <div className="flex flex-wrap gap-2">
              {(['App.jsx', 'styles.css'] as const).map(name => <button className={button} key={name} aria-pressed={file === name} onClick={() => setFile(name)}>{name}</button>)}
              <button className={button} onClick={download}><Download size={16} /> Download file</button>
            </div>
            <textarea aria-label={`Edit ${file}`} spellCheck={false} maxLength={24000} rows={20} value={source?.[file] ?? project.files[file]}
              disabled={working} onChange={event => setSource({ ...(source ?? project.files), [file]: event.target.value })}
              className="my-3 w-full rounded-xl bg-slate-950 p-4 font-mono text-xs text-slate-100" />
            <button className={primary} disabled={working || !source || (source['App.jsx'] === project.files['App.jsx'] && source['styles.css'] === project.files['styles.css'])}
              onClick={() => source && void manage({ action: 'edit', files: source })}>Compile and save</button>
          </div> : <div className="bg-slate-200 p-3">
            <div className={`grid gap-3 ${comparison ? 'xl:grid-cols-2' : ''}`}>
              <div className="min-w-0">
                {comparison && <p className="mb-2 text-sm font-medium">Current revision {project.revision}</p>}
                <Preview key={`${workspace}:${project.revision}:${reload}`} html={project.preview} phone={view === 'phone'}
                  selecting={selecting} onSelect={element => { setSelection(element); setSelecting(false); }} onError={setPreviewError} />
              </div>
              {comparison && <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Revision {comparison.revision}</p>
                  <button className={button} disabled={working} onClick={() => void capture(comparison.revision)}>Capture comparison</button>
                </div>
                <Preview key={comparison.revision} html={comparison.preview} phone={view === 'phone'} />
              </div>}
            </div>
          </div>}
        {screenshots.map(screenshot => <figure key={screenshot.url} className="border-t border-slate-200 p-4">
          <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{screenshot.viewport === 'phone' ? 'Phone' : 'Desktop'} screenshot · Revision {screenshot.revision}</span>
            <a className={button} href={screenshot.url} download={`bwenge-${screenshot.viewport}-r${screenshot.revision}.png`}>Download PNG</a>
          </figcaption>
          <img src={screenshot.url} alt="Screenshot of the saved app preview" className="mx-auto max-h-[65vh] max-w-full rounded border border-slate-200 object-contain" />
        </figure>)}
      </section>
    </main>}
  </div>;
}
