'use strict';
/**
 * The page lock for an exam that lives on a form tool (Google Forms and others): the student may stay on the exam's own sites and nowhere else.
 * Pure functions, so they are tested without Electron.
 */
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
/** The lock the server sent with the exam (or, for older servers, just the exam's own origin). */
function lockOf(data) {
  const origins = new Set(((data && data.lock && data.lock.origins) || []).filter((o) => typeof o === 'string'));
  const examOrigin = originOf(data && data.examUrl); if (examOrigin) origins.add(examOrigin);
  const l = (data && data.lock) || {};
  return { origins, examOrigin, sendKey: l.sendKey !== false, kind: l.kind === 'form' ? 'form' : 'site', done: Array.isArray(l.done) ? l.done.filter((d) => typeof d === 'string' && d).slice(0, 5) : [] };
}
/** May the page go to this address? Only https/http pages on an allowed site (plus blank, data and blob pages the page itself needs). */
const allowed = (url, lock) => /^(about:|data:|blob:)/.test(url) || (!!lock && lock.origins.has(originOf(url)));
/** Does this address mean the student has submitted the form? */
const isDone = (url, lock) => !!lock && lock.done.some((d) => String(url).includes(d));
/** What goes in the violation log for a blocked page: the site only, never the whole address (it can hold personal data). */
const hostOf = (url) => { try { return new URL(url).hostname.slice(0, 80); } catch { return 'unknown'; } };
module.exports = { lockOf, allowed, isDone, hostOf, originOf };
