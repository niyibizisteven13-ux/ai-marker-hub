import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Building2, Check, CheckCircle2, Coins, Loader2, Lock, ShieldCheck, Smartphone, Sparkles, X, Zap } from 'lucide-react';
import { authFetch } from '../utils/authFetch';
import OrganisationRequestDialog from '../components/OrganisationRequestDialog';

/**
 * Upgrade: Free, GO (pay as you go credit packs), PRO (launch price with the regular price struck through)
 * and Institution. Prices come from the server (admin-editable) in USD with Rwandan franc equivalents; payment
 * is MTN Mobile Money: the user approves on their phone and the page follows the payment until MTN confirms.
 */

interface PlanLimits { daily: number; weekly: number; monthly: number; perDay: { tool: number; vision: number; artifact: number; marking: number }; maxUploadMb: number; maxAttachments: number; memory: boolean; memoryItems: number }
interface Pack { id: string; rwf: number; credits: number; usd: number }
interface PlansResponse {
  fxUsdRwf: number; payments: 'live' | 'sandbox' | 'simulated' | 'off';
  plans: Array<{ id: 'FREE' | 'GO' | 'PRO' | 'INSTITUTION'; name: string; priceUsd: number | null; listPriceUsd?: number | null; priceRwf: number | null; listPriceRwf?: number | null; period: string; limits: PlanLimits; packs?: Pack[]; seats?: number }>;
}
interface Me { plan: 'FREE' | 'GO' | 'PRO' | 'INSTITUTION'; planName: string; wallet: number; subscription: { endDate: string | null; daysLeft: number | null } | null; usage: { day: { used: number; limit: number } } }
interface Payment { id: string; status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'EXPIRED'; amountRwf: number; currency: string; receiptNumber: string | null; reason: string | null; phoneMasked: string; purpose: string; credits: number; months: number }
type Checkout = { purpose: 'PRO' | 'GO_PACK' | 'INSTITUTION'; packId?: string; months: number; title: string; amountRwf: number; amountUsd: number };

interface UpgradePageProps {
  jobId?: string;
  service?: string;
  targetPlan?: string;
  onBack: () => void;
  onSuccess: () => void;
}

const SERIF = "font-['Georgia','Tiempos_Headline','Times_New_Roman',serif]";
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const REASONS: Record<string, { title: string; body: string }> = {
  limit: { title: 'You have reached your limit', body: 'Upgrade to PRO for more credits every day, or buy GO credits to keep going right now.' },
  usage: { title: 'Get more out of Bwenge', body: 'PRO gives you six times the daily credits, memory across all chats and larger files.' },
  memory: { title: 'Memory across all chats is part of PRO', body: 'Bwenge remembers who you are, how you like answers and what you worked on, on the web and in Telegram.' },
};

