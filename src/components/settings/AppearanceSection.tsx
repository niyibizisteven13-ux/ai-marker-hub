import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Monitor, Moon, RotateCcw, Sun, Trash2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';
import { DEFAULT_APPEARANCE, PRESET_COLORS, SCENES, backgroundFor, isDark, isHex, loadAppearance, normalizeAppearance, paletteFor, pictureToBackground, type Appearance, type ColorStyle, type ThemeMode } from '../../theme/appearance';
import type { User } from '../../types';

/**
 * Settings → Appearance, like Chrome's "Customise": light, dark or the device's setting; a colour (presets or any
 * colour); how much of it goes into the backgrounds; and a background (built-in scenes or your own picture).
 * Changes show at once and are saved with the account, so they follow you to other devices.
 */
export default function AppearanceSection({ user, onUpdateUser }: { user: User | null; onUpdateUser: (u: User) => void }) {
  // Start from the look the app is showing now (it has the background picture, which the sign-in leaves out).
  const [a, setA] = useState<Appearance>(() => {
    const local = loadAppearance();
    const saved = user?.settings?.appearance;
    if (!saved) return local;
    try { const p = JSON.parse(saved); return normalizeAppearance({ ...p, image: p.image ?? local.image }); } catch { return local; }
  });
  const [status, setStatus] = useState<{ kind: 'saving' | 'saved' | 'error'; text?: string } | null>(null);
  const [busyPicture, setBusyPicture] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const first = useRef(true);

  // Show every change at once; save it shortly after the last one.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bwenge:appearance', { detail: a }));
    if (first.current) { first.current = false; return; }
    window.clearTimeout(timer.current);
    setStatus({ kind: 'saving' });
    timer.current = window.setTimeout(async () => {
      try {
        const res = await authFetch('/api/user/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: a }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save your appearance.');
        if (data.user) onUpdateUser(data.user);
        setStatus({ kind: 'saved' });
      } catch (e) {
        setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save your appearance.' });
      }
    }, 700);
    return () => window.clearTimeout(timer.current);
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Appearance>) => setA((cur) => ({ ...cur, ...patch }));
  const choosePicture = async (file: File | undefined) => {
    if (!file) return;
    setBusyPicture(true);
    try { set({ image: await pictureToBackground(file), background: 'image' }); }
    catch (e) { setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'This picture could not be used.' }); }
    finally { setBusyPicture(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const dark = isDark(a);
  const p = paletteFor(a);
  const card = 'rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5';
  const heading = 'text-sm font-semibold text-[var(--text)]';
  const hint = 'mt-0.5 text-xs text-[var(--muted)]';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-['Georgia',serif] text-xl font-normal text-[var(--text)]">Appearance</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Make Bwenge yours. Changes show straight away and follow your account to other devices.</p>
        </div>
        <span className="text-xs text-[var(--muted)]" role="status" aria-live="polite">
          {status?.kind === 'saving' ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Saving…</span>
            : status?.kind === 'saved' ? <span className="inline-flex items-center gap-1.5 text-[var(--teal)]"><Check size={12} />Saved</span>
              : status?.kind === 'error' ? <span className="text-[var(--danger)]">{status.text}</span> : null}
        </span>
      </div>

      <Preview a={a} />

      <section className={card} aria-labelledby="ap-mode">
        <h3 id="ap-mode" className={heading}>Mode</h3>
        <p className={hint}>Light, dark, or follow your device.</p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
          {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Device', Monitor]] as Array<[ThemeMode, string, typeof Sun]>).map(([id, label, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={a.mode === id} onClick={() => set({ mode: id })}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition ${a.mode === id ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:bg-[var(--hover)]'}`}>
              <Icon size={18} />{label}
            </button>
          ))}
        </div>
      </section>

      <section className={card} aria-labelledby="ap-color">
        <h3 id="ap-color" className={heading}>Colour</h3>
        <p className={hint}>Used for buttons, links, highlights and, if you like, the backgrounds.</p>
        <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colour">
          {PRESET_COLORS.map((c) => {
            const on = a.color.toLowerCase() === c.color.toLowerCase();
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} onClick={() => set({ color: c.color })}
                className={`relative grid h-9 w-9 place-items-center rounded-full ring-offset-2 ring-offset-[var(--surface)] transition ${on ? 'ring-2 ring-[var(--text)]' : 'hover:scale-105'}`}
                style={{ background: `linear-gradient(135deg, ${c.color} 50%, ${dark ? '#1f1e1d' : '#f2f1ed'} 50%)` }}>
                {on && <Check size={15} className="text-white drop-shadow" />}
              </button>
            );
          })}
          <label className={`relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-[var(--line)] ring-offset-2 ring-offset-[var(--surface)] ${!PRESET_COLORS.some((c) => c.color.toLowerCase() === a.color.toLowerCase()) ? 'ring-2 ring-[var(--text)]' : ''}`} title="Any colour"
            style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)' }}>
            <span className="sr-only">Choose any colour</span>
            <input type="color" value={a.color} onChange={(e) => set({ color: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="ap-hex" className="text-xs text-[var(--muted)]">Hex</label>
          <input id="ap-hex" key={a.color} defaultValue={a.color.toUpperCase()} maxLength={7} spellCheck={false}
            onBlur={(e) => { const v = e.target.value.trim(); const h = v.startsWith('#') ? v : `#${v}`; if (isHex(h)) set({ color: h }); else e.target.value = a.color.toUpperCase(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none" />
          <span className="h-6 w-6 rounded-md border border-[var(--line)]" style={{ background: p['--brand'] }} aria-hidden="true" />
        </div>

        <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Colour style</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Colour style">
          {([['neutral', 'Neutral', 'Grey backgrounds, coloured highlights.'], ['tinted', 'Tinted', 'A hint of colour in the backgrounds.'], ['vibrant', 'Vibrant', 'Clearly coloured backgrounds.']] as Array<[ColorStyle, string, string]>).map(([id, label, text]) => {
            const pp = paletteFor({ ...a, style: id });
            return (
              <button key={id} type="button" role="radio" aria-checked={a.style === id} onClick={() => set({ style: id })}
                className={`flex items-center gap-3 rounded-xl border p-2.5 text-left transition ${a.style === id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--line)] hover:bg-[var(--hover)]'}`}>
                <span className="flex h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-[var(--line)]" aria-hidden="true">
                  <span className="w-1/2" style={{ background: pp['--app-panel-2'] }} /><span className="w-1/2" style={{ background: pp['--app-bg'] }} />
                </span>
                <span><span className="block text-xs font-semibold text-[var(--text)]">{label}</span><span className="block text-[11px] text-[var(--muted)]">{text}</span></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={card} aria-labelledby="ap-bg">
        <h3 id="ap-bg" className={heading}>Background</h3>
        <p className={hint}>A scene in your colour, or your own picture. Text stays readable on top.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Background">
          <BgTile label="None" on={a.background === 'none'} onClick={() => set({ background: 'none' })} style={{ background: p['--app-bg'] }} />
          {SCENES.map((s) => (
            <BgTile key={s.id} label={s.name} on={a.background === s.id} onClick={() => set({ background: s.id })} style={{ background: backgroundFor({ ...a, background: s.id }) ?? undefined }} />
          ))}
          {a.image && <BgTile label="My picture" on={a.background === 'image'} onClick={() => set({ background: 'image' })} style={{ background: backgroundFor({ ...a, background: 'image' }) ?? undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busyPicture}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--line)] text-[11px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-60">
            {busyPicture ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}{a.image ? 'Change picture' : 'Upload picture'}
          </button>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void choosePicture(e.target.files?.[0])} />
        </div>
        {a.background !== 'none' && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor="ap-veil" className="text-xs text-[var(--muted)]">{a.background === 'image' ? 'Picture' : 'Scene'} strength</label>
            <input id="ap-veil" type="range" min={0.3} max={0.92} step={0.01} value={1.22 - a.veil} onChange={(e) => set({ veil: Math.round((1.22 - Number(e.target.value)) * 100) / 100 })} className="w-48 accent-[var(--accent)]" />
            {a.image && <button type="button" onClick={() => set({ image: undefined, background: a.background === 'image' ? 'none' : a.background })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--danger)]"><Trash2 size={12} />Remove my picture</button>}
          </div>
        )}
      </section>

      <button type="button" onClick={() => setA({ ...DEFAULT_APPEARANCE, image: a.image })} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] px-3.5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)]"><RotateCcw size={13} />Reset to Bwenge default</button>
    </div>
  );
}

