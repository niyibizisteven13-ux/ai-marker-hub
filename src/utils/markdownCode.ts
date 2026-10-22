/**
 * Whether a react-markdown `code` element is inline. react-markdown v10 dropped the `inline` prop;
 * a fenced block always spans several source lines (fences included), inline code spans one.
 */
export function isInlineCode(props: { inline?: unknown }, className: string | undefined, node: { position?: { start?: { line?: number }; end?: { line?: number } } } | undefined, children: unknown): boolean {
  if ('inline' in props) return Boolean(props.inline);
  if (/language-/.test(className || '')) return false;
  return node?.position?.start?.line === node?.position?.end?.line && !String(children).includes('\n');
}
