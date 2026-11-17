import { useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import { StarsInput } from './Stars';
import { getApiUrl } from '../utils/authFetch';
import type { Platform } from '../utils/device';

/**
 * "How is it working for you?": a star rating (required) and a short optional survey. Anonymous; the server limits abuse (see appFeedback.ts).
 * Comments and contact details go only to the administrator. The contact box is used only when the person ticks the permission.
 */
type AppId = 'bwenge' | 'myseb';
const APPS: Array<{ id: AppId; label: string }> = [{ id: 'bwenge', label: 'Bwenge' }, { id: 'myseb', label: 'MySEB' }];
const EASE = [['very_easy', 'Very easy'], ['easy', 'Easy'], ['hard', 'Difficult'], ['failed', 'I could not install it']] as const;
const USES = [['marking', 'Marking'], ['quizzes', 'Making quizzes'], ['exams', 'Taking exams'], ['studying', 'Studying'], ['other', 'Something else']] as const;
const field = 'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-[#F6B94A]';

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: ReadonlyArray<readonly [T, string]>; value: T | ''; onChange: (v: T | '') => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-neutral-300">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(value === id ? '' : id)}
            className={`min-h-10 rounded-full border px-3.5 text-xs transition-colors ${value === id ? 'border-[#F6B94A] bg-[#F6B94A]/15 text-white' : 'border-white/10 text-neutral-300 hover:bg-white/5'}`}>{text}</button>
        ))}
      </div>
    </fieldset>
  );
}

export default function AppFeedbackForm({ platform, defaultApp = 'bwenge' }: { platform: Platform; defaultApp?: AppId }) {
  const [app, setApp] = useState<AppId>(defaultApp);
  const [rating, setRating] = useState(0);
  const [more, setMore] = useState(false);
  const [ease, setEase] = useState<string>(''); const [use, setUse] = useState<string>('');
  const [improve, setImprove] = useState(''); const [contact, setContact] = useState(''); const [contactOk, setContactOk] = useState(false);
  const [website, setWebsite] = useState('');                          // hidden field: only robots fill it
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle'); const [error, setError] = useState('');

  const send = async (ev: React.FormEvent) => {
    ev.preventDefault(); if (!rating || state === 'sending') return;
    setState('sending'); setError('');
    try {
      const r = await fetch(getApiUrl('/api/app/feedback'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app, rating, platform: platform === 'other' ? undefined : platform, ease, use, improve, contact, contactOk, website }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error || 'Your feedback could not be sent. Please try again.');
      setState('done');
    } catch (e) { setError(e instanceof Error ? e.message : 'Your feedback could not be sent.'); setState('idle'); }
  };

  if (state === 'done') return (
    <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5">
      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={22} />
      <div><p className="text-sm font-semibold text-white">Thank you for your feedback.</p><p className="mt-0.5 text-xs text-neutral-300">It helps us make {APPS.find((a) => a.id === app)!.label} better.</p></div>
    </div>
  );

  return (
    <form onSubmit={send} className="space-y-5" noValidate>
      <div role="radiogroup" aria-label="Which app are you rating?" className="inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1">
        {APPS.map((a) => <button key={a.id} type="button" role="radio" aria-checked={app === a.id} onClick={() => setApp(a.id)} className={`min-h-9 rounded-lg px-4 text-sm transition-colors ${app === a.id ? 'bg-[#F6B94A] font-semibold text-black' : 'text-neutral-300 hover:text-white'}`}>{a.label}</button>)}
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-white">How would you rate {APPS.find((a) => a.id === app)!.label}?</p>
        <StarsInput value={rating} onChange={setRating} label={`Rate ${APPS.find((a) => a.id === app)!.label}`} />
      </div>

      <div className="rounded-xl border border-white/10">
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="flex min-h-12 w-full items-center justify-between px-4 text-left text-sm text-neutral-200">
          <span>Tell us more <span className="text-neutral-500">(optional, 1 minute)</span></span><ChevronDown size={18} className={`transition-transform ${more ? 'rotate-180' : ''}`} />
        </button>
        {more && (
          <div className="space-y-5 border-t border-white/10 p-4">
            <Chips label="How easy was it to install?" options={EASE} value={ease} onChange={setEase} />
            <Chips label="What do you mainly use it for?" options={USES} value={use} onChange={setUse} />
            <div>
              <label htmlFor="fb-improve" className="mb-2 block text-xs font-medium text-neutral-300">What should we improve?</label>
              <textarea id="fb-improve" rows={3} maxLength={1000} value={improve} onChange={(e) => setImprove(e.target.value)} placeholder="Anything that was slow, confusing or missing" className={field} />
              <p className="mt-1 text-right text-[11px] text-neutral-500">{improve.length}/1000</p>
            </div>
            <div>
              <label htmlFor="fb-contact" className="mb-2 block text-xs font-medium text-neutral-300">Email or phone (only if you want a reply)</label>
              <input id="fb-contact" type="text" maxLength={120} autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} className={field} />
              {contact.trim() && <label className="mt-2 flex items-start gap-2 text-xs text-neutral-300"><input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#F6B94A]" />You may contact me about this feedback.</label>}
            </div>
          </div>
        )}
      </div>

      {/* A trap for robots: people never see or reach this field. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>

      {error && <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      <button type="submit" disabled={!rating || state === 'sending'} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F6B94A] px-5 text-sm font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
        {state === 'sending' && <Loader2 size={16} className="animate-spin" />}{rating ? 'Send feedback' : 'Choose a star rating to send'}
      </button>
      <p className="text-center text-[11px] text-neutral-500">Anonymous unless you leave contact details. We never publish your comments.</p>
    </form>
  );
}