function BgTile({ label, on, onClick, style }: { label: string; on: boolean; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} title={label}
      className={`relative flex aspect-[4/3] items-end overflow-hidden rounded-xl border text-left transition ${on ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--line)] hover:border-[var(--muted)]'}`} style={style}>
      <span className="w-full bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4 text-[11px] font-medium text-white">{label}</span>
      {on && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)]"><Check size={12} /></span>}
    </button>
  );
}

/** A miniature of the app in the chosen look. */
function Preview({ a }: { a: Appearance }) {
  const p = paletteFor(a);
  const bg = backgroundFor(a);
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)]" aria-label="Preview" role="img">
      <div className="relative flex h-44 sm:h-52" style={{ background: bg ?? p['--app-bg'], backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="flex w-1/4 min-w-[84px] flex-col gap-2 p-3" style={{ background: p['--app-panel-2'] }}>
          <span className="h-5 w-16 rounded-md" style={{ background: p['--brand'] }} />
          {[70, 55, 62, 48].map((w, i) => <span key={i} className="h-2 rounded-full" style={{ width: `${w}%`, background: p['--app-faint'], opacity: 0.5 }} />)}
        </div>
        <div className="flex flex-1 flex-col justify-between p-3 sm:p-4">
          <div className="space-y-2">
            <div className="ml-auto w-2/5 rounded-2xl px-3 py-2" style={{ background: p['--app-sunken'] }}><span className="block h-2 rounded-full" style={{ background: p['--app-text'], opacity: 0.7 }} /></div>
            <div className="space-y-1.5">{[88, 76, 60].map((w, i) => <span key={i} className="block h-2 rounded-full" style={{ width: `${w}%`, background: p['--app-text'], opacity: 0.55 }} />)}</div>
            <span className="inline-block rounded-md px-2 py-1 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${p['--brand']} 18%, transparent)`, color: p['--brand-soft'] }}>Highlight</span>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ background: p['--app-panel'], borderColor: isDark(a) ? 'rgb(255 255 255 / .1)' : 'rgb(0 0 0 / .1)' }}>
            <span className="h-2 flex-1 rounded-full" style={{ background: p['--app-faint'], opacity: 0.4 }} />
            <span className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold" style={{ background: p['--brand'], color: p['--brand-on'] }}>↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}
