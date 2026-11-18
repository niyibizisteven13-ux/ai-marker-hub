import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Building2, Check, CheckCircle2, Coins, GraduationCap, Loader2, Lock, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import OrganisationRequestDialog from '../components/OrganisationRequestDialog';
import { creditMeter } from '../components/PlanStatus';

/**
 * Upgrade: Free, Starter, Pro and Pro Plus (monthly, in RWF), credit top-ups, and schools and organisations
 * (one Pro plan per person). Prices come from the server (admin-editable); payment is MTN Mobile Money: the user
 * approves on their phone and the page follows the payment until MTN confirms.
 */

interface PlanLimits { fiveHours?: number; daily: number; weekly: number; monthly: number; perDay: { tool: number; vision: number; artifact: number; marking: number }; maxUploadMb: number; maxAttachments: number; storageMb?: number; memory: boolean; memoryItems: number }
interface Pack { id: string; rwf: number; credits: number; usd: number }
interface PlansResponse {
  manual?: { momoCode: string; momoName: string; whatsapp: string | null } | null;
  fxUsdRwf: number; payments: 'live' | 'sandbox' | 'simulated' | 'off';
  /** Set by an admin with "Pause upgrades": no new purchases until it is turned off. */
  sales?: { paused: boolean; message: string | null };
  plans: Array<{ id: PlanId; name: string; priceUsd: number | null; priceRwf: number | null; period: string; limits: PlanLimits; packs?: Pack[] }>;
}
type PlanId = 'FREE' | 'GO' | 'STARTER' | 'PRO' | 'PLUS' | 'INSTITUTION';
type SoldPlan = 'STARTER' | 'PRO' | 'PLUS';
interface Me { plan: PlanId; planName: string; wallet: number; subscription: { endDate: string | null; daysLeft: number | null } | null; usage: { day: { used: number; limit: number }; month?: { used: number; limit: number } } }
interface Payment { id: string; status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'EXPIRED'; amountRwf: number; currency: string; receiptNumber: string | null; reason: string | null; phoneMasked: string; purpose: string; credits: number; months: number }
type Checkout = { purpose: SoldPlan | 'GO_PACK'; packId?: string; months: number; title: string; amountRwf: number; amountUsd: number };

interface UpgradePageProps {
  jobId?: string;
  service?: string;
  targetPlan?: string;
  onBack: () => void;
  onSuccess: () => void;
}

const SERIF = "font-display";
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const REASONS: Record<string, { title: string; body: string }> = {
  limit: { title: 'You have used your credits', body: 'Pick a monthly plan for more credits, or use a top-up when wallet credits are available.' },
  usage: { title: 'Get more out of Bwenge', body: 'Monthly plans give you credits for chat, documents, marking and files; Pro adds memory across all chats.' },
  memory: { title: 'Memory across all chats is part of Pro', body: 'Bwenge remembers who you are, how you like answers and what you worked on, on the web and in Telegram.' },
  storage: { title: 'More storage for your files', body: 'Paid plans keep far more files: your uploads, the files you share in tasks and everything students hand in. Each plan below shows how much it keeps.' },
  marking: { title: 'Automatic marking is part of the paid plans', body: 'From 1,500 RWF a month: Bwenge can grade typed scripts and quizzes and give you the results.' },
};

const SOLD: Array<{ id: SoldPlan; icon: React.ReactNode; blurb: string }> = [
  { id: 'STARTER', icon: <Zap size={18} />, blurb: 'To try it out on your own work' },
  { id: 'PRO', icon: <Sparkles size={18} />, blurb: 'For regular use every week' },
  { id: 'PLUS', icon: <GraduationCap size={18} />, blurb: 'For heavy use and busy periods' },
];

