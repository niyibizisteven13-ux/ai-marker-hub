import { useEffect, useState } from 'react';
import { authFetch } from '../utils/authFetch';
import { ArrowRight, ClipboardList, Code2, Database, GraduationCap, Store } from 'lucide-react';

interface StarterCardsProps {
  userId: string;
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

const shortcuts = { library: 'Public Dataset Library', business: 'Bwenge4Biz', forms: 'Forms & Tasks', tutor: 'Socratic Tutor' };
type Shortcut = keyof typeof shortcuts;
const shortcutIds = Object.keys(shortcuts) as Shortcut[];

function readPins(key: string): Shortcut[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null');
    if (Array.isArray(saved)) return shortcutIds.filter(id => saved.includes(id));
  } catch { /* Use the defaults when storage is unavailable. */ }
  return shortcutIds;
}

export function StarterCards({
  userId,
  onOpenPublicLibrary,
  onOpenBiz,
  onOpenForms,
  onOpenTasks,
  onStartTutor,
  tutorActive,
}: StarterCardsProps) {
  const storageKey = `bwenge.quick-access.${userId}`;
  const [pins, setPins] = useState(() => readPins(storageKey));
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [recent, setRecent] = useState<{ title: string; href: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void authFetch('/api/agent/builder/recent', { signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(item => { if (!controller.signal.aborted) setRecent(item); })
      .catch(() => {});
    return () => controller.abort();
  }, [userId]);

  function togglePin(id: Shortcut) {
    const next = pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id];
    setPins(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the in-session choice. */ }
  }

  return (
    <section aria-labelledby="home-shortcuts" className="w-full max-w-xl text-left">
      <div className="flex items-center justify-between">
        <h2 id="home-shortcuts" className="text-xs font-semibold text-[var(--app-muted)]">Quick access</h2>
        <button type="button" aria-expanded={editing} className="min-h-11 px-2 text-xs underline" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit shortcuts'}
        </button>
      </div>
      {editing && <fieldset className={`${cardClass} mb-2 grid grid-cols-2 gap-x-2`}>
        <legend className={titleClass}>Pinned shortcuts</legend>
        {shortcutIds.map(id => <label key={id} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={pins.includes(id)} onChange={() => togglePin(id)} />
          {shortcuts[id]}
        </label>)}
      </fieldset>}
      {recent && <a href={recent.href} className={`${cardClass} ${interactiveClass} mb-2 flex items-center justify-between gap-3`}>
        <span className={`min-w-0 break-words ${titleClass}`}>{recent.title}</span>
        <span className="shrink-0 text-xs font-semibold">Continue editing</span>
      </a>}
      <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3">
        <a
          href="/builder?workspace=custom"
          className={`${cardClass} ${interactiveClass} col-span-2 flex items-center gap-3`}
        >
          <span className={`${iconClass} bg-[var(--brand)]/15 text-[var(--app-text)]`}>
            <Code2 size={18} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block ${titleClass}`}>Build an app</span>
            <span className={`block ${detailClass}`}>Describe your idea and preview it on mobile or desktop.</span>
          </span>
          <ArrowRight size={16} aria-hidden="true" className="shrink-0 text-[var(--app-muted)]" />
        </a>

        {(showAll || pins.includes('library')) && <button type="button" onClick={onOpenPublicLibrary} className={tileButtonClass}>
          <span className="mb-2 flex items-start justify-between gap-2">
            <span className={`${iconClass} bg-emerald-500/15 text-emerald-600 dark:text-emerald-300`}><Database size={17} aria-hidden="true" /></span>
            <ArrowRight size={15} aria-hidden="true" className="text-[var(--app-muted)]" />
          </span>
          <span className={`block ${titleClass}`}>Public Dataset Library</span>
          <span className={`block ${detailClass}`}>Browse and use public datasets.</span>
        </button>}

        {(showAll || pins.includes('business')) && <button type="button" onClick={onOpenBiz} className={tileButtonClass}>
          <span className="mb-2 flex items-start justify-between gap-2">
            <span className={`${iconClass} bg-amber-500/15 text-amber-700 dark:text-amber-300`}><Store size={17} aria-hidden="true" /></span>
            <ArrowRight size={15} aria-hidden="true" className="text-[var(--app-muted)]" />
          </span>
          <span className={`block ${titleClass}`}>Bwenge4biz</span>
          <span className={`block ${detailClass}`}>Manage your business page, sales and stock.</span>
        </button>}

        {(showAll || pins.includes('forms')) && <div role="group" aria-labelledby="home-forms-tasks" className={cardClass}>
          <span className={`mb-2 ${iconClass} bg-sky-500/15 text-sky-700 dark:text-sky-300`}><ClipboardList size={17} aria-hidden="true" /></span>
          <h3 id="home-forms-tasks" className={titleClass}>Forms &amp; Tasks</h3>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onOpenForms} className={`${actionClass} ${interactiveClass}`}>Forms</button>
            <button type="button" onClick={onOpenTasks} className={`${actionClass} ${interactiveClass}`}>Tasks</button>
          </div>
        </div>}

        {(showAll || pins.includes('tutor')) && <button
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
        </button>}
      </div>
      {pins.length < shortcutIds.length && <button type="button" aria-expanded={showAll}
        className="min-h-11 px-2 text-sm underline" onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Show pinned shortcuts' : 'All tools'}
      </button>}
    </section>
  );
}
