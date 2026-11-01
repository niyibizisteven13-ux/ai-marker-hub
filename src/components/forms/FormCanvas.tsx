import type { CSSProperties, ReactNode } from 'react';
import { FONT_STACKS, normalizeBranding, type FormBranding } from '../../../shared/formBranding';

/**
 * The page a form sits on, in the form's own design (not the viewer's app theme): light or dark, the owner's
 * background picture or a soft wash of the form colour, and the chosen font. Used by the public form page and the
 * builder's preview, so what the owner previews is exactly what people see.
 */
export function brandingOf(schema: any): FormBranding {
  return normalizeBranding(schema?.branding ?? (schema?.themeColor ? { mode: 'dark' } : undefined));
}

export function FormCanvas({ schema, children, className = '', fullPage = false }: { schema: any; children: ReactNode; className?: string; fullPage?: boolean }) {
  const b = brandingOf(schema);
  const accent = /^#[0-9a-f]{6}$/i.test(schema?.themeColor ?? '') ? schema.themeColor : '#D97757';
  const dark = b.mode === 'dark';
  const base = dark ? '#0d0e10' : '#f4f4f1';
  const veil = dark ? 'rgb(13 14 16 / 0.78)' : 'rgb(244 244 241 / 0.72)';
  const background = b.backgroundUrl
    ? `linear-gradient(${veil}, ${veil}), url("${b.backgroundUrl.replace(/"/g, '%22')}") center / cover no-repeat fixed, ${base}`
    : b.wash
      ? `radial-gradient(60% 40% at 50% 0%, ${accent}${dark ? '38' : '2e'}, transparent 70%), radial-gradient(40% 30% at 100% 100%, ${accent}${dark ? '1f' : '1a'}, transparent 70%), ${base}`
      : base;
  const style: CSSProperties = { background, fontFamily: FONT_STACKS[b.font], color: dark ? '#ececee' : '#1f2328' };
  return (
    <div className={`${dark ? 'form-dark' : 'form-light'} ${fullPage ? 'min-h-full' : 'rounded-2xl'} ${className}`} style={style} data-form-mode={b.mode}>
      {children}
    </div>
  );
}
