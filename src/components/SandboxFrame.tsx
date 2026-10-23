import { useEffect, useRef } from 'react';

/**
 * Shows AI-generated HTML with its scripts running, isolated from the app: the frame has no same-origin access,
 * and /sandbox.html carries its own security policy, so the app's strict policy stays strict.
 */
export function SandboxFrame({ html, title, className }: { html: string; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let sent = false;
    const send = () => { if (!sent && frame.contentWindow) { sent = true; frame.contentWindow.postMessage({ type: 'bwenge:render', html }, '*'); } };
    const onMessage = (e: MessageEvent) => { if (e.source === frame.contentWindow && e.data?.type === 'bwenge:sandbox-ready') send(); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [html]);
  // The key reloads the frame when the content changes: the sandbox renders exactly one document.
  // onLoad is a second chance in case the ready message was missed; the sandbox renders only the first message.
  return <iframe key={html.length + title} ref={ref} title={title} src="/sandbox.html" sandbox="allow-scripts allow-downloads allow-popups" className={className}
    onLoad={() => ref.current?.contentWindow?.postMessage({ type: 'bwenge:render', html }, '*')} />;
}

export default SandboxFrame;
