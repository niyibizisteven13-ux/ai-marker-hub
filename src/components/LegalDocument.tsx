import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { PublicFooter, PublicHeader, PublicPage, SUPPORT_EMAIL } from './PublicChrome';

/**
 * A legal document (Terms, Privacy): a readable column about 68 characters wide, a contents list that follows the reading position on large
 * screens (and folds away on phones), anchors that can be linked, and clean printing. The wording is the owner's and is passed in unchanged.
 */
export interface LegalSection { id: string; title: string; body: ReactNode }
export default function LegalDocument({ title, summary, updated, sections, other }: { title: string; summary: string; updated: string; sections: LegalSection[]; other: { label: string; href: string } }) {
  const [active, setActive] = useState(sections[0]?.id ?? '');
  useEffect(() => { document.title = `${title} · Bwenge`; }, [title]);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!('IntersectionObserver' in window) || !els.length) return;
    const io = new IntersectionObserver((entries) => { const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (vis) setActive(vis.target.id); }, { rootMargin: '-80px 0px -65% 0px' });
    els.forEach((e) => io.observe(e)); return () => io.disconnect();
  }, [sections]);

  const toc = (cls: string) => (
    <ol className={cls}>
      {sections.map((s) => (
        <li key={s.id}><a href={`#${s.id}`} aria-current={active === s.id ? 'true' : undefined} className={`block rounded-md border-l-2 py-1.5 pl-3 pr-2 text-[13px] leading-snug transition-colors ${active === s.id ? 'border-[var(--brand)] text-[var(--app-text)]' : 'border-transparent text-[var(--app-faint)] hover:text-[var(--app-text)]'}`}>{s.title}</a></li>
      ))}
    </ol>
  );

  return (
    <PublicPage>
      <PublicHeader right={<a href={other.href} className="rounded-lg px-3 py-2 hover:text-[var(--app-text)]">{other.label}</a>} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <a href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--app-faint)] hover:text-[var(--app-text)] print:hidden"><ArrowLeft size={15} />Back to Bwenge</a>
        <div className="grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="print:hidden lg:sticky lg:top-24 lg:self-start">
            <details className="rounded-xl border border-[var(--app-line)] p-3 lg:hidden"><summary className="cursor-pointer text-sm font-medium">Contents</summary>{toc('mt-2 space-y-0.5')}</details>
            <nav aria-label="Contents" className="hidden lg:block"><p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-faint)]">On this page</p>{toc('space-y-0.5')}</nav>
          </aside>

          <article className="max-w-[68ch]">
            <header className="border-b border-[var(--app-line)] pb-8">
              <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
              <p className="mt-4 text-base leading-relaxed text-[var(--app-muted)]">{summary}</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--app-faint)]">
                <span>Last updated <time className="text-[var(--app-muted)]">{updated}</time></span>
                <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md hover:text-[var(--app-text)] print:hidden"><Printer size={13} />Print or save as PDF</button>
              </div>
            </header>
            <div className="divide-y divide-[var(--app-line)]">
              {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-24 py-8 first:pt-10">
                  <h2 className="font-display text-xl font-semibold tracking-tight">{s.title}</h2>
                  <div className="mt-3 text-[15.5px] leading-[1.75] text-[var(--app-muted)] print:text-black [&_a]:text-[var(--app-text)] [&_a]:underline [&_a]:decoration-[var(--brand)] [&_a]:decoration-2 [&_a]:underline-offset-4 hover:[&_a]:text-[var(--brand)]">{s.body}</div>
                </section>
              ))}
            </div>
            <p className="mt-6 text-sm text-[var(--app-faint)]">Questions about this document? <a className="text-[var(--app-text)] underline decoration-[var(--brand)] decoration-2 underline-offset-4" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p>
          </article>
        </div>
      </main>
      <PublicFooter />
    </PublicPage>
  );
}
