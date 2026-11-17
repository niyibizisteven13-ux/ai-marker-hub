import { api, Panel, useLoad, type Notify } from './adminKit';

/** Admin → Platform controls: how many times the apps were downloaded or installed from the "Get the app" page. */
interface Data { rows: Array<{ app: string; platform: string; click: number; installed: number; last7: number; last30: number }>; total: { click: number; installed: number }; days: Array<{ day: string; click: number; installed: number }> }
const APP: Record<string, string> = { bwenge: 'Bwenge (installable app)', myseb: 'MySEB (exam app)' };
const DEVICE: Record<string, string> = { android: 'Android', ios: 'iPhone / iPad', windows: 'Windows', mac: 'Mac', linux: 'Linux' };

export default function DownloadsCard({ notify }: { notify: Notify }) {
  const { data } = useLoad(async () => (await api<{ data: Data }>('/api/admin/platform/downloads')).data, notify);
  if (!data) return null;
  const max = Math.max(1, ...data.days.map((d) => d.click));
  return (
    <Panel title="App downloads" hint="Presses of Download and Install on the Get the app page. “Installed” is when the browser confirms Bwenge was installed. The same person pressing twice within a minute counts once.">
      {!data.rows.length ? <p className="text-sm text-[#9AA6C9]">No downloads yet.</p> : (
        <div className="space-y-4">
          <p className="text-sm text-white"><b className="text-lg">{data.total.click.toLocaleString('en-US')}</b> downloads · <b>{data.total.installed.toLocaleString('en-US')}</b> confirmed installs</p>
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-[#8A97C2]">{['App', 'Device', 'Downloads', 'Installed', '7 days', '30 days'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.app + r.platform} className="border-t border-[#1E2848] text-[#C9D3F0]"><td className="px-2 py-1.5">{APP[r.app] ?? r.app}</td><td className="px-2">{DEVICE[r.platform] ?? r.platform}</td><td className="px-2 tabular-nums font-semibold text-white">{r.click}</td><td className="px-2 tabular-nums">{r.installed}</td><td className="px-2 tabular-nums">{r.last7}</td><td className="px-2 tabular-nums">{r.last30}</td></tr>)}</tbody></table></div>
          {data.days.length > 0 && <div className="flex h-16 items-end gap-1" aria-label="Downloads per day, last 30 days">{data.days.map((d) => <div key={d.day} title={`${d.day}: ${d.click}`} className="flex-1 rounded-t bg-amber-400/70" style={{ height: `${Math.max(6, (d.click / max) * 100)}%` }} />)}</div>}
        </div>
      )}
    </Panel>
  );
}
