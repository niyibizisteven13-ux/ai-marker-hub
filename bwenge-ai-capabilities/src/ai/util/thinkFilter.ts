/**
 * Streaming-safe filter that removes model "reasoning" blocks (<think>, <thinking>, <reasoning>)
 * even when a tag is split across chunks. Feed it chunks; it returns only the visible text.
 */
const TAGS = ['think', 'thinking', 'reasoning'];
const OPEN = TAGS.map((t) => `<${t}>`);

export class ThinkFilter {
  private buf = '';
  private closeTag: string | null = null;

  push(chunk: string): string {
    this.buf += chunk;
    let out = '';
    for (;;) {
      if (this.closeTag) {
        const i = this.buf.indexOf(this.closeTag);
        if (i === -1) {
          // Keep only a possible partial close tag; everything else is hidden reasoning.
          this.buf = this.partialTail(this.buf, [this.closeTag]);
          return out;
        }
        this.buf = this.buf.slice(i + this.closeTag.length);
        this.closeTag = null;
        continue;
      }
      let idx = -1;
      let which = '';
      for (const tag of OPEN) {
        const i = this.buf.indexOf(tag);
        if (i !== -1 && (idx === -1 || i < idx)) { idx = i; which = tag; }
      }
      if (idx === -1) {
        const tail = this.partialTail(this.buf, [...OPEN, ...TAGS.map((t) => `</${t}>`)]);
        out += this.buf.slice(0, this.buf.length - tail.length).replace(/<\/(think|thinking|reasoning)>/g, '');
        this.buf = tail;
        return out;
      }
      out += this.buf.slice(0, idx).replace(/<\/(think|thinking|reasoning)>/g, '');
      this.buf = this.buf.slice(idx + which.length);
      this.closeTag = `</${which.slice(1)}`;
    }
  }

  /** Call when the stream ends. Hidden reasoning that never closed is dropped. */
  flush(): string {
    const rest = this.closeTag ? '' : this.buf.replace(/<\/(think|thinking|reasoning)>/g, '');
    this.buf = '';
    this.closeTag = null;
    return rest;
  }

  private partialTail(text: string, tags: string[]): string {
    const lt = text.lastIndexOf('<');
    if (lt === -1) return '';
    const tail = text.slice(lt);
    return tags.some((t) => t.startsWith(tail) && tail.length < t.length) ? tail : '';
  }
}

/** Non-streaming helper. */
export function stripThinking(text: string): string {
  const f = new ThinkFilter();
  return (f.push(text) + f.flush()).trim();
}
