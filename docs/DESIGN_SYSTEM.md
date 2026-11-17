# Design system

One brand across the landing page, the signed-in app, the public pages and the legal documents.

## Look
* **Surfaces**: ink navy (the logo's tile), not warm taupe or cream. Dark: `#0C131D` chat, `#090F16` workspace pages; light: cool paper `#F5F7FA`.
* **Accent**: the logo's gold `#E9A23B` (`--brand`), text on it is ink (`--brand-on`). Teal (`--teal`) is the secondary colour. No terracotta, no cream.
* **Type** (self-hosted with `@fontsource-variable`, no third-party requests): **Plus Jakarta Sans** for the interface, **Bricolage Grotesque** for headings
  (class `font-display`), **JetBrains Mono** for codes (`font-mono`). Headings are balanced (`text-wrap: balance`).
* The old default (warm taupe `#262624`, terracotta `#D97757`, serif headings) was the same look as many generated interfaces and not the Bwenge logo.

## Where it lives
* Tokens: `src/theme/appearance.ts` (`DEFAULT_APPEARANCE`, `DARK_BASE`, `LIGHT_BASE`) and the static fallbacks in `src/theme/theme.css`. Pages use the variables
  (`--app-bg`, `--app-panel`, `--app-text`, `--app-muted`, `--app-faint`, `--app-line`, `--brand`, `--brand-on`, `--ws-*`), never hard-coded hex.
* Settings → Appearance still lets people pick any colour. "Clay" (the old accent) remains as a choice. A saved appearance that was exactly the old untouched default
  moves to the new brand look; anyone who chose another colour keeps it.
* Public pages share `src/components/PublicChrome.tsx` (header, footer, page frame). Legal documents use `LegalDocument.tsx` (readable 68-character column,
  contents list that follows reading, print-friendly); the wording is the owner's and unchanged.
* The landing page has its own light and dark tokens (`src/styles/landing.css`). Signed-out visitors no longer get the account theme painted over them: that
  mixed a dark page with light cards for visitors whose device is set to a light colour scheme.