/** 2048 MB → "2 GB", 200 → "200 MB". */
const storageLabel = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`);

function features(id: PlanId, l: PlanLimits): string[] {
  const n = (x: number) => x.toLocaleString('en-US');
  const storage = l.storageMb ? `${storageLabel(l.storageMb)} storage for your files and students' hand-ins` : null;
  const pacing = l.fiveHours != null && l.weekly != null
    ? [`${n(l.fiveHours)} credits every 5 hours · ${n(l.weekly)} weekly`] : [];
  if (id === 'FREE') return [`${n(l.monthly)} credits a month for chat, scans and documents`, 'Try marking with a top-up', 'Paid plans add marking and quizzes from files', ...pacing, `Uploads up to ${l.maxUploadMb} MB`, ...(storage ? [storage] : [])];
  return [
    `${n(l.monthly)} credits a month for chat, documents, research and files`,
    ...pacing,
    'AI grading for typed scripts and quizzes',
    'Practice, forms, tasks shared by link and Excel results',
    l.memory ? `Memory across all chats (${n(l.memoryItems)})` : 'No memory across chats',
    ...(storage ? [storage] : []),
    `Uploads up to ${l.maxUploadMb} MB, ${l.maxAttachments} per message`,
  ];
}

export default function UpgradePage({ jobId, onBack, onSuccess }: UpgradePageProps) {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [months, setMonths] = useState(1);
  const [packId, setPackId] = useState<string>('');
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const reason = REASONS[params.get('reason') ?? ''] ?? (jobId ? REASONS.limit : null);

  useEffect(() => {
    (async () => {
      try {
        const [p, m] = await Promise.all([authFetch('/api/billing/plans'), authFetch('/api/billing/me')]);
        if (!p.ok) throw new Error('Could not load plans.');
        const plans: PlansResponse = await p.json();
        setData(plans);
        setPackId(plans.plans.find((x) => x.id === 'GO')?.packs?.[1]?.id ?? plans.plans.find((x) => x.id === 'GO')?.packs?.[0]?.id ?? '');
        if (m.ok) setMe(await m.json());
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Could not load plans.');
      }
    })();
  }, []);

  const plan = (id: string) => data?.plans.find((p) => p.id === id);
  const go = plan('GO');
  const free = plan('FREE');
  const pack = go?.packs?.find((p) => p.id === packId);
  const salesPaused = data?.sales?.paused === true;
  // This release deliberately uses manual payment, including against an older server advertising live checkout.
  const manual = !salesPaused ? { momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '250799691108' } : null;
  const paymentsOff = salesPaused;
  const current = me?.plan ?? 'FREE';

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-y-auto bg-[var(--bg)] font-sans text-[var(--text)] antialiased upgrade-scrollbar">
      {orgOpen && <OrganisationRequestDialog isOpen={orgOpen} onClose={() => setOrgOpen(false)} />}
      {checkout && manual && <ManualPayDialog checkout={checkout} manual={manual} onClose={() => setCheckout(null)} onDone={onSuccess} />}

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/90 px-4 py-4 backdrop-blur sm:px-8">
        <button onClick={onBack} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
          <ArrowLeft size={16} /> <span className="whitespace-nowrap text-sm font-medium"><span className="sm:hidden">Back</span><span className="hidden sm:inline">Back to workspace</span></span>
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
          <ShieldCheck size={14} className="text-[var(--teal)]" /> <span className="whitespace-nowrap">Manual MTN MoMo Pay</span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 py-10 sm:px-6">
        {reason && (
          <div className="flex items-start gap-3.5 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 p-4 sm:p-5">
            <Lock size={20} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <div><h3 className="text-sm font-semibold text-[var(--text)]">{reason.title}</h3><p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{reason.body}</p></div>
          </div>
        )}

        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">Plans & pricing</span>
          <h1 className={`${SERIF} text-4xl font-normal tracking-tight text-[var(--text)] sm:text-5xl`}>Pick the plan that fits your work.</h1>
          <p className="text-sm leading-relaxed text-[var(--muted)]">Pay monthly with MTN Mobile Money, no contract. Prices are in Rwandan francs{data ? ` (1 USD ≈ ${data.fxUsdRwf.toLocaleString('en-US')} RWF)` : ''}.</p>
          {me && (
            <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-1.5 text-xs text-[var(--muted)]">
              You are on <b className="text-[var(--text)]">{me.planName}</b>
              {me.subscription?.endDate && <span>· until {new Date(me.subscription.endDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              <span>· {creditMeter(me.usage).label}</span>
              {me.wallet > 0 && <span>· {me.wallet.toLocaleString('en-US')} top-up credits</span>}
            </div>
          )}
        </div>

        {salesPaused ? (
          <div role="status" className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--surface)] p-4 text-sm text-[var(--text)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" /> {data?.sales?.message}
          </div>
        ) : manual ? (
          <div role="status" className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" /> Automatic MTN payment is not available. Pay manually to MoMo Pay code <b className="text-[var(--text)]">{manual.momoCode} · {manual.momoName}</b>, then send your screenshot or confirmation SMS and login email to WhatsApp +{manual.whatsapp}. Your purchase is activated after verification.
          </div>
        ) : paymentsOff && (
          <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" /> Mobile Money payments are being set up. Plans can be activated by an administrator in the meantime.
          </div>
        )}
        {loadError && <p role="alert" className="text-center text-sm text-[var(--danger)]">{loadError}</p>}
        {!data && !loadError && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--accent)]" /></div>}

        {data && free && go && (
          <>
            <div className="flex justify-center">
              <div className="inline-flex gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1" role="radiogroup" aria-label="Months">
                {[1, 3, 6, 12].map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={m === months} onClick={() => setMonths(m)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors ${m === months ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{m === 1 ? '1 month' : `${m} months`}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
              <PlanCard title="Free" icon={<Coins size={18} />} current={current === 'FREE' || current === 'GO'}
                price={<><span className={`${SERIF} text-4xl`}>0</span><span className="ml-1 text-sm text-[var(--muted)]">RWF</span></>} sub="Free forever"
                features={features('FREE', free.limits)}
                action={<button disabled className="min-h-[46px] w-full rounded-xl bg-[var(--surface-2)] py-3 text-sm font-medium text-[var(--muted)]">{current === 'FREE' || current === 'GO' ? 'Your current plan' : 'Included'}</button>} />

              {SOLD.map(({ id, icon, blurb }) => {
                const p = plan(id);
                if (!p?.priceRwf) return null;
                const total = p.priceRwf * months;
                const recommended = id === 'PRO';
                return (
                  <PlanCard key={id} title={p.name} icon={icon} current={current === id} recommended={recommended} tag={recommended ? 'Most popular' : undefined}
                    price={<><span className={`${SERIF} text-4xl`}>{p.priceRwf.toLocaleString('en-US')}</span><span className="ml-1 text-sm text-[var(--muted)]">RWF / month</span></>}
                    sub={`${blurb} · ≈ ${usd(p.priceUsd ?? 0)}`}
                    features={features(id, p.limits)}
                    action={<button disabled={paymentsOff} onClick={() => setCheckout({ purpose: id, months, title: `${p.name} plan · ${months} month${months > 1 ? 's' : ''}`, amountRwf: total, amountUsd: Math.round((total / data.fxUsdRwf) * 100) / 100 })}
                      className={`min-h-[46px] w-full rounded-xl py-3 text-sm font-semibold transition-opacity disabled:opacity-50 ${recommended ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--hover)]'}`}>
                      {current === id ? 'Extend' : 'Choose'} · {rwf(total)}
                    </button>} />
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_2fr]">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--text)]"><Coins size={16} className="text-[var(--accent)]" /> Top up credits</h3>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">Top-ups cover extra AI usage within separate five-hour and weekly limits. Unspent credits stay in your wallet.</p>
                  </div>
                  <button disabled={paymentsOff || !pack} onClick={() => pack && setCheckout({ purpose: 'GO_PACK', packId: pack.id, months: 0, title: `Top-up · ${pack.credits.toLocaleString('en-US')} credits`, amountRwf: pack.rwf, amountUsd: pack.usd })}
                    className="min-h-[40px] rounded-xl bg-[var(--surface-2)] px-4 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-50">Buy {pack ? rwf(pack.rwf) : 'credits'}</button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Top-up">
                  {go.packs!.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={p.id === packId} onClick={() => setPackId(p.id)}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${p.id === packId ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                      <b className="block text-sm">{rwf(p.rwf)}</b>{p.credits.toLocaleString('en-US')} credits
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--text)]"><Building2 size={16} className="text-[var(--accent)]" /> Schools and organisations</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">One Pro plan per person ({rwf(plan('PRO')?.priceRwf ?? 0)} a month each). Each person keeps their own work, credits and memory. We can send one invoice for the whole group.</p>
                </div>
                <button onClick={() => setOrgOpen(true)} className="min-h-[40px] w-full rounded-xl border border-[var(--line)] text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--hover)]">Ask for a group invoice</button>
              </div>
            </div>
          </>
        )}

        <section className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['What is a credit?', 'A chat reply is about 1 credit. AI credits also cover work such as documents, research and grading typed answers.'],
            ['How do I pay?', manual ? 'Choose a plan, pay with MTN MoMo Pay to code 2191184 (Niyibizi Steven), then send the screenshot or payment confirmation SMS and your login email to +250799691108 on WhatsApp. Access is activated after verification.' : 'Enter your MTN MoMo number, then approve the prompt on your phone with your PIN. Your plan or credits are added as soon as MTN confirms.'],
            ['Receipts and renewal', 'After payment is verified and your purchase is activated, a receipt is emailed to your login email and sent to Telegram if connected. Mobile Money never renews automatically: we remind you 3 days before your plan ends.'],
          ].map(([q, a]) => (
            <div key={q} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><h3 className="text-sm font-semibold text-[var(--text)]">{q}</h3><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{a}</p></div>
          ))}
        </section>
      </main>
    </div>
  );
}

/** Manual payment (until online payment is set up): the amount, where to send it, and the screenshot on WhatsApp. An administrator then activates the plan or credits. */
function ManualPayDialog({ checkout, manual, onClose, onDone }: { checkout: Checkout; manual: { momoCode: string; momoName: string; whatsapp: string | null }; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState<{ code: string; email: string | null } | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loginEmail, setLoginEmail] = useState('');
  const [emailLoaded, setEmailLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void authFetch('/api/billing/pay-ref').then(async (r) => { if (!r.ok) throw new Error(); return r.json(); }).then((r) => { if (active) { setRef(r); setLoginEmail(r.email ?? ''); } }).catch(() => undefined).finally(() => { if (active) setEmailLoaded(true); });
    void authFetch('/api/billing/manual-checkout', { method: 'POST', body: JSON.stringify({ purpose: checkout.purpose, packId: checkout.packId, months: checkout.months || undefined }) }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(); return b.payment; }).then((p) => { if (active) { setPayment(p); setError(''); } }).catch(() => { if (active) setError('You can still send your payment proof and login email on WhatsApp. We will find your account and activate the purchase manually.'); });
    return () => { active = false; };
  }, [checkout, retry]);
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const check = async () => {
      try { const r = await authFetch(`/api/billing/payments/${payment.id}`); if (r.ok) { const b = await r.json(); setPayment(b.payment); if (b.payment.status === 'SUCCESSFUL') window.dispatchEvent(new Event('bwenge:usage')); } } catch { /* Retry on next tick. */ }
    };
    const timer = window.setInterval(() => void check(), 10000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [payment?.id, payment?.status]);
  const text = `Hello, I paid for my Bwenge upgrade: ${checkout.title}, ${rwf(payment?.amountRwf ?? checkout.amountRwf)}. Login email: ${loginEmail.trim()}.${ref?.code ? ` Account code: ${ref.code}.` : ''}${payment?.id ? ` Purchase reference: ${payment.id}.` : ''} Paid to MTN MoMo Pay ${manual.momoCode} (${manual.momoName}). I will attach my payment screenshot or confirmation SMS. Please verify and activate my purchase.`;
  const link = manual.whatsapp && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim()) ? `https://wa.me/${manual.whatsapp}?text=${encodeURIComponent(text)}` : null;
  const paid = payment?.status === 'SUCCESSFUL';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Pay manually with MTN MoMo Pay">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><h2 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>{paid ? 'Your purchase is active' : 'Pay manually with MTN MoMo Pay'}</h2><button onClick={onClose} aria-label="Close" className="p-2"><X size={18} /></button></div>
        <p className="mt-1 text-sm text-[var(--muted)]">{checkout.title}</p>
        {paid ? <div className="mt-5 space-y-3 text-sm"><CheckCircle2 className="text-emerald-500" /><p>Payment verified. Your plan or credits are ready.</p><p>Receipt {payment.receiptNumber}. Check your login email for your receipt.</p><button onClick={() => void openReceipt(payment.id)} className="underline">View receipt</button><button onClick={onDone} className="ml-4 underline">Continue to workspace</button></div> : <>
          <p className="mt-4 rounded-xl bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">Automatic MTN payment is not available. Please pay manually using the details below. We activate your purchase after verifying the payment.</p>
          <ol className="mt-4 space-y-4 text-sm text-[var(--text)]">
            <li><b>1. Pay {rwf(payment?.amountRwf ?? checkout.amountRwf)}</b><p className="mt-1">Use MTN MoMo Pay merchant code:</p><p className="mt-2 select-all rounded-xl bg-[var(--surface-2)] p-3 font-mono text-2xl font-bold tracking-wider">{manual.momoCode}</p><p className="mt-1">Confirm the recipient is <b>{manual.momoName}</b> before paying.</p></li>
            <li><b>2. Send proof on WhatsApp</b><p className="mt-1">Send your payment screenshot or confirmation SMS to <b>+{manual.whatsapp}</b>, together with your <b>login email</b> and your purchase reference if shown below. Attach the proof yourself after opening WhatsApp.</p></li>
            <li><b>3. Receive access and your receipt</b><p className="mt-1">We activate your purchase immediately after verification. Your receipt is emailed to your login email. {payment ? 'This page checks for approval automatically.' : 'Refresh Bwenge after we confirm activation.'}</p></li>
          </ol>
          <div className="mt-4 break-all rounded-xl border border-[var(--line)] p-3 text-xs"><p>Login email: <b>{loginEmail || (emailLoaded ? 'Enter below' : 'Loading…')}</b></p><p className="mt-1">Purchase reference: <span className="select-all font-mono">{payment?.id ?? 'Your login email identifies your account'}</span></p><p className="mt-1">Account code: <span className="select-all font-mono">{ref?.code ?? 'Optional'}</span></p></div>
          {emailLoaded && !ref?.email && <label className="mt-3 block text-sm">Your Bwenge login email<input type="email" autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="Enter the email you use to log in" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3" /></label>}
          {error && <div role="alert" className="mt-3 text-sm text-[var(--danger)]">{error} <button onClick={() => setRetry((n) => n + 1)} className="underline">Retry</button></div>}
          <div className="mt-5 flex flex-col gap-2">{link ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-500">I have paid · Send proof on WhatsApp</a> : <button disabled className="min-h-11 rounded-xl bg-[var(--surface-2)] text-sm opacity-60">Enter your login email to continue</button>}<button onClick={onClose} className="min-h-11 rounded-xl border border-[var(--line)] text-sm">Close</button></div>
        </>}
      </div>
    </div>
  );
}

function PlanCard({ title, icon, price, sub, features: list, action, extra, current, recommended, tag }: { title: string; icon: React.ReactNode; price: React.ReactNode; sub: string; features: string[]; action: React.ReactNode; extra?: React.ReactNode; current?: boolean; recommended?: boolean; tag?: string }) {
  return (
    <div className={`relative flex flex-col justify-between rounded-2xl border bg-[var(--surface)] p-6 shadow-sm transition-all ${recommended ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/30 shadow-lg' : 'border-[var(--line)]'}`}>
      {(tag || current) && (
        <span className={`absolute -top-3 left-6 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${current ? 'bg-[var(--teal)] text-white' : recommended ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]'}`}>{current ? 'Your plan' : tag}</span>
      )}
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${recommended ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}>{icon}</span>
          <h3 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>{title}</h3>
        </div>
        <div><div className="flex items-baseline text-[var(--text)]">{price}</div><p className="mt-1 text-xs text-[var(--muted)]">{sub}</p></div>
        {extra}
        <ul className="space-y-2 border-t border-[var(--line)] pt-4">
          {list.map((f) => <li key={f} className="flex items-start gap-2 text-xs text-[var(--text)]"><Check size={14} className="mt-0.5 shrink-0 text-[var(--teal)]" /> {f}</li>)}
        </ul>
      </div>
      <div className="mt-6">{action}</div>
    </div>
  );
}

/** Receipts need the signed-in session, so they are fetched and opened as a local page. */
export async function openReceipt(paymentId: string) {
  const res = await authFetch(`/api/billing/payments/${paymentId}/receipt`);
  if (!res.ok) return;
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
