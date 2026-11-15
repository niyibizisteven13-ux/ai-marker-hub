'use strict';
/**
 * POST that survives a site address change such as www.bwenge.space -> bwenge.space.
 * fetch() turns a redirected POST into a GET, which makes the exam server answer "not found". Here the redirect is followed by
 * hand and the POST is sent again, but only to the same site (www on or off, or http to https), so the exam secret never leaves it.
 * Returns the response and the base address that finally answered, so later requests go there directly.
 */
const bare = (host) => host.replace(/^www\./, '');
async function postFollowingRedirects(fetchImpl, base, pathname, init) {
  let url = base + pathname;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchImpl(url, { ...init, redirect: 'manual' });
    const next = [301, 302, 303, 307, 308].includes(res.status) ? res.headers.get('location') : null;
    if (!next) return { res, base: url.slice(0, url.length - pathname.length) };
    const to = new URL(next, url), from = new URL(url);
    if (bare(to.hostname) !== bare(from.hostname) || !['http:', 'https:'].includes(to.protocol)) return { res, base: url.slice(0, url.length - pathname.length) };
    if (!to.pathname.endsWith(pathname)) return { res, base: url.slice(0, url.length - pathname.length) };
    url = to.href;
  }
  throw new Error('too many redirects');
}
module.exports = { postFollowingRedirects };
