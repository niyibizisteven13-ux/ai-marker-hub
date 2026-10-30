import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Database } from 'lucide-react';
import KnowledgeExplorer from '../components/knowledge/KnowledgeExplorer';

/**
 * Datasets & Curations, view only (/admin/datasets for anyone who is not an administrator, for example hackathon
 * judges). It shows the published dataset repositories exactly as curated: folders, files, indexing status,
 * previews and search. Nothing can be uploaded, changed or deleted, and no other admin section is reachable.
 */
export default function CurationViewPage({ onBack }: { onBack: () => void }) {
  const [toast, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const notify = useCallback((msg: string, bad = false) => setToast({ msg, bad }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className="dark min-h-[var(--app-h,100dvh)] overflow-y-auto bg-[#0B1020] text-[#E8EAF2]">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#202945] bg-[#0B1020]/95 px-4 py-3 backdrop-blur sm:px-6">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[#9AA6C9] hover:bg-white/5 hover:text-white"><ArrowLeft size={16} />Back to chat</button>
      </header>
      <main className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-6 sm:px-6">
        <section className="flex items-start gap-3">
          <div className="rounded-xl border border-[#3DB27A]/30 bg-[#3DB27A]/10 p-2.5 text-[#6FD6A2]"><Database size={22} /></div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white sm:text-2xl">Datasets &amp; Curations</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#9AA6C9]">
              The datasets come from the NISR microdata portal, as published by the National Institute of Statistics of
              Rwanda. Each one is curated here into folders, its files and XML metadata are indexed, and once published it
              is available to Bwenge AI for every user. You can browse, search and preview everything; changes are made
              by the platform's administrators only.
            </p>
          </div>
        </section>
        <KnowledgeExplorer notify={notify} readOnly />
      </main>
      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm shadow-xl ${toast.bad ? 'border-[#E5586B]/40 bg-[#2A1520] text-[#FF8798]' : 'border-[#2A3760] bg-[#141B33] text-[#E8EAF2]'}`}>{toast.msg}</div>
      )}
    </div>
  );
}
