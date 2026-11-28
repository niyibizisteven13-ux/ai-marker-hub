import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Monitor, Smartphone } from 'lucide-react';
import { featureBuilderEndpoint } from '../../shared/chatAppBuilder';
import { browserActionLimit, type BrowserAction, type BrowserViewport } from '../../shared/featureBrowser';
import { authFetch } from '../utils/authFetch';

type BrowserFrame = { revision: number; screenshot: string; diagnostics: string[] };
const button = 'inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 px-2.5 text-xs disabled:opacity-50';

export default function ChatAppBrowser({ project }: { project: string }) {
  const [viewport, setViewport] = useState<BrowserViewport>('phone');
  const [frame, setFrame] = useState<BrowserFrame>();
  const [actions, setActions] = useState<BrowserAction[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function run(next: BrowserAction[], nextViewport = viewport, revision?: number) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const endpoint = new URL(featureBuilderEndpoint('custom', project), window.location.origin);
      const response = await authFetch(`${endpoint.pathname}/browser${endpoint.search}`, {
        method: 'POST', body: JSON.stringify({ viewport: nextViewport, actions: next, revision }), signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Cloud browser request failed.');
      if (!controller.signal.aborted) {
        setViewport(nextViewport);
        setActions(next);
        setFrame(result);
        setInput('');
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cloud browser request failed.');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const disabled = busy || !frame || actions.length >= browserActionLimit;
  const act = (action: BrowserAction) => {
    if (frame && !disabled) void run([...actions, action], viewport, frame.revision);
  };
  const image = frame ? `data:image/png;base64,${frame.screenshot}` : undefined;

  return <section aria-label="App cloud browser" className="my-3 max-w-2xl space-y-2 rounded-xl border border-white/15 p-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} onClick={() => void run([])} disabled={busy}>
        {busy ? 'Running Chromium…' : frame ? 'Reset browser' : 'Open cloud browser'}
      </button>
      {frame && <>
        <button type="button" className={button} aria-pressed={viewport === 'phone'} disabled={busy}
          onClick={() => void run([], 'phone', frame.revision)}><Smartphone size={14} />Phone</button>
        <button type="button" className={button} aria-pressed={viewport === 'desktop'} disabled={busy}
          onClick={() => void run([], 'desktop', frame.revision)}><Monitor size={14} />Desktop</button>
        <a className={button} href={image} download={`bwenge-${viewport}-r${frame.revision}.png`}><Camera size={14} />Save screenshot</a>
      </>}
    </div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {frame && <>
      <p className="text-xs text-[var(--app-faint)]">Revision {frame.revision} · Click the image to interact with the preview. Use sample data.</p>
      <button type="button" aria-label="Click in the cloud browser preview" disabled={disabled}
        className={`mx-auto block w-full overflow-hidden rounded-lg ${viewport === 'phone' ? 'max-w-[390px]' : ''}`}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const fraction = (point: number, offset: number, size: number) => Math.max(0, Math.min(0.999, (point - offset) / size));
          act({ type: 'click', x: event.detail ? fraction(event.clientX, bounds.left, bounds.width) : 0.5,
            y: event.detail ? fraction(event.clientY, bounds.top, bounds.height) : 0.5 });
        }}>
        <img className="block w-full" src={image} alt={`${viewport} screenshot of revision ${frame.revision}`} />
      </button>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={disabled} onClick={() => act({ type: 'scroll', direction: 'up' })}><ChevronUp size={14} />Scroll up</button>
        <button type="button" className={button} disabled={disabled} onClick={() => act({ type: 'scroll', direction: 'down' })}><ChevronDown size={14} />Scroll down</button>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (input) act({ type: 'type', text: input }); }}>
        <input aria-label="Text for the focused preview field" placeholder="Type in the focused field" value={input} maxLength={280}
          onChange={event => setInput(event.target.value)} disabled={disabled}
          className="min-w-32 flex-1 rounded-md border border-white/15 bg-transparent px-2 py-1 text-xs" />
        <button type="submit" className={button} disabled={disabled || !input}>Send text</button>
      </form>
      {actions.length >= browserActionLimit && <p className="text-xs">Reset the browser to start a new test.</p>}
      {!!frame.diagnostics.length && <details className="text-xs" open>
        <summary>Browser diagnostics ({frame.diagnostics.length})</summary>
        <ul className="mt-1 list-disc space-y-1 break-words pl-4">
          {frame.diagnostics.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      </details>}
    </>}
  </section>;
}
