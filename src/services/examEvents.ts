export interface ServerEvent { event: string; id: string; data: string }

/** Incremental SSE parser: network chunks need not end on line or UTF-8 boundaries. */
export function eventParser(emit: (event: ServerEvent) => void) {
  let buffer = '', event = 'message', id = '', data: string[] = [];
  const line = (value: string) => {
    if (!value) {
      if (data.length) emit({ event, id, data: data.join('\n') });
      event = 'message'; data = []; return;
    }
    if (value.startsWith(':')) return;
    const separator = value.indexOf(':');
    const field = separator < 0 ? value : value.slice(0, separator);
    const content = separator < 0 ? '' : value.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = content;
    if (field === 'data') data.push(content);
    if (field === 'id' && !content.includes('\0')) id = content;
  };
  return (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      line(buffer.slice(0, end).replace(/\r$/, ''));
      buffer = buffer.slice(end + 1);
    }
    if (buffer.length > 4_000_000) throw new Error('Live update exceeded its size limit.');
  };
}

export async function readServerEvents(response: Response, emit: (event: ServerEvent) => void, signal: AbortSignal) {
  if (!response.body) throw new Error('Live updates are unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = eventParser(emit);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
    if (!signal.aborted) parse(decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
