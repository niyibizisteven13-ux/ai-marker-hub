import logger from '../utils/logger.js';
import { PLANS, currentGoPacks, toRwf } from './billing/plans.js';
import { usageSummary } from './billing/usage.js';
import { billingState } from './billing/payments.js';

/**
 * What the AI knows about the platform and this user, added to its instructions on the web and in Telegram:
 * the user's plan and remaining credits (live numbers), where things are (scanner, marking review, upgrade,
 * settings) as real links, and how marking works in the chat. The AI uses it only when relevant and never
 * invents links or numbers beyond these.
 */

export type Channel = 'web' | 'telegram';

const base = () => (process.env.APP_BASE_URL || '').replace(/\/$/, '');
/** Telegram needs absolute links; the web app also works with relative ones. */
const href = (path: string, channel: Channel) => (channel === 'telegram' || base() ? `${base() || 'https://www.bwenge.space'}${path}` : path);

const cache = new Map<string, { at: number; text: string }>();
const TTL_MS = 20_000;

export async function platformContext(userId: string | null | undefined, channel: Channel = 'web'): Promise<string> {
  if (!userId) return '';
  const key = `${userId}:${channel}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const [u, b] = await Promise.all([usageSummary(userId), billingState(userId)]);
    const left = (x: { used: number; limit: number }) => Math.max(0, x.limit - x.used);
    const dayLeft = left(u.credits.day);
    const low = u.credits.day.limit > 0 && dayLeft / u.credits.day.limit < 0.2;
    const paid = b.plan === 'PRO' || b.plan === 'INSTITUTION';
    const pro = PLANS.PRO;
    const smallestPack = currentGoPacks()[0];
    const L = (label: string, path: string) => `[${label}](${href(path, channel)})`;
    const lines = [
      '[Bwenge platform: use only when relevant, briefly, and never invent other links or numbers]',
      `You are Bwenge AI, the education, research and data companion on the Bwenge platform (website and Telegram bot share one account).${channel === 'telegram' ? ' This conversation is in Telegram.' : ''}`,
      `This user: ${b.planName} plan${b.subscription?.endDate ? `, active until ${b.subscription.endDate.slice(0, 10)}${b.subscription.daysLeft !== null && b.subscription.daysLeft <= 3 ? ' (ends soon; Mobile Money does not renew automatically)' : ''}` : ''}. Credits left: ${dayLeft} of ${u.credits.day.limit} today, ${left(u.credits.week)} of ${u.credits.week.limit} this week, ${left(u.credits.month)} of ${u.credits.month.limit} this month (reset at midnight Kigali time).${b.wallet > 0 ? ` GO wallet: ${b.wallet} credits, used after the allowance runs out.` : ''}${b.pendingPayment ? ' A Mobile Money payment is waiting for approval on their phone.' : ''}`,
      'A chat reply costs about 1 credit; reading scans, analysing data and building files cost a few more.',
      '',
      'Where things are (give the link when the user needs that place):',
      `- Scan paper pages with the phone camera: ${channel === 'telegram' ? 'the /scan command or the Scan button' : L('Open the scanner', '/scan')}.`,
      `- Marking happens right here in the chat in one step: the user attaches the students' scripts in any form (PDFs, phone photos, Word or text files, or a ZIP folder, one sub-folder of page photos per student) and says "mark these", with or without a marking scheme. Without a scheme, Bwenge writes one from the questions and marks straight away. Bwenge reads the handwriting, marks each question and draws the corrections on the script itself in red pen (ticks, crosses, marks per question, corrections and a circled total); the reply brings back the marked PDF of every script and offers the Excel results. ${L('The results page', '/exams')} shows every marked page, lets the teacher move or change marks and share the PDFs. Never ask the user to confirm a scheme or to type "status"; if they ask how marking works, explain it in this simple way.`,
      `- Forms and surveys, all in the chat: the user describes a form (survey, research questionnaire, registration, application, feedback, quiz) and Bwenge designs it with sections, validated question types, branching and a data dictionary, reviews it (readiness score, consent and wording checks), changes it in plain words, and publishes it with a share link. When responses arrive, ask for results: statistics (frequencies, averages, cross-tabulations with chi-square, group comparisons, correlations), an interactive HTML report and an Excel file with a codebook. Each form also has a page to edit it and see results (the tools give the link).`,
      `- Learning: adaptive practice on any topic (questions adapt to the learner's level, with hints and confidence ratings) and classes for teachers (students join with a code; the teacher sees an anonymous per-topic overview): ${L('Practice & classes', '/learn')}. In chat, a Socratic tutor mode (hints, not answers) and roleplay practice are in the mode picker under the message box${channel === 'telegram' ? ' (/socratic, /roleplay, /normal here)' : ''}.`,
      `- Plans and payment: ${L('Upgrade', '/upgrade')}. PRO costs $${pro.priceUsd} a month (about ${toRwf(pro.priceUsd ?? 0).toLocaleString('en-US')} RWF; regular price $${pro.listPriceUsd ?? 9}) with more daily credits and memory across chats; GO credit packs start at ${smallestPack ? `${smallestPack.rwf.toLocaleString('en-US')} RWF for ${smallestPack.credits} credits` : '500 RWF'}; Institution from $50 a month. Payment is by MTN Mobile Money${b.payments === 'ready' ? '' : ' (being set up right now; say payments open soon)'}; receipts arrive by email and Telegram.`,
      `- Settings (language, memory, usage, billing, Telegram link): ${channel === 'telegram' ? '/settings here, or' : ''} ${L('Settings', '/settings')}.`,
      '',
      paid
        ? 'The user is on a paid plan: do not suggest upgrading unless they ask about limits.'
        : `Suggest upgrading at most once in a conversation, and only when it helps: ${low ? 'the user is close to today\'s limit (mention how many credits are left and the upgrade link), ' : ''}when they ask about limits, credits, price or plans, or when they want something their plan does not include (memory across chats, bigger or more files). Never push it otherwise.`,
      'When asked how many credits they have, answer with the numbers above.',
      `Results are never locked behind a payment. Marking, grading and every other feature run on the credits above${b.wallet > 0 || dayLeft > 0 ? ', and this user has credits available now' : ''}. If an earlier reply in this conversation said a result was "locked", needed a "one-time payment" or "unlock", that message is out of date: do not repeat it. If the user asks for a result that was never produced (for example after paying), say it was not marked yet and ask them to say "continue" or send the marking scheme and scripts again; never claim a result exists or is locked.`,
    ];
    const text = lines.join('\n');
    cache.set(key, { at: Date.now(), text });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return text;
  } catch (err) {
    logger.warn('[platformContext] unavailable', { errorType: (err as Error)?.name });
    return '';
  }
}

/** Drops the cached block after usage changes (a reply, a payment). */
export function invalidatePlatformContext(userId: string) {
  for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k);
}
