import React, { useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import DocumentScanner, { type PageItem } from '../components/DocumentScanner';

/**
 * The document scanner opened from the Telegram bot (Mini App, or a /scan link in a browser). It is the same
 * scanner as the web app (edge detection, perspective correction, filters, several students) without the
 * AI tools, which need a signed-in web session. "Send to Telegram" uploads one PDF per student; each one
 * arrives in the chat with quick actions (transcribe, mark, summarise).
 */

type Tg = {
  initData?: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
};
const tg = (): Tg | undefined => {
  const w = (window as any).Telegram?.WebApp as Tg | undefined;
  return w?.initData ? w : undefined;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'sending'; done: number; total: number }
  | { kind: 'sent'; files: number }
  | { kind: 'closed' };

const loadSize = (src: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read a scanned page.'));
    img.src = src;
  });

/** One PDF per student; each page keeps the scan's proportions (A4 width). */
export async function buildPdf(pages: Array<Pick<PageItem, 'dataUrl'>>): Promise<Blob> {
  const W = 595.28;
  let doc: jsPDF | null = null;
  for (const p of pages) {
    const { w, h } = await loadSize(p.dataUrl);
    const H = Math.round((W * h) / w);
    if (!doc) doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: H >= W ? 'portrait' : 'landscape' });
    else doc.addPage([W, H], H >= W ? 'portrait' : 'landscape');
    doc.addImage(p.dataUrl, 'JPEG', 0, 0, W, H, undefined, 'FAST');
  }
  return doc!.output('blob');
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Scan';

export default function TelegramScanApp() {
  const token = new URLSearchParams(window.location.search).get('token');
  const app = tg();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const sentRef = useRef(false);

  useEffect(() => {
    if (!app) return;
    app.ready();
    app.expand();
    app.setHeaderColor?.('#0f1013');
    app.setBackgroundColor?.('#0f1013');
    app.disableVerticalSwipes?.(); // dragging page corners must not close the app
  }, [app]);

  if (!app && !token) {
    return (
      <Screen icon={<ScanLine className="h-7 w-7 text-[var(--brand)]" />} title="Open the scanner from Telegram">
        Send <b className="text-white">/scan</b> to the Bwenge bot and tap <b className="text-white">Open scanner</b>. The scanner sends your pages straight back to the chat.
      </Screen>
    );
  }
  if (status.kind === 'sent') {
    return (
      <Screen icon={<CheckCircle2 className="h-7 w-7 text-[#5DCAA5]" />} title={status.files > 1 ? `${status.files} PDFs sent` : 'Sent to Telegram'}>
        Your scan is in the chat. Choose <b className="text-white">Transcribe</b> or <b className="text-white">Mark</b> there, or just type what you need.
        {!app && <span className="mt-3 block">You can close this tab.</span>}
      </Screen>
    );
  }
  if (status.kind === 'closed') {
    return <Screen icon={<ScanLine className="h-7 w-7 text-[var(--brand)]" />} title="Scanner closed">You can close this tab and return to Telegram.</Screen>;
  }

  const send = async (pages: PageItem[]) => {
    const groups = new Map<string, PageItem[]>();
    for (const p of pages) groups.set(p.studentName || 'Scan', [...(groups.get(p.studentName || 'Scan') ?? []), p]);
    const entries = [...groups];
    setStatus({ kind: 'sending', done: 0, total: entries.length });
    try {
      for (let i = 0; i < entries.length; i++) {
        const [name, list] = entries[i];
        const form = new FormData();
        form.append('file', await buildPdf(list), `${safeName(name)}.pdf`);
        const res = await fetch(`/api/telegram/scan-upload${token ? `/${encodeURIComponent(token)}` : ''}`, {
          method: 'POST',
          body: form,
          headers: app?.initData ? { 'X-Telegram-Init-Data': app.initData } : undefined,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Upload failed (${res.status}).`);
        }
        setStatus({ kind: 'sending', done: i + 1, total: entries.length });
      }
      app?.HapticFeedback?.notificationOccurred('success');
      sentRef.current = true;
      setStatus({ kind: 'sent', files: entries.length });
    } catch (e) {
      app?.HapticFeedback?.notificationOccurred('error');
      setStatus({ kind: 'idle' });
      window.alert((e as Error).message || 'Could not send the scan. Your pages are kept; try again.');
      throw e; // the scanner keeps the draft
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[var(--ws-bg)]">
      <DocumentScanner
        labels="student"
        aiTools={false}
        allowExport={false}
        saveLabel="Send to Telegram"
        onSavePages={send}
        onClose={() => {
          // The scanner also calls this right after a successful send: show "sent" for a moment, then close.
          if (sentRef.current) { if (app) window.setTimeout(() => app.close(), 1500); return; }
          if (app) app.close();
          else setStatus({ kind: 'closed' });
        }}
      />
      {status.kind === 'sending' && (
        <div role="status" className="fixed inset-0 z-[2000] grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="flex min-w-[240px] flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[var(--app-panel-2)] px-8 py-6 text-center shadow-2xl">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--brand)]" />
            <div className="text-[15px] font-medium text-white">Sending to Telegram…</div>
            {status.total > 1 && <div className="text-xs text-[var(--app-faint)]">{status.done} of {status.total} PDFs</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function Screen({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--ws-bg)] px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">{icon}</div>
        <h1 className="mb-2 text-xl font-semibold text-white">{title}</h1>
        <p className="text-sm leading-relaxed text-[var(--app-muted)]">{children}</p>
      </div>
    </main>
  );
}

