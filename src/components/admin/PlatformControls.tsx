import { useEffect, useState } from 'react';
import DownloadsCard from './DownloadsCard';
import FeedbackCard from './FeedbackCard';
import { api, btnGhost, btnPrimary, input, Panel, Toggle, useAct, useLoad, when, type Notify } from './adminKit';

/** Admin → Platform controls: switches for chat abilities and MySEB, maintenance mode, the announcement banner, blocked addresses and retention. */
interface Flag { id: string; label: string; hint: string; group: string; on: boolean }
interface Data {
  settings: { maintenance: { on: boolean; message: string }; announcement: { text: string; level: 'info' | 'warning' | 'critical'; until: string | null } | null; blockedIps: string[]; retention: { mysebDays: number | null } };
  flags: Flag[]; retention: Array<{ id: string; label: string; value: string; editable: boolean; source: string }>;
}
const URL_ = '/api/admin/platform/settings';

export default function PlatformControls({ notify }: { notify: Notify }) {
  const { data, reload, setData } = useLoad(async () => (await api<{ data: Data }>(URL_)).data, notify);
  const { busy, act } = useAct(notify);
  const [msg, setMsg] = useState(''); const [ann, setAnn] = useState(''); const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('info'); const [until, setUntil] = useState('');
  const [ips, setIps] = useState(''); const [days, setDays] = useState('');
  useEffect(() => {
    if (!data) return;
    setMsg(data.settings.maintenance.message); setAnn(data.settings.announcement?.text ?? ''); setLevel(data.settings.announcement?.level ?? 'info');
    setUntil(data.settings.announcement?.until ? data.settings.announcement.until.slice(0, 16) : ''); setIps(data.settings.blockedIps.join('\n')); setDays(data.settings.retention.mysebDays ? String(data.settings.retention.mysebDays) : '');
  }, [data]);
  const save = (patch: Record<string, unknown>, ok: string) => act(async () => { const r = await api<{ data: Data }>(URL_, { method: 'PUT', body: JSON.stringify(patch) }); setData(r.data); }, ok);
  if (!data) return <p className="text-sm text-[#9AA6C9]">Loading…</p>;
  const groups = [...new Set(data.flags.map((f) => f.group))];

  return (
    <div className="space-y-5">
      <DownloadsCard notify={notify} />
      <FeedbackCard notify={notify} />
      <Panel title="Maintenance mode" hint="On: everyone except you is told the site is being updated. Sign-in, these admin pages, the health check and MySEB students already inside a test stay open, so you can always turn it off.">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle on={data.settings.maintenance.on} disabled={busy} label="Maintenance mode" onChange={(v) => { if (!v || confirm('Turn maintenance mode ON? Every user except administrators will see the message below until you turn it off.')) void save({ maintenance: { on: v, message: msg } }, v ? 'Maintenance mode is ON' : 'Maintenance mode is off'); }} />
          <span className={`text-sm font-semibold ${data.settings.maintenance.on ? 'text-[#FF8798]' : 'text-[#9AA6C9]'}`}>{data.settings.maintenance.on ? 'ON: users are held back' : 'Off'}</span>
        </div>
        <input className={input} value={msg} maxLength={300} onChange={(e) => setMsg(e.target.value)} placeholder="Message users see (for example: Back at 15:00)" aria-label="Maintenance message" />
        <button type="button" className={btnGhost} disabled={busy} onClick={() => void save({ maintenance: { on: data.settings.maintenance.on, message: msg } }, 'Message saved')}>Save message</button>
      </Panel>

      <Panel title="Announcement banner" hint="A line shown at the top of every page, for example before planned downtime or exam days. It disappears by itself at the end time.">
        <input className={input} value={ann} maxLength={300} onChange={(e) => setAnn(e.target.value)} placeholder="Exams are paused for 10 minutes at 14:00" aria-label="Announcement" />
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${input} max-w-[10rem]`} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Level"><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Urgent</option></select>
          <label className="flex items-center gap-2 text-xs text-[#9AA6C9]">Ends <input type="datetime-local" className={`${input} w-auto`} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Ends at" /></label>
          <button type="button" className={btnPrimary} disabled={busy || !ann.trim()} onClick={() => void save({ announcement: { text: ann.trim(), level, until: until ? new Date(until).toISOString() : null } }, 'Announcement published')}>Publish</button>
          <button type="button" className={btnGhost} disabled={busy || !data.settings.announcement} onClick={() => void save({ announcement: null }, 'Announcement removed')}>Remove</button>
        </div>
        {data.settings.announcement && <p className="text-xs text-[#9AA6C9]">Showing now: “{data.settings.announcement.text}”{data.settings.announcement.until ? ` until ${when(data.settings.announcement.until)}` : ''}</p>}
      </Panel>

      {groups.map((g) => (
        <Panel key={g} title={`Switches: ${g}`} hint={g.startsWith('MySEB') ? 'A switch only decides who can START a test; students already inside one are never cut off.' : 'Off takes effect on the next message. A switch can turn a feature off; it cannot turn on something the server itself has disabled.'}>
          <ul className="divide-y divide-[#263052]">
            {data.flags.filter((f) => f.group === g).map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-4 py-2.5">
                <div><p className="text-sm font-semibold text-white">{f.label}</p><p className="text-xs text-[#9AA6C9]">{f.hint}</p></div>
                <Toggle on={f.on} disabled={busy} label={f.label} onChange={(v) => { if (v || !f.id.startsWith('myseb') || confirm(`Turn off “${f.label}”?`)) void save({ flags: { [f.id]: v } }, `${f.label}: ${v ? 'on' : 'off'}`); }} />
              </li>
            ))}
          </ul>
        </Panel>
      ))}

      <Panel title="Blocked network addresses" hint="One per line: an address (203.0.113.9) or the start of a range ending in a dot (203.0.113.). Blocked visitors get a clear message. You cannot block your own address.">
        <textarea className={`${input} min-h-[6rem] font-mono`} value={ips} onChange={(e) => setIps(e.target.value)} aria-label="Blocked addresses" />
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save({ blockedIps: ips.split(/\s+/).map((x) => x.trim()).filter(Boolean) }, 'Block list saved')}>Save block list</button>
      </Panel>

      <Panel title="How long data is kept" hint="MySEB's period can be changed here (7 to 3650 days). The others are fixed by the server and shown so you know the rules.">
        <table className="w-full text-left"><thead><tr><th className="p-2 text-[11px] uppercase text-[#9AA6C9]">Data</th><th className="p-2 text-[11px] uppercase text-[#9AA6C9]">Kept</th><th className="p-2 text-[11px] uppercase text-[#9AA6C9]">Set by</th></tr></thead>
          <tbody className="divide-y divide-[#263052]">{data.retention.map((r) => <tr key={r.id}><td className="p-2 text-sm text-[#DCE3FA]">{r.label}</td><td className="p-2 text-sm font-semibold text-white">{r.value}</td><td className="p-2 text-xs text-[#9AA6C9]">{r.source}</td></tr>)}</tbody></table>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#9AA6C9]">MySEB days <input className={`${input} ml-2 inline w-24`} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} placeholder="default" aria-label="MySEB retention days" /></label>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save({ retention: { mysebDays: days ? Number(days) : null } }, 'Retention saved')}>Save</button>
        </div>
      </Panel>
      <button type="button" className={btnGhost} onClick={() => void reload()}>Refresh</button>
    </div>
  );
}
