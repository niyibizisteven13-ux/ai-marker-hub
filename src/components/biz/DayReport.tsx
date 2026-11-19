import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, MessageCircle } from 'lucide-react';
import { getStudioLang, tx } from '../../biz/studioI18n';
import { ownerApi } from '../../biz/api';
import type { Business } from '../../biz/types';
import { btnGhost, card, msg } from './ui';

/** The closing report for today or yesterday, counted from the owner's own records. The text is ready to paste into WhatsApp or send to a partner. */
const kigali = (offset: number) => new Date(Date.now() + 2 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
export function DayReportCard({ b }: { b: Business }) {
  const [day, setDay] = useState<0 | 1>(0); const [data, setData] = useState<{ text: string; attention: string[] } | null>(null); const [err, setErr] = useState(''); const [done, setDone] = useState(false); const lang = getStudioLang() === 'rw' ? 'rw' : 'en';
  const load = useCallback(async () => { try { const r = await ownerApi.report(b.id, day ? kigali(1) : undefined, lang); setData({ text: r.text, attention: r.report.attention }); setErr(''); } catch (e) { setErr(msg(e)); } }, [b.id, day, lang]);
  useEffect(() => { setData(null); void load(); const i = window.setInterval(() => void load(), 60_000); return () => window.clearInterval(i); }, [load, b.updatedAt]);
  const copy = async () => { if (!data) return; try { await navigator.clipboard.writeText(data.text); setDone(true); window.setTimeout(() => setDone(false), 2000); } catch { setErr(tx('Copy the text by hand')); } };
  return (
    <section className={`${card} space-y-3`} aria-label={tx('Closing report')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">{tx('Closing report')}</h2>
        <div className="inline-flex rounded-xl border border-[var(--app-line)] p-0.5" role="group" aria-label={tx('Day')}>{([[0, tx('Today')], [1, tx('Yesterday')]] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={day === v} onClick={() => setDay(v)} className={`min-h-9 rounded-lg px-3 text-sm font-semibold ${day === v ? 'bg-[var(--brand)] text-[var(--brand-on)]' : ''}`}>{label}</button>)}</div>
      </div>
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      {!data && !err && <Loader2 className="animate-spin" aria-label={tx('Loading')} />}
      {data && <>
        <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--app-bg)] p-3.5 font-sans text-sm leading-relaxed">{data.text.replace(/\*/g, '')}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={() => void copy()}>{done ? <Check size={16} /> : <Copy size={16} />}{done ? tx('Copied') : tx('Copy')}</button>
          <a className={btnGhost} href={`https://wa.me/?text=${encodeURIComponent(data.text)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} />{tx('Send on WhatsApp')}</a>
        </div>
      </>}
    </section>
  );
}
