import { ArrowRight, ClipboardList, Database, GraduationCap, Store } from 'lucide-react';

interface StarterCardsProps {
  onOpenPublicLibrary: () => void;
  onOpenBiz: () => void;
  onOpenForms: () => void;
  onOpenTasks: () => void;
  onStartTutor: () => void;
  tutorActive: boolean;
}

const cardClass = 'min-w-0 rounded-2xl border border-[var(--app-text)]/10 bg-[var(--app-panel)] p-3 text-left sm:p-4';
const interactiveClass = 'transition-colors hover:border-[var(--app-text)]/25 hover:bg-[var(--app-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]';
const iconClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9';
const tileButtonClass = `${cardClass} ${interactiveClass} flex flex-col items-stretch`;
const titleClass = 'text-[13px] font-semibold leading-snug text-[var(--app-text)] sm:text-sm';
const detailClass = 'mt-1 text-xs leading-snug text-[var(--app-muted)]';
const actionClass = 'flex min-h-11 min-w-0 items-center justify-center rounded-lg border border-[var(--app-text)]/10 px-1.5 text-xs font-semibold text-[var(--app-text)]';

export function StarterCards({
  onOpenPublicLibrary,
  onOpenBiz,
  onOpenForms,
  onOpenTasks,
  onStartTutor,
  tutorActive,
}: StarterCardsProps) {
  return (
    <section aria-labelledby="home-shortcuts" className="w-full max-w-xl text-left">
      <h2 id="home-shortcuts" className="mb-2.5 text-xs font-semibold text-[var(--app-muted)]">Quick access</h2>
      <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3">
        <button type="button" onClick={onOpenPublicLibrary} className={tileButtonClass}>
          <span className="mb-2 flex items-start justify-between gap-2">
            <span className={`${iconClass} bg-emerald-500/15 text-emerald-600 dark:text-emerald-300`}><Database size={17} aria-hidden="true" /></span>
            <ArrowRight size={15} aria-hidden="true" className="text-[var(--app-muted)]" />
          </span>
          <span className={`block ${titleClass}`}>Public Dataset Library</span>
          <span className={`block ${detailClass}`}>Browse and use public datasets.</span>
        </button>

        <button type="button" onClick={onOpenBiz} className={tileButtonClass}>
          <span className="mb-2 flex items-start justify-between gap-2">
            <span className={`${iconClass} bg-amber-500/15 text-amber-700 dark:text-amber-300`}><Store size={17} aria-hidden="true" /></span>
            <ArrowRight size={15} aria-hidden="true" className="text-[var(--app-muted)]" />
          </span>
          <span className={`block ${titleClass}`}>Bwenge4biz</span>
          <span className={`block ${detailClass}`}>Manage your business page, sales and stock.</span>
        </button>

        <div role="group" aria-labelledby="home-forms-tasks" className={cardClass}>
          <span className={`mb-2 ${iconClass} bg-sky-500/15 text-sky-700 dark:text-sky-300`}><ClipboardList size={17} aria-hidden="true" /></span>
          <h3 id="home-forms-tasks" className={titleClass}>Forms &amp; Tasks</h3>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onOpenForms} className={`${actionClass} ${interactiveClass}`}>Forms</button>
            <button type="button" onClick={onOpenTasks} className={`${actionClass} ${interactiveClass}`}>Tasks</button>
          </div>
        </div>

        <button
          type="button"
          onClick={onStartTutor}
          aria-pressed={tutorActive}
          className={`${tileButtonClass} aria-pressed:border-[var(--brand)]`}
        >
          <span className="mb-2 flex items-start justify-between gap-2">
            <span className={`${iconClass} bg-violet-500/15 text-violet-700 dark:text-violet-300`}><GraduationCap size={17} aria-hidden="true" /></span>
            <ArrowRight size={15} aria-hidden="true" className="text-[var(--app-muted)]" />
          </span>
          <span className={`block ${titleClass}`}>Socratic Tutor</span>
          <span className={`block ${detailClass}`}>Work through a question with guided hints.</span>
        </button>
      </div>
    </section>
  );
}
