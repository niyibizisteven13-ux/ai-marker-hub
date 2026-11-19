import { useState } from 'react';
import { Check, ChevronDown, ExternalLink, Loader2, Send } from 'lucide-react';
import { publicApi } from '../../biz/api';
import type { PublicBusiness, PublicSection } from '../../biz/types';
import { useTx } from '../../biz/i18n';

/** The extra sections an owner or their agent added to the public page: text, FAQ, price list, buttons, and a form that feeds a private tracker. */
const field = 'w-full rounded-xl border border-[#D5DBE3] bg-white px-3.5 py-3 text-[15px] text-[#0E1722] outline-none placeholder:text-[#8793A3] focus:border-[var(--acc)] focus:ring-2 focus:ring-[var(--acc)]/25';

function FormSection({ slug, s, preview }: { slug: string; s: PublicSection; preview: boolean }) {
  const tx = useTx(); const [v, setV] = useState<Record<string, string>>({}); const [hp, setHp] = useState(''); const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [err, setErr] = useState('');
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (preview || state === 'sending') return; setState('sending'); setErr(''); try { await publicApi.submitForm(slug, s.id, { values: v, website: hp }); setState('done'); } catch (x) { setErr(x instanceof Error ? x.message : 'Could not send.'); setState('idle'); } };
  if (state === 'done') return <p role="status" className="flex items-center gap-2 rounded-xl bg-[#E8F6EE] px-4 py-3.5 text-[15px] text-[#14532D]"><Check size={18} />{tx('Sent. The business will contact you.')}</p>;
  return (
    <form onSubmit={send} className="space-y-3" noValidate>
      {s.form!.fields.map((f) => (
        <label key={f.key} className="block text-sm"><span className="mb-1.5 block font-medium text-[#344054]">{f.label}{f.required ? ' *' : ''}</span>
          {f.type === 'choice' ? <select className={field} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}><option value="">–</option>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            : <input className={field} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'text' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} maxLength={300} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}</label>))}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
      {err && <p role="alert" className="rounded-lg bg-[#FEECEC] px-3 py-2 text-sm text-[#9B1C1C]">{err}</p>}
      <button type="submit" disabled={preview || state === 'sending'} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--acc)] px-5 text-[15px] font-semibold text-[var(--on)] disabled:opacity-50">{state === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}{s.button || tx('Send')}</button>
      {preview && <p className="text-xs text-[#667085]">{tx('Preview: nothing is sent.')}</p>}
    </form>
  );
}

export default function Sections({ b, preview }: { b: PublicBusiness; preview: boolean }) {
  if (!b.sections?.length) return null;
  return (
    <>{b.sections.map((s) => (
      <section key={s.id} id={`section-${s.id}`} className="scroll-mt-20">
        <h2 className="mb-3 font-display text-2xl font-semibold tracking-tight">{s.title}</h2>
        {s.body && <p className="mb-4 whitespace-pre-line text-[15.5px] leading-relaxed text-[#344054]">{s.body}</p>}
        {s.type === 'faq' && <div className="divide-y divide-[#E7EAEE] rounded-2xl border border-[#E7EAEE] bg-white">{s.items?.map((it, i) => (
          <details key={i} className="group px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold"><span>{it.title}</span><ChevronDown size={18} className="shrink-0 text-[#667085] transition group-open:rotate-180" /></summary>{it.text && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-[#475467]">{it.text}</p>}</details>))}</div>}
        {s.type === 'list' && <ul className="divide-y divide-[#E7EAEE] rounded-2xl border border-[#E7EAEE] bg-white">{s.items?.map((it, i) => (
          <li key={i} className="flex items-start justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="text-[15px] font-semibold">{it.title}</p>{it.text && <p className="text-sm text-[#667085]">{it.text}</p>}</div>{it.price && <b className="shrink-0 text-[15px]">{it.price}</b>}</li>))}</ul>}
        {s.type === 'links' && <ul className="grid gap-2.5 sm:grid-cols-2">{s.items?.map((it, i) => (
          <li key={i}><a href={it.url} target="_blank" rel="noreferrer noopener" className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[#D5DBE3] bg-white px-4 text-[15px] font-semibold hover:bg-[#F6F7F9]">{it.title}<ExternalLink size={16} className="shrink-0 text-[#667085]" /></a></li>))}</ul>}
        {s.type === 'form' && s.form && <div className="rounded-3xl border border-[#E7EAEE] bg-[#F9FAFB] p-5 sm:p-6"><FormSection slug={b.slug} s={s} preview={preview} /></div>}
      </section>))}</>
  );
}
