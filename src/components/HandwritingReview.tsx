import React, { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';

export interface HandwritingEvidence {
  id: string; page: number; text: string; handwritten: boolean; needsReview: boolean;
  signals: string[]; questionIds: string[]; cropUrl: string;
}

export default function HandwritingReview({ evidence, disabled, onCorrect }: {
  evidence: HandwritingEvidence; disabled: boolean;
  onCorrect: (elementId: string, text: string) => Promise<void>;
}) {
  const [source, setSource] = useState('');
  const [draft, setDraft] = useState(evidence.text);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(evidence.text); }, [evidence.text]);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      const response = await authFetch(evidence.cropUrl, { signal: controller.signal });
      if (!response.ok) throw new Error('Close-up unavailable. Compare with the full scanned page.');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setSource(url);
    })().catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [evidence.cropUrl]);
  return <article className="mt-3 rounded-xl border border-[#E8E4DC] bg-white p-3">
    <p className="mb-2 font-semibold">{evidence.handwritten ? 'Handwriting' : 'Source text'} · Page {evidence.page}{evidence.needsReview ? ' · Check reading' : ''}</p>
    {source && <img className="mb-3 max-h-52 w-full rounded border object-contain" src={source} alt={`Original answer close-up on page ${evidence.page}`} />}
    {evidence.signals.map((signal, i) => <p className="mb-1 text-amber-800" key={i}>{signal}</p>)}
    <form onSubmit={async event => {
      event.preventDefault(); setSaving(true); setError('');
      try { await onCorrect(evidence.id, draft); } catch (e: any) { setError(e.message); } finally { setSaving(false); }
    }}>
      <label className="block">What the student wrote
        <textarea aria-label={`Correct reading ${evidence.id}`} className="mt-1 w-full rounded-lg border p-2 text-sm" maxLength={5000} rows={3} value={draft} onChange={e => setDraft(e.target.value)} disabled={disabled || saving} />
      </label>
      <button className="mt-2 rounded-lg border px-3 py-2 font-semibold disabled:opacity-40" disabled={disabled || saving || draft === evidence.text}>{saving ? 'Saving…' : 'Save reading & re-mark affected answers'}</button>
    </form>
    {error && <p role="alert" className="mt-2 text-rose-700">{error}</p>}
  </article>;
}