function features(id: string, l: PlanLimits, packs?: Pack[]): string[] {
  if (id === 'GO') return [`Free daily allowance plus credits you buy`, `Packs from ${rwf(packs?.[0]?.rwf ?? 500)}, valid 12 months`, 'No daily cap while you have credits', `Uploads up to ${l.maxUploadMb} MB`];
  return [
    `${l.daily.toLocaleString('en-US')} credits a day · ${l.monthly.toLocaleString('en-US')} a month`,
    `${l.perDay.tool} data & tool answers a day`,
    `${l.perDay.vision} scan and image reads a day`,
    `${l.perDay.artifact} files, charts & dashboards a day`,
    l.memory ? `Memory across all chats (${l.memoryItems.toLocaleString('en-US')})` : 'No memory across chats',
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
  const pro = plan('PRO');
  const go = plan('GO');
  const inst = plan('INSTITUTION');
  const free = plan('FREE');
  const pack = go?.packs?.find((p) => p.id === packId);
  const discount = pro?.listPriceUsd && pro.priceUsd ? Math.round((1 - pro.priceUsd / pro.listPriceUsd) * 100) : 0;
  const paymentsOff = data?.payments === 'off';
  const current = me?.plan ?? 'FREE';

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-y-auto bg-[var(--bg)] font-sans text-[var(--text)] antialiased upgrade-scrollbar">
      {orgOpen && <OrganisationRequestDialog isOpen={orgOpen} onClose={() => setOrgOpen(false)} />}
      {checkout && <CheckoutDialog checkout={checkout} onClose={() => setCheckout(null)} onDone={onSuccess} />}

      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)]/90 px-4 py-4 backdrop-blur sm:px-8">
        <button onClick={onBack} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]">
          <ArrowLeft size={16} /> <span className="text-sm font-medium">Back to workspace</span>
        </button>
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
          <ShieldCheck size={14} className="text-[var(--teal)]" /> Secure MTN Mobile Money
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
          <p className="text-sm leading-relaxed text-[var(--muted)]">Pay with MTN Mobile Money. Prices are in US dollars with the Rwandan franc amount you pay{data ? ` (1 USD ≈ ${data.fxUsdRwf.toLocaleString('en-US')} RWF)` : ''}.</p>
          {me && (
            <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-1.5 text-xs text-[var(--muted)]">
              You are on <b className="text-[var(--text)]">{me.planName}</b>
              {me.subscription?.endDate && <span>· until {new Date(me.subscription.endDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
              <span>· {Math.max(0, me.usage.day.limit - me.usage.day.used)} of {me.usage.day.limit} credits left today</span>
              {me.wallet > 0 && <span>· {me.wallet.toLocaleString('en-US')} GO credits</span>}
            </div>
          )}
        </div>

        {paymentsOff && (
          <div className="mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" /> Mobile Money payments are being set up. Plans can be activated by an administrator in the meantime.
          </div>
        )}
        {loadError && <p role="alert" className="text-center text-sm text-[var(--danger)]">{loadError}</p>}
        {!data && !loadError && <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--accent)]" /></div>}

        {data && free && go && pro && inst && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {/* Free */}
            <PlanCard title="Free" icon={<Zap size={18} />} current={current === 'FREE'}
              price={<><span className={`${SERIF} text-4xl`}>$0</span></>} sub="Free forever"
              features={features('FREE', free.limits)}
              action={<button disabled className="min-h-[46px] w-full rounded-xl bg-[var(--surface-2)] py-3 text-sm font-medium text-[var(--muted)]">{current === 'FREE' ? 'Your current plan' : 'Included'}</button>} />

            {/* GO */}
            <PlanCard title="GO" icon={<Coins size={18} />} current={current === 'GO'} tag="Pay as you go"
              price={<><span className={`${SERIF} text-4xl`}>{pack ? rwf(pack.rwf).replace(' RWF', '') : '500'}</span><span className="ml-1 text-sm text-[var(--muted)]">RWF</span></>}
              sub={pack ? `${pack.credits.toLocaleString('en-US')} credits · ≈ ${usd(pack.usd)}` : 'Credit packs'}
              features={features('GO', go.limits, go.packs)}
              extra={
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="GO credit pack">
                  {go.packs!.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={p.id === packId} onClick={() => setPackId(p.id)}
                      className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${p.id === packId ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                      <b className="block text-xs">{rwf(p.rwf)}</b>{p.credits.toLocaleString('en-US')} credits
                    </button>
                  ))}
                </div>
              }
              action={<button disabled={paymentsOff || !pack} onClick={() => pack && setCheckout({ purpose: 'GO_PACK', packId: pack.id, months: 0, title: `GO credits · ${pack.credits.toLocaleString('en-US')} credits`, amountRwf: pack.rwf, amountUsd: pack.usd })}
                className="min-h-[46px] w-full rounded-xl bg-[var(--surface-2)] py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--hover)] disabled:opacity-50">Buy {pack ? rwf(pack.rwf) : 'credits'}</button>} />

            {/* PRO */}
            <PlanCard title="PRO" icon={<Sparkles size={18} />} current={current === 'PRO'} recommended tag={discount ? `Launch offer −${discount}%` : 'Most popular'}
              price={<>
                {pro.listPriceUsd ? <span className="mr-2 text-xl text-[var(--muted)] line-through">{usd(pro.listPriceUsd)}</span> : null}
                <span className={`${SERIF} text-4xl`}>{usd(pro.priceUsd ?? 0)}</span><span className="ml-1 text-sm text-[var(--muted)]">/ month</span>
              </>}
              sub={`≈ ${rwf((pro.priceRwf ?? 0) * months)}${months > 1 ? ` for ${months} months` : ' a month'}${pro.listPriceRwf ? ` (was ${rwf(pro.listPriceRwf)})` : ''}`}
              features={features('PRO', pro.limits)}
              extra={
                <div className="flex gap-1.5" role="radiogroup" aria-label="Months">
                  {[1, 3, 6, 12].map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={m === months} onClick={() => setMonths(m)}
                      className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors ${m === months ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{m} mo</button>
                  ))}
                </div>
              }
              action={<button disabled={paymentsOff} onClick={() => setCheckout({ purpose: 'PRO', months, title: `PRO plan · ${months} month${months > 1 ? 's' : ''}`, amountRwf: (pro.priceRwf ?? 0) * months, amountUsd: (pro.priceUsd ?? 0) * months })}
                className="min-h-[46px] w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50">
                {current === 'PRO' ? 'Extend PRO' : 'Upgrade to PRO'} · {rwf((pro.priceRwf ?? 0) * months)}
              </button>} />

            {/* Institution */}
            <PlanCard title="Institution" icon={<Building2 size={18} />} current={current === 'INSTITUTION'} tag={`${inst.seats ?? 25} seats`}
              price={<><span className={`${SERIF} text-4xl`}>{usd(inst.priceUsd ?? 50)}+</span><span className="ml-1 text-sm text-[var(--muted)]">/ month</span></>}
              sub={`≈ ${rwf(inst.priceRwf ?? 0)}+ a month · schools & organisations`}
              features={[...features('INSTITUTION', inst.limits).slice(0, 5), 'Admin dashboard, shared datasets & invoices']}
              action={<button onClick={() => setOrgOpen(true)} className="min-h-[46px] w-full rounded-xl border border-[var(--line)] py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--hover)]">Talk to us</button>} />
          </div>
        )}

        <section className="mx-auto grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['What is a credit?', 'A chat reply is 1 credit. Heavier work (reading scans, analysing data, building files) uses a few, based on its real AI cost.'],
            ['How do I pay?', 'Enter your MTN MoMo number, then approve the prompt on your phone with your PIN. Your plan or credits are added as soon as MTN confirms.'],
            ['Receipts and renewal', 'A receipt is emailed and sent to Telegram. Mobile Money never renews automatically: we remind you 3 days before PRO ends.'],
          ].map(([q, a]) => (
            <div key={q} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><h3 className="text-sm font-semibold text-[var(--text)]">{q}</h3><p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{a}</p></div>
          ))}
        </section>
      </main>
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

