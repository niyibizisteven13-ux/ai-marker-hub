import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import BizPage from '../components/biz/BizPage';
import { BizApiError, publicApi } from '../biz/api';
import type { PublicBusiness } from '../biz/types';

/** /b/<name>: loads the page and shows it. A missing, unpublished or hidden page all look the same: not available. */
export default function BizPublicPage({ slug }: { slug: string }) {
  const [state, setState] = useState<{ business: PublicBusiness; openNow: boolean | null } | 'loading' | 'missing' | 'error'>('loading');
  useEffect(() => {
    let alive = true;
    publicApi.page(slug).then((p) => { if (alive) { setState(p); document.title = `${p.business.name} · Bwenge`; } }).catch((e) => { if (alive) setState(e instanceof BizApiError && e.status === 404 ? 'missing' : 'error'); });
    return () => { alive = false; };
  }, [slug]);
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
