import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import BizPage from '../components/biz/BizPage';
import { BizApiError, publicApi } from '../biz/api';
import { THEMES, type PublicBusiness } from '../biz/types';

/** /b/<name>: loads the page and shows it. A missing, unpublished or hidden page all look the same: not available. */
export default function BizPublicPage({ slug }: { slug: string }) {
  const [state, setState] = useState<{ business: PublicBusiness; openNow: boolean | null } | 'loading' | 'missing' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    publicApi.page(slug).then((p) => { if (alive) { setState(p); document.title = `${p.business.name} · Bwenge`; } }).catch((e) => { if (alive) setState(e instanceof BizApiError && e.status === 404 ? 'missing' : 'error'); });
    return () => { alive = false; };
  }, [slug]);
  useEffect(() => {
    let alive = true;
    let pending = false;
    const refreshBadge = async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const { verified } = await publicApi.badge(slug);
        if (alive) setState((current) => {
          if (typeof current === 'string' || current.business.slug !== slug || Boolean(current.business.verified) === verified) return current;
          return { ...current, business: { ...current.business, verified: verified ? true : undefined } };
        });
      } catch {
        // Keep the last visible state if a refresh fails.
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(refreshBadge, 15_000);
    document.addEventListener('visibilitychange', refreshBadge);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshBadge);
    };
  }, [slug]);
  // The business's own installable app: while its page is open, the browser sees this business's manifest, colour and name.
  useEffect(() => {
    if (typeof state === 'string') return; const b = state.business; const prev: Array<[Element, string]> = [];
    const swap = (sel: string, make: () => HTMLElement, attr: string, value: string) => { let el = document.head.querySelector(sel); if (!el) { el = make(); document.head.appendChild(el); prev.push([el, '']); } else prev.push([el, el.getAttribute(attr) ?? '']); el.setAttribute(attr, value); };
    swap('link[rel="manifest"]', () => Object.assign(document.createElement('link'), { rel: 'manifest' }), 'href', `/api/biz/public/${encodeURIComponent(b.slug)}/manifest.webmanifest`);
    swap('meta[name="theme-color"]', () => Object.assign(document.createElement('meta'), { name: 'theme-color' }), 'content', THEMES[b.theme]?.accent ?? '#0E1722');
    const attrs = ['href', 'content'];
    return () => { for (const [el, v] of prev) { const a = attrs.find((x) => el.hasAttribute(x))!; if (v) el.setAttribute(a, v); else el.remove(); } };
  }, [state]);
  if (state === 'loading') return <div className="flex min-h-[100dvh] items-center justify-center bg-[#EEF0F3] text-[#5B6776]"><Loader2 className="animate-spin" /></div>;
  if (state === 'missing' || state === 'error') return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#EEF0F3] px-6 text-center font-sans text-[#0E1722]">
      <h1 className="font-display text-2xl font-semibold">{state === 'missing' ? 'This page is not available' : 'The page could not load'}</h1>
      <p className="max-w-sm text-[15px] text-[#5B6776]">{state === 'missing' ? 'The link may be wrong, or the business has not published its page yet.' : 'Check your connection and try again.'}</p>
      <a href="/" className="mt-2 rounded-xl bg-[#0E1722] px-5 py-3 text-sm font-semibold text-white">Go to Bwenge</a>
    </div>
  );
  return <BizPage business={state.business} openNow={state.openNow} mediaSrc={(id) => publicApi.mediaUrl(state.business.slug, id)} />;
}
