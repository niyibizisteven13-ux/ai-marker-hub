import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Exams from any form link (Google Forms, Microsoft Forms, Typeform, Jotform, KoBo…), run inside the locked MySEB app.
 *
 * What MySEB CAN do for a form it does not host: lock the device, keep the student inside the form's own sites (and nowhere else),
 * pause on leaving, record everything, notice the submission, and give every student a one-line EXAM KEY that is pre-filled into the form,
 * so the teacher can tell which responses were made inside MySEB.
 * What it CANNOT do: make the form's own address secret. A form link is public, so a student could also open it in a normal browser. The
 * exam key is the answer: a response without a valid key was not made inside MySEB. See docs/FORMS.md.
 */
const P = (id, name, hosts, extra = {}) => ({ id, name, hosts, login: [], done: [], tips: [], ...extra });
export const PROVIDERS = [
  P('google', 'Google Forms', ['docs.google.com', 'forms.gle', 'forms.google.com'], {
    // docs.google.com is only a form under /forms/; the sign-in page is allowed so forms that ask for a Google account still work.
    pathOnly: { 'docs.google.com': '/forms/' }, login: ['accounts.google.com'], done: ['/formResponse'],
    keyHint: 'In Google Forms add a Short answer question called "MySEB key". Then ⋮ → Get pre-filled link, type anything in that question, press Get link, and copy the part like entry.1234567890 into "Key field" below.',
    tips: ['Settings → Responses: turn on "Collect email addresses" (Verified) and "Limit to 1 response".', 'Add a Short answer question "MySEB key" (required): MySEB fills it in for each student.', 'Turn off "Show link to submit another response" so a student cannot start a second form.'],
  }),
  P('microsoft', 'Microsoft Forms', ['forms.office.com', 'forms.microsoft.com', 'forms.cloud.microsoft'], {
    login: ['login.microsoftonline.com', 'login.live.com'],
    tips: ['Microsoft Forms stays on the same page after sending, so students press "I have submitted" in MySEB when they see the thank-you page.', 'Settings: "Only people in my organization can respond", "Record name" and "One response per person".', 'Add a Text question "MySEB key" (required) so teachers can check responses.'],
  }),
  P('typeform', 'Typeform', ['typeform.com'], { suffix: true, tips: ['Typeform stays on one page after sending: students press "I have submitted" in MySEB.', 'Add a Short text question "MySEB key" and a hidden field or answer link to match responses.'] }),
  P('jotform', 'Jotform', ['jotform.com'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the thank-you page.', 'Add a Short text field "MySEB key".'] }),
  P('surveymonkey', 'SurveyMonkey', ['surveymonkey.com'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the thank-you page.'] }),
  P('tally', 'Tally', ['tally.so'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the thank-you page.', 'Add a Short answer "MySEB key" (Tally can also fill it from the link).'] }),
  P('kobo', 'KoBoToolbox', ['kobotoolbox.org', 'enketo.org'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the form closes.'] }),
  P('zoho', 'Zoho Forms', ['zohopublic.com', 'zohopublic.eu'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the thank-you page.'] }),
  P('formstack', 'Formstack', ['formstack.com'], { suffix: true, tips: ['Students press "I have submitted" in MySEB after the thank-you page.'] }),
  P('airtable', 'Airtable form', ['airtable.com'], { pathOnly: { 'airtable.com': '/shr' }, tips: ['Students press "I have submitted" in MySEB after the thank-you page.'] }),
];

const hostMatch = (host, h, suffix) => host === h || (suffix && host.endsWith('.' + h));
const validHost = (h) => /^[a-z0-9.-]{3,100}$/.test(h) && h.includes('.') && !h.includes('..');

/** A clean https origin, or null. */
export function cleanOrigin(raw) {
  try { const u = new URL(String(raw).trim()); if (u.protocol !== 'https:' || u.username || u.password || !validHost(u.hostname)) return null; return u.origin; } catch { return null; }
}
export const cleanOrigins = (list) => [...new Set((Array.isArray(list) ? list : String(list ?? '').split(/[\s,]+/)).map(cleanOrigin).filter(Boolean))].slice(0, 12);
/** Substrings of the address that mean "the student has submitted" (for example /formResponse). Short, no control characters. */
export const cleanDone = (list) => [...new Set((Array.isArray(list) ? list : String(list ?? '').split(/\n+/)).map((s) => String(s).trim().slice(0, 120)).filter((s) => s && !/[\u0000-\u001f]/.test(s)))].slice(0, 5);
export const cleanKeyParam = (v) => { const s = String(v ?? '').trim(); return /^[A-Za-z0-9_.\-]{1,40}$/.test(s) ? s : null; };

/** Hosts whose exam pages themselves check the MySEB header (this server and bwenge.space). They get the key header; nobody else does. */
export function trustedHosts() {
  const own = (() => { try { return new URL(config.publicUrl).hostname; } catch { return ''; } })();
  return new Set([own, ...String(process.env.MYSEB_TRUSTED_HOSTS ?? 'bwenge.space,www.bwenge.space').split(',').map((s) => s.trim().toLowerCase())].filter(Boolean));
}

/** What MySEB knows about an exam address: the provider, the sites the student may use, how a submission looks, and what to tell the teacher. */
export function analyzeFormUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { return { ok: false, error: 'That is not a web address.' }; }
  if (u.username || u.password) return { ok: false, error: 'The address must not contain a user name or password.' };
  const host = u.hostname.toLowerCase();
  const own = trustedHosts().has(host);
  if (u.protocol !== 'https:' && !(own && u.protocol === 'http:') && !(u.protocol === 'http:' && !config.isProd && /^(localhost|127\.0\.0\.1)$/.test(host))) return { ok: false, error: 'The address must start with https://' };
  const prov = PROVIDERS.find((p) => p.hosts.some((h) => hostMatch(host, h, p.suffix)) && (!p.pathOnly || !p.pathOnly[host] || u.pathname.startsWith(p.pathOnly[host])));
  const origin = u.origin;
  if (prov) {
    // The form's own site, the provider's other form sites (not those limited to a path), and the sign-in sites. Nothing else.
    const hosts = prov.hosts.filter((h) => !prov.pathOnly || !prov.pathOnly[h]);
    return { ok: true, url: u.toString(), kind: 'form', provider: { id: prov.id, name: prov.name }, sendKey: false, origins: [...new Set([origin, ...hosts.map((h) => `https://${h}`), ...prov.login.map((h) => `https://${h}`)])].slice(0, 12), done: [...prov.done],
      keyHint: prov.keyHint ?? 'If your form can be pre-filled from the link, give the name of the question\'s field here, for example entry.123456 (Google) or the parameter name the tool shows.', tips: prov.tips };
  }
  return { ok: true, url: u.toString(), kind: own ? 'site' : 'form', provider: { id: own ? 'myseb' : 'custom', name: own ? 'An exam site that checks MySEB' : 'Another website' }, sendKey: own, origins: [origin], done: [],
    keyHint: 'If the form can be pre-filled from the link, give the field name here.',
    tips: own ? [] : ['This site is not a known form tool. MySEB locks the device and keeps the student on this site only. Add any extra sites it needs (for example a sign-in page) below.', 'Students press "I have submitted" in MySEB when they are done unless you set an address part that means "submitted".'] };
}

/** The short key every student gets (the same for the same session). 10 letters and digits in two groups, easy to read aloud. */
export function examKey(sessionId, secret = config.pepper) {
  const h = crypto.createHmac('sha256', secret).update(`form-key|${sessionId}`).digest();
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 10; i++) s += A[h[i] % A.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
/** The form address with the student's key filled into the field the teacher named. */
export function withKey(url, param, key) {
  const p = cleanKeyParam(param); if (!p) return url;
  try { const u = new URL(url); u.searchParams.set(p, key); return u.toString(); } catch { return url; }
}
/** True when the address means "submitted": contains one of the teacher's (or the provider's) fragments. */
export const isDone = (url, done) => { const s = String(url ?? ''); return (done ?? []).some((d) => d && s.includes(d)); };

/** What the student's app needs to lock itself to this exam. */
export const WIN_BLOCKS = ['taskmgr', 'winkey', 'lock', 'snip'];
/** Only known Windows lock choices get through. */
export const cleanWinBlock = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => WIN_BLOCKS.includes(x)))] : null);
export function lockFor(row) {
  const examOrigin = cleanOrigin(row.exam_url) ?? (() => { try { return new URL(row.exam_url).origin; } catch { return null; } })();
  const origins = [...new Set([examOrigin, ...(row.allowed_origins ?? [])].filter(Boolean))];
  return { origins, sendKey: row.send_key !== false, done: row.done_patterns ?? [], kind: row.send_key === false ? 'form' : 'site', provider: row.form_provider ?? null,
    windows: { level: row.windows_lock === 'strict' ? 'strict' : 'standard', block: cleanWinBlock(row.win_block) ?? WIN_BLOCKS } };
}
