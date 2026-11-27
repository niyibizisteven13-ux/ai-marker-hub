import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Code2, Download, Monitor, Smartphone } from 'lucide-react';
import { authFetch } from '../utils/authFetch';

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
};

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium disabled:opacity-50';
const primary = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50';

function Preview({ html, phone }: { html: string; phone: boolean }) {
  const sent = useRef(false);
  return <iframe src="/builder-preview.html" title="App preview" sandbox="allow-scripts"
    onLoad={event => {
      const frame = event.currentTarget.contentWindow;
      if (sent.current || !frame) return;
      sent.current = true;
      frame.postMessage({ type: 'bwenge:builder-preview', html }, '*');
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<'desktop' | 'phone' | 'code'>('desktop');
  const [file, setFile] = useState<keyof Project['files']>('App.jsx');
  const endpoint = `/api/agent/builder/${workspace}`;
  const example = workspaces[workspace].example;

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setProject(null);
    setError('');
    void (async () => {
      try {
        const response = await authFetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load this project.');
        const result: Project = await response.json();
        if (!controller.signal.aborted) setProject(result);
      } catch {
        if (!controller.signal.aborted) setError('Could not load this project. Try reloading it.');
      }
    })();
    return () => controller.abort();
  }, [endpoint, reload, signedIn]);

  async function requestBuild(event: FormEvent) {
    event.preventDefault();
    if (!project || !prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(endpoint, { method: 'POST', body: JSON.stringify({ prompt, revision: project.revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The build could not finish.');
      setProject(result);
      setPrompt('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The build could not finish.'); }
    finally { setBusy(false); }
  }

  function download() {
    if (!project) return;
    const url = URL.createObjectURL(new Blob([project.files[file]], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return <div className="min-h-[100dvh] bg-slate-100 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-medium"><ArrowLeft size={16} /> Bwenge</a>
        <h1 className="text-lg font-semibold">App Builder</h1>
        {signedIn && <select aria-label="Workspace" value={workspace} disabled={busy}
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
          <button type="button" className="text-left text-sm text-indigo-700 underline" disabled={busy} onClick={() => setPrompt(example)}>Use example</button>
          <button className={`${primary} w-full`} disabled={busy || !project || !prompt.trim()}>{busy ? 'Writing and checking code…' : 'Build feature'}</button>
        </form>
        {error && <div className="mt-4 space-y-2 text-sm"><p role="alert" className="text-red-700">{error}</p>
          <button className={button} onClick={() => setReload(value => value + 1)}>Reload project</button></div>}
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
          {project && <span className="ml-auto text-xs text-slate-600">{project.revision ? `Revision ${project.revision}` : 'Starter'}</span>}
        </div>
        {!project ? <p className="p-6 text-sm text-slate-600">{error ? 'Preview unavailable.' : 'Loading project…'}</p>
          : view === 'code' ? <div className="p-3">
            <div className="flex flex-wrap gap-2">
              {(['App.jsx', 'styles.css'] as const).map(name => <button className={button} key={name} aria-pressed={file === name} onClick={() => setFile(name)}>{name}</button>)}
              <button className={button} onClick={download}><Download size={16} /> Download file</button>
            </div>
            <pre className="mt-3 max-h-[65vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100"><code>{project.files[file]}</code></pre>
          </div> : <div className="bg-slate-200 p-3">
            <Preview key={`${workspace}:${project.revision}:${reload}`} html={project.preview} phone={view === 'phone'} />
          </div>}
      </section>
    </main>}
  </div>;
}
