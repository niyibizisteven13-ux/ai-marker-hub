export function sanitizeNext(next: unknown, defaultRoute: string = '/chat'): string {
  if (typeof next !== 'string') return defaultRoute;
  const trimmed = next.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return defaultRoute;
  // Must start with single / but not //
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return defaultRoute;
  // No protocol (://), no backslash, no control characters
  if (trimmed.includes('://') || trimmed.includes('\\') || /[\x00-\x1F\x7F]/.test(trimmed)) {
    return defaultRoute;
  }
  return trimmed;
}
