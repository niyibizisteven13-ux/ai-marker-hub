import { useEffect, useState } from "react";
import { Spark } from "./Spark";

export type StepStatus = "running" | "done" | "error";

export interface Step {
  id: string;
  name: string;
  label: string;
  status: StepStatus;
  summary?: string;
}

interface Props {
  steps: Step[];
  /** The live line from the server. Undefined means "working, nothing to say yet": the spark shows alone. */
  current?: string;
  /** True while the reply is still being prepared. False once answer text is flowing or finished. */
  busy: boolean;
  startedAt: number;
  endedAt?: number;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const Check = () => (
  <svg className="bw-ok" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
);
const Cross = () => (
  <svg className="bw-bad" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/**
 * One line, like Claude: [spark] what is happening right now.
 * While busy the text updates in place. When the answer starts it settles into a quiet
 * summary that expands to show what was done.
 */
export function ActivityLine({ steps, current, busy, startedAt, endedAt }: Props) {
  // While working, the steps are shown as a live checklist; when done they fold into "N steps · Xs".
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? busy;
  const setOpen = (f: (o: boolean) => boolean) => setUserOpen(f(open));
  const now = useNow(busy);
  const secs = Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 1000));
  const hasDetail = steps.length > 0;

  if (!busy && !hasDetail) return null;

  const summary = `${steps.length} ${steps.length === 1 ? "step" : "steps"} · ${secs}s`;

  const line = (
    <>
      {busy ? <Spark size={18} /> : <Check />}
      {busy ? (
        <>
          {current && (
            <span key={current} className="bw-line-text bw-shimmer bw-swap" title={current}>
              {current}
            </span>
          )}
          {secs >= 2 && <span className="bw-time">{secs}s</span>}
        </>
      ) : (
        <span className="bw-line-text">{summary}</span>
      )}
      {hasDetail && (
        <svg className="bw-chev" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      )}
    </>
  );

  return (
    <div className="bw-activity" data-busy={busy} data-open={open}>
      {hasDetail ? (
        <button className="bw-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {line}
        </button>
      ) : (
        <div className="bw-line" role="status" aria-live="polite">
          {line}
        </div>
      )}
      {open && hasDetail && (
        <ul className="bw-detail">
          {steps.map((s) => (
            <li key={s.id}>
              <span className="bw-detail-icon">{s.status === "running" ? <Spark size={13} /> : s.status === "error" ? <Cross /> : <Check />}</span>
              <span>
                {s.label}
                {s.summary && <small>{s.summary}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ActivityLine;
