import { useState, type FormEvent } from 'react';
import { Sparkles, X } from 'lucide-react';
import { ownerApi, type CustomerDesignDraft } from '../../biz/api';
import type { Business } from '../../biz/types';
import { btnGhost, btnPrimary, input, msg } from './ui';
import BizPage from './BizPage';

const labels: Record<keyof CustomerDesignDraft['design'], string> = {
  theme: 'Color palette', customerLayout: 'Layout', tagline: 'Tagline', about: 'About',
  headline: 'Headline', appName: 'App name', appIcon: 'App icon',
};

export default function CustomerDesign({ business, onChange, onClose }: { business: Business; onChange: () => void; onClose: () => void }) {
  const isProfile = business.category === 'profile';
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<CustomerDesignDraft>();
  const [media, setMedia] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'draft' | 'apply'>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy('draft');
    setError('');
    setStatus('');
    try {
      const [result, urls] = await Promise.all([
        ownerApi.draftCustomerDesign(business.id, prompt),
        ownerApi.mediaUrls(business.id),
      ]);
      setMedia(urls);
      setDraft(result);
    } catch (cause) { setError(msg(cause)); }
    finally { setBusy(undefined); }
  }

  async function apply() {
    if (busy || !draft) return;
    setBusy('apply');
    setError('');
    try {
      const result = await ownerApi.applyCustomerDesign(business.id, draft);
      setDraft(undefined);
      setStatus([
        result.business.published ? isProfile ? 'Design updated on your public profile.' : 'Design updated on your public page and customer app.' : 'Design saved. Publish the business page to make it public.',
        result.androidBuild === 'requested' ? 'An updated Android installer was requested.'
          : result.androidBuild ? 'The Android installer could not be queued. Retry from Customer app settings.' : '',
      ].filter(Boolean).join(' '));
      if (result.business.published && typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(`bwenge-page:${result.business.slug}`);
        channel.postMessage('refresh');
        channel.close();
      }
      onChange();
    } catch (cause) { setError(msg(cause)); }
    finally { setBusy(undefined); }
  }

  const icon = draft?.business.appIcon ?? draft?.business.logo;
  const currentValues: Partial<Record<keyof CustomerDesignDraft['design'], string>> = {
    theme: business.theme, customerLayout: business.customerLayout ?? 'classic',
    tagline: business.tagline, about: business.about, headline: business.profile?.headline,
    appName: business.appName ?? business.name,
  };
  return <section className="space-y-4 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4 sm:p-6">
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold">{isProfile ? 'Edit profile with the agent' : 'Design customer app'}</h1>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Preview changes to {business.name}’s {isProfile ? 'public profile' : 'page and installable app'}.</p>
      </div>
      <button type="button" aria-label="Close design editor" className={btnGhost} onClick={onClose} disabled={!!busy}><X size={18} /></button>
    </header>
    <form className="space-y-3" onSubmit={generate}>
      <label className="block text-sm font-medium" htmlFor="customer-design-prompt">What should change?</label>
      <textarea className={`${input} min-h-24 w-full`} id="customer-design-prompt"
        value={prompt} maxLength={2000} disabled={!!busy} onChange={event => setPrompt(event.target.value)}
        placeholder={isProfile ? 'Tighten my bio and use a blue theme.' : 'Make the page compact, use an ink theme, and set our logo as the app icon.'} />
      <button className={btnPrimary} disabled={!!busy || !prompt.trim()}><Sparkles size={16} />{busy === 'draft' ? 'Designing…' : 'Generate preview'}</button>
    </form>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {status && <div className="flex flex-wrap items-center gap-3">
      <p role="status" className="text-sm">{status}</p>
      {business.published && <a className={btnGhost} href={`/${isProfile ? 'p' : 'b'}/${encodeURIComponent(business.slug)}`} target="_blank" rel="noreferrer">Open live page</a>}
    </div>}
    {draft && <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-[var(--app-line)] pt-4">
        <div>
          <h2 className="text-lg font-semibold">Proposed changes</h2>
          <dl className="mt-2 grid gap-2 text-sm">
            {Object.entries(labels).map(([key, label]) => {
              const value = draft.design[key as keyof CustomerDesignDraft['design']];
              if (value === undefined) return null;
              const current = currentValues[key as keyof CustomerDesignDraft['design']];
              return <div key={key}>
                <dt className="font-medium">{label}</dt>
                {current && current !== value && <dd className="whitespace-pre-wrap break-words text-[var(--app-muted)]"><span className="font-medium">Current </span>{current}</dd>}
                <dd className="whitespace-pre-wrap break-words"><span className="font-medium">Proposed </span>{value || 'Clear this field'}</dd>
              </div>;
            })}
          </dl>
        </div>
        <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void apply()}>
          {busy === 'apply' ? 'Applying…' : business.published ? 'Apply to live page' : 'Save design'}
        </button>
      </div>
      {!isProfile && <div className="flex items-center gap-3 rounded-xl border border-[var(--app-line)] p-3">
        {icon && media[icon.id] &&
          <img className="h-11 w-11 rounded-xl object-cover" alt="" src={media[icon.id]} />}
        <div><h2 className="text-xs text-[var(--app-muted)]">Home screen identity</h2><p className="font-semibold">{draft.business.appName || draft.business.name}</p></div>
      </div>}
      <div className="overflow-hidden rounded-xl border border-[var(--app-line)]">
        <BizPage business={draft.business} mediaSrc={id => media[id] ?? ''} openNow={draft.openNow} preview />
      </div>
    </>}
  </section>;
}
