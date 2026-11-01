import { useRef, useState, type ReactNode } from 'react';
import { Check, Eye, ImagePlus, Loader2, Trash2, X } from 'lucide-react';
import { FONT_STACKS, FORM_TEMPLATES, type FormBranding, type FormFont, type HeaderStyle } from '../../../shared/formBranding';
import { resizeImageFile } from '../../utils/images';

/**
 * The form's look: pick a template, then adjust the colour, light or dark page, header, font, and add a logo,
 * banner picture and page background. Pictures are shrunk before they are kept in the form.
 */
export function FormDesignPanel({ color, branding, onColor, onBranding, onClose, onPreview }: {
  color: string; branding: FormBranding; onColor: (c: string) => void; onBranding: (b: FormBranding) => void; onClose: () => void; onPreview: () => void;
}) {
  const set = (patch: Partial<FormBranding>) => onBranding({ ...branding, ...patch, template: patch.template ?? 'custom' });
  const card = 'rounded-2xl border border-[#E0E0E0] bg-[#FFFFFF] p-5 sm:p-6';
  const label = 'text-xs font-bold uppercase tracking-wider text-[#5F6368]';
  const chip = (on: boolean) => `min-h-10 rounded-lg border px-3 text-sm font-semibold transition ${on ? 'border-[#202124] bg-[#202124] text-white' : 'border-[#DADCE0] text-[#202124] hover:bg-black/5'}`;

  return (
    <section aria-label="Form design" className={`${card} space-y-6`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#202124]">Design</h2>
          <p className="text-sm text-[#5F6368]">How your form looks to the people who fill it in.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onPreview} className={`${chip(false)} inline-flex items-center gap-1.5`}><Eye size={15} />Preview</button>
          <button type="button" onClick={onClose} aria-label="Close design" className="grid h-10 w-10 place-items-center rounded-lg text-[#5F6368] hover:bg-black/5"><X size={18} /></button>
        </div>
      </div>

      <div>
        <p className={label}>Templates</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FORM_TEMPLATES.map((t) => {
            const on = branding.template === t.id;
            return (
              <button key={t.id} type="button" aria-pressed={on} onClick={() => { onBranding({ ...branding, ...t.branding, template: t.id, ...(t.branding.header === 'banner' && !branding.bannerUrl ? { header: 'band' as HeaderStyle } : {}) }); onColor(t.color); }}
                className={`group overflow-hidden rounded-xl border text-left transition ${on ? 'border-[#202124] ring-2 ring-[#202124]/20' : 'border-[#DADCE0] hover:border-[#9AA0A6]'}`}>
                <TemplateThumb mode={t.branding.mode} header={t.branding.header} color={t.color} font={t.branding.font} wash={t.branding.wash} />
                <span className="flex items-center justify-between gap-2 px-3 pt-2 text-sm font-bold text-[#202124]">{t.name}{on && <Check size={15} />}</span>
                <span className="block px-3 pb-3 text-[11.5px] leading-snug text-[#5F6368]">{t.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <p className={label}>Colour</p>
          <div className="flex flex-wrap items-center gap-2">
            {['#D97757', '#1E7A4F', '#2F6FED', '#1F3A68', '#8B5CF6', '#DB4F8E', '#D93F3F', '#EA7A1A', '#0F9D8F', '#3F3F46'].map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => onColor(c)} className={`h-8 w-8 rounded-full ring-offset-2 ${color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-[#202124]' : ''}`} style={{ backgroundColor: c }} />
            ))}
            <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full" title="Any colour" style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)' }}>
              <input type="color" aria-label="Any colour" value={color} onChange={(e) => onColor(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
          </div>
          <p className={label}>Page</p>
          <div className="flex gap-2">
            <button type="button" className={chip(branding.mode === 'light')} onClick={() => set({ mode: 'light' })}>Light</button>
            <button type="button" className={chip(branding.mode === 'dark')} onClick={() => set({ mode: 'dark' })}>Dark</button>
            <button type="button" className={chip(branding.wash)} onClick={() => set({ wash: !branding.wash })} aria-pressed={branding.wash}>Colour glow</button>
          </div>
          <p className={label}>Header</p>
          <div className="flex flex-wrap gap-2">
            {([['bar', 'Thin bar'], ['band', 'Colour band'], ['banner', 'Picture']] as Array<[HeaderStyle, string]>).map(([id, name]) => (
              <button key={id} type="button" className={chip(branding.header === id)} disabled={id === 'banner' && !branding.bannerUrl} title={id === 'banner' && !branding.bannerUrl ? 'Add a banner picture first' : undefined} onClick={() => set({ header: id })}>{name}</button>
            ))}
          </div>
          <p className={label}>Font</p>
          <div className="flex flex-wrap gap-2">
            {([['sans', 'Modern'], ['serif', 'Classic'], ['rounded', 'Friendly'], ['mono', 'Technical']] as Array<[FormFont, string]>).map(([id, name]) => (
              <button key={id} type="button" className={chip(branding.font === id)} style={{ fontFamily: FONT_STACKS[id] }} onClick={() => set({ font: id })}>{name}</button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <ImageSlot label="Logo" hint="Square, shown in the header and the page bar." url={branding.logoUrl} shape="square"
            prepare={(f) => resizeImageFile(f, { maxSide: 320, type: 'image/png', maxChars: 400_000 })}
            onChange={(logoUrl) => set({ logoUrl })} />
          <ImageSlot label="Banner picture" hint="Wide picture across the top (about 1600 × 400)." url={branding.bannerUrl} shape="wide"
            prepare={(f) => resizeImageFile(f, { maxSide: 1800, maxChars: 1_000_000 })}
            onChange={(bannerUrl) => set({ bannerUrl, header: bannerUrl ? 'banner' : branding.header === 'banner' ? 'band' : branding.header })} />
          <ImageSlot label="Page background" hint="Shown softly behind the form; text stays readable." url={branding.backgroundUrl} shape="wide"
            prepare={(f) => resizeImageFile(f, { maxSide: 1920, quality: 0.78, maxChars: 1_200_000 })}
            onChange={(backgroundUrl) => set({ backgroundUrl })} />
        </div>
      </div>
    </section>
  );
}

function ImageSlot({ label, hint, url, shape, prepare, onChange }: { label: string; hint: string; url?: string; shape: 'square' | 'wide'; prepare: (f: File) => Promise<string>; onChange: (url: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { onChange(await prepare(file)); } catch (e) { setError(e instanceof Error ? e.message : 'This picture could not be used.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E0E0E0] p-3">
      <button type="button" onClick={() => input.current?.click()} aria-label={`Choose ${label.toLowerCase()}`}
        className={`grid shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-[#DADCE0] bg-[#F8F9FA] text-[#5F6368] hover:border-[#9AA0A6] ${shape === 'square' ? 'h-14 w-14' : 'h-14 w-24'}`}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={18} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#202124]">{label}</p>
        <p className="text-xs text-[#5F6368]">{error ? <span className="text-rose-700">{error}</span> : hint}</p>
      </div>
      {url && <button type="button" onClick={() => onChange(undefined)} aria-label={`Remove ${label.toLowerCase()}`} className="grid h-9 w-9 place-items-center rounded-lg text-[#5F6368] hover:bg-black/5 hover:text-rose-700"><Trash2 size={16} /></button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void choose(e.target.files?.[0])} />
    </div>
  );
}

/** A tiny picture of a template. */
function TemplateThumb({ mode, header, color, font, wash }: { mode: 'light' | 'dark'; header: HeaderStyle; color: string; font: FormFont; wash: boolean }): ReactNode {
  const dark = mode === 'dark';
  const page = dark ? '#0d0e10' : '#f1f1ee';
  return (
    <span className="relative block h-24 overflow-hidden" style={{ background: wash ? `radial-gradient(70% 60% at 50% 0%, ${color}55, transparent 70%), ${page}` : page }}>
      <span className="absolute inset-x-4 top-3 bottom-0 overflow-hidden rounded-t-lg" style={{ background: dark ? '#16171b' : '#ffffff', boxShadow: '0 1px 3px rgb(0 0 0 / .12)' }}>
        {header === 'bar' ? <span className="block h-1.5" style={{ background: color }} /> : <span className="block h-7" style={{ background: header === 'banner' ? `linear-gradient(135deg, ${color}, #f59e0b)` : `linear-gradient(135deg, ${color}, ${color}aa)` }} />}
        <span className="block px-2.5 pt-1.5 text-[10px] font-bold" style={{ fontFamily: FONT_STACKS[font], color: dark ? '#ececee' : '#202124' }}>Form title</span>
        <span className="mx-2.5 mt-1 block h-1 w-3/4 rounded-full" style={{ background: dark ? '#ffffff22' : '#00000018' }} />
        <span className="mx-2.5 mt-1 block h-1 w-1/2 rounded-full" style={{ background: dark ? '#ffffff22' : '#00000018' }} />
      </span>
    </span>
  );
}
