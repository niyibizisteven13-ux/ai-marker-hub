/**
 * Content-Security-Policy for the web app. Scripts may come only from this site (no inline or injected
 * scripts), so an XSS bug cannot run attacker code. AI-generated HTML runs in /sandbox.html instead, which has
 * its own policy: inline scripts allowed, but sandboxed, without the app's cookies and without network access.
 *
 * CSP_MODE: "enforce" (default in production), "report" (violations are only reported) or "off".
 * Development is left without a policy because the Vite dev server injects inline scripts.
 */

const APP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data: https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
].join('; ');

const SANDBOX = [
  'sandbox allow-scripts allow-downloads allow-popups',
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob: https:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** Pages that keep their own rules: the Telegram scanner (framed by Telegram) and the old scanner redirect. */
const EXEMPT = new Set(['/scanner.html', '/scan.html']);

export function contentSecurityPolicy(path: string, env: NodeJS.ProcessEnv = process.env): { header: string; value: string } | null {
  const mode = env.CSP_MODE ?? (env.NODE_ENV === 'production' ? 'enforce' : 'off');
  if (mode === 'off' || EXEMPT.has(path) || path.startsWith('/api/')) return null;
  if (path === '/sandbox.html') return { header: 'Content-Security-Policy', value: SANDBOX };
  return { header: mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', value: APP };
}
