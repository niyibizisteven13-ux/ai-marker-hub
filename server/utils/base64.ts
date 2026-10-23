/**
 * Valid standard base64. One flat character class: the grouped pattern used before
 * (`(?:[A-Za-z0-9+/]{4})*…`) overflowed the regex stack on attachments of a few MB and crashed the server.
 */
export function isBase64(s: unknown): s is string {
  return typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}
