export async function readProviderJson(
  response: Response,
  provider: string,
  endpointDescription: string,
): Promise<Record<string, any>> {
  const contentType = response.headers.get('content-type') || 'unknown content type';
  const body = await response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    const isHtml = /text\/html/i.test(contentType) || /^\s*<!doctype html|^\s*<html/i.test(body);
    const responseType = isHtml ? 'HTML' : 'non-JSON';
    throw new Error(
      `${provider} returned ${isHtml ? 'an' : 'a'} ${responseType} response from its ${endpointDescription} (HTTP ${response.status}, ${contentType}). Check the configured provider URL and gateway availability.`,
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${provider} returned an invalid JSON response from its ${endpointDescription} (HTTP ${response.status}, ${contentType}).`,
    );
  }
  return parsed as Record<string, any>;
}

export function extractChatCompletionText(data: Record<string, any>): string {
  const content = data.choices?.[0]?.message?.content ?? data.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .filter((part: unknown): part is { text: string } =>
      Boolean(part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string'),
    )
    .map((part: { text: string }) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
