import { api, btnGhost, download, Panel, useLoad, when, type Notify } from './adminKit';
import { StarsDisplay } from '../Stars';

/** Admin → Platform controls: ratings and survey answers from the Get the app page. Comments and contact details are only shown here. */
interface Item { id: string; at: string; app: string; rating: number; platform?: string; ease?: string; use?: string; improve?: string; contact?: string; contactOk?: boolean }
interface Data { ratings: Record<string, { count: number; average: number | null; hist: number[] }>; items: Item[] }
const APP: Record<string, string> = { bwenge: 'Bwenge', myseb: 'MySEB' };
const EASE: Record<string, string> = { very_easy: 'very easy to install', easy: 'easy to install', hard: 'difficult to install', failed: 'could not install' };
const USE: Record<string, string> = { marking: 'marking', quizzes: 'making quizzes', exams: 'taking exams', studying: 'studying', other: 'other use' };

export default function FeedbackCard({ notify }: { notify: Notify }) {
  const { data } = useLoad(async () => (await api<{ data: Data }>('/api/admin/platform/feedback')).data, notify);
  if (!data) return null;
  const total = Object.values(data.ratings).reduce((a, r) => a + r.count, 0);
  return (
    <Panel title="Ratings and feedback" hint="From the Get the app page. The public sees only the average and the number of ratings; comments and contact details are only here. People may rate once a day per app, and no address is stored.">
      {!total ? <p className="text-sm text-[#9AA6C9]">No ratings yet.</p> : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(data.ratings).map(([app, r]) => (
              <div key={app} className="rounded-xl border border-[#263052] p-3">
                <p className="text-sm font-semibold text-white">{APP[app] ?? app}</p>
                {r.average === null ? <p className="mt-1 text-xs text-[#9AA6C9]">No ratings yet</p> : (
                  <>
                    <p className="mt-1 flex items-center gap-2 text-xs text-[#C9D3F0]"><StarsDisplay value={r.average} size={14} /><b className="text-white">{r.average.toFixed(1)}</b>({r.count})</p>
                    <div className="mt-2 space-y-1">{[5, 4, 3, 2, 1].map((s) => <div key={s} className="flex items-center gap-2 text-[11px] text-[#9AA6C9]"><span className="w-3">{s}</span><div className="h-2 flex-1 rounded bg-[#1A2240]"><div className="h-2 rounded bg-amber-400/80" style={{ width: `${(r.hist[s - 1] / r.count) * 100}%` }} /></div><span className="w-6 text-right tabular-nums">{r.hist[s - 1]}</span></div>)}</div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-[#8A97C2]">Latest answers</p><button type="button" className={btnGhost} onClick={() => void download('/api/admin/platform/feedback.csv', 'app-feedback.csv').catch((e) => notify(e.message, true))}>Download CSV</button></div>
          <ul className="space-y-2">
            {data.items.slice(0, 20).map((i) => (
              <li key={i.id} className="rounded-xl border border-[#1E2848] p-3 text-xs text-[#C9D3F0]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><StarsDisplay value={i.rating} size={13} /><b className="text-white">{APP[i.app] ?? i.app}</b>{i.platform && <span>{i.platform}</span>}<span className="text-[#8A97C2]">{when(i.at)}</span></div>
                {(i.ease || i.use) && <p className="mt-1 text-[#9AA6C9]">{[i.ease && EASE[i.ease], i.use && USE[i.use]].filter(Boolean).join(' · ')}</p>}
                {i.improve && <p className="mt-1.5 whitespace-pre-wrap text-white">{i.improve}</p>}
                {i.contact && <p className="mt-1.5 text-[#9AA6C9]">Contact: <span className="text-white">{i.contact}</span> {i.contactOk ? '(agreed to be contacted)' : '(did not agree to be contacted: do not use)'}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
