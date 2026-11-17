import type { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

/**
 * The frame shared by the public pages (legal documents, Get the app, MySEB): one header, one footer, the brand's ink background.
 * Colours come from the theme variables, so a page looks the same wherever it is opened.
 */
export const SUPPORT_EMAIL = 'support@bwenge.space';

export function PublicHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--app-line)] bg-[var(--app-bg)]/90 backdrop-blur print:hidden">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="/" className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" aria-label="Bwenge home">
          <span className="h-9 w-9 shrink-0"><BrandLogo /></span>
          <span className="font-display text-lg font-semibold tracking-tight text-[var(--app-text)]">Bwenge</span>
        </a>
        <div className="flex items-center gap-1 text-sm text-[var(--app-muted)]">{right}</div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  const link = 'rounded px-1 py-0.5 hover:text-[var(--app-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]';
  return (
    <footer className="border-t border-[var(--app-line)] print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-xs text-[var(--app-faint)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>© 2026 Bwenge</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          <a className={link} href="/terms">Terms</a><a className={link} href="/privacy">Privacy</a><a className={link} href="/get-app">Get the app</a><a className={link} href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
        </nav>
      </div>
    </footer>
  );
}

/** Page background, text colour and font for a public page. */
export function PublicPage({ children }: { children: ReactNode }) {
  return <div className="flex h-[100dvh] flex-col overflow-y-auto bg-[var(--app-bg)] font-sans text-[var(--app-text)] antialiased print:bg-white print:text-black">{children}</div>;
}
