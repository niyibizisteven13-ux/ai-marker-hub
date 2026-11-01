// Design tokens (Claude-inspired). Colours are theme variables (src/theme), so Settings → Appearance recolours them.
export const tokens = {
  bg: "var(--app-bg)",          // Phone page background
  bgSidebar: "var(--app-panel-2)",   // Drawer background
  bgSurface: "var(--app-panel)",   // Composer + menus background
  bgUserBubble: "var(--app-sunken)", // User message bubble background
  border: "var(--app-line)", // Hairline border
  borderEmerald: "rgba(16, 185, 129, 0.05)", // Subtle brand-tinted dividers
  textPrimary: "var(--app-text)", // Body text primary
  textSecondary: "var(--app-muted)", // Secondary text
  textMuted: "var(--app-faint)",   // Muted text
  accent: "var(--brand)",      // Send button accent
  accentEmerald: "#5DCAA5", // Emerald accent for actions
  accentHover: "#4CB391",
  accentDeep: "#1F3D35",  // Dark forest emerald for recessed button backgrounds
  emerald: "#5DCAA5",
  emeraldDark: "#0D2B24"
};