/** Phone number → MTN prompt → live status until MTN confirms (or declines). */
function CheckoutDialog({ checkout, onClose, onDone }: { checkout: Checkout; onClose: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'form' | 'starting' | 'pending' | 'success' | 'failed'>('form');
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const poll = (id: string, n = 0) => {
    timer.current = window.setTimeout(async () => {
      try {
        const res = await authFetch(`/api/billing/payments/${id}`);
        const body = await res.json();
        const p: Payment | undefined = body.payment;
        if (p) setPayment(p);
        if (p?.status === 'SUCCESSFUL') { setState('success'); window.dispatchEvent(new Event('bwenge:usage')); return; }
        if (p && (p.status === 'FAILED' || p.status === 'EXPIRED')) {
          setState('failed');
          setError(p.reason === 'NOT_ENOUGH_FUNDS' ? 'There is not enough balance on this Mobile Money account.' : p.status === 'EXPIRED' ? 'The payment was not approved in time.' : 'The payment was declined or did not go through. No money was taken.');
          return;
        }
      } catch { /* retry */ }
      if (n < 90) poll(id, n + 1);
      else { setState('failed'); setError('We could not confirm the payment yet. If you approved it, it will appear shortly; you will get a receipt by email.'); }
    }, 3000);
  };

  const pay = async () => {
    setError(null);
    setState('starting');
    try {
      const res = await authFetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: checkout.purpose, packId: checkout.packId, months: checkout.months || undefined, phone }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'The payment could not start.');
      setPayment(body.payment);
      setState('pending');
      poll(body.payment.id);
    } catch (e) {
      setState('form');
      setError(e instanceof Error ? e.message : 'The payment could not start.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Pay with Mobile Money">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className={`${SERIF} text-2xl font-normal text-[var(--text)]`}>{state === 'success' ? 'Payment received' : 'Pay with MTN MoMo'}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{checkout.title}</p>
          </div>
          {state !== 'pending' && <button onClick={state === 'success' ? onDone : onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)]"><X size={16} /></button>}
        </div>

        <div className="mb-5 flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3">
          <span className="text-xs text-[var(--muted)]">Total</span>
          <span className="text-right"><b className="text-lg text-[var(--text)]">{rwf(checkout.amountRwf)}</b><span className="block text-[11px] text-[var(--muted)]">≈ {usd(checkout.amountUsd)}</span></span>
        </div>

        {(state === 'form' || state === 'starting') && (
          <form onSubmit={(e) => { e.preventDefault(); void pay(); }} className="space-y-3">
            <label className="block text-xs font-medium text-[var(--muted)]">MTN Mobile Money number
              <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 focus-within:border-[var(--accent)]">
                <Smartphone size={16} className="text-[var(--muted)]" />
                <input autoFocus inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="078 123 4567" aria-label="MTN Mobile Money number"
                  className="min-w-0 flex-1 bg-transparent py-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none" />
              </div>
            </label>
            {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
            <button type="submit" disabled={state === 'starting' || phone.replace(/\D/g, '').length < 9} className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">
              {state === 'starting' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Pay {rwf(checkout.amountRwf)}
            </button>
            <p className="text-center text-[11px] text-[var(--muted)]">You will get a prompt on your phone. Approve it with your MoMo PIN.</p>
          </form>
        )}

        {state === 'pending' && (
          <div className="space-y-3 py-2 text-center">
            <Loader2 size={30} className="mx-auto animate-spin text-[var(--accent)]" />
            <p className="text-sm font-medium text-[var(--text)]">Approve the payment on your phone</p>
            <p className="text-xs text-[var(--muted)]">We sent a request to {payment?.phoneMasked}. Enter your MoMo PIN to confirm. This page updates by itself.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="space-y-3 py-2 text-center">
            <CheckCircle2 size={34} className="mx-auto text-[var(--teal)]" />
            <p className="text-sm font-medium text-[var(--text)]">{checkout.purpose === 'GO_PACK' ? `${payment?.credits?.toLocaleString('en-US')} credits were added.` : 'Your PRO plan is active.'}</p>
            {payment?.receiptNumber && <p className="text-xs text-[var(--muted)]">Receipt {payment.receiptNumber}. A copy was sent to your email{payment ? ' and Telegram (if connected)' : ''}.</p>}
            <div className="flex gap-2">
              {payment && <button type="button" onClick={() => void openReceipt(payment.id)} className="flex-1 rounded-xl border border-[var(--line)] py-2.5 text-sm text-[var(--text)]">View receipt</button>}
              <button onClick={onDone} className="flex-1 rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-[var(--on-accent)]">Continue</button>
            </div>
          </div>
        )}

        {state === 'failed' && (
          <div className="space-y-3 py-2 text-center">
            <AlertCircle size={30} className="mx-auto text-[var(--danger)]" />
            <p className="text-sm text-[var(--text)]">{error}</p>
            <button onClick={() => { setState('form'); setError(null); }} className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-[var(--on-accent)]">Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
