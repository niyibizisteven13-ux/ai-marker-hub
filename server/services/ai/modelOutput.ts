export function nonEmptyModelText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function emptyModelOutputError(capability: 'summary' | 'translation') {
  const label = capability === 'summary' ? 'Summarization' : 'Translation';
  return {
    success: false,
    error: {
      code: 'EMPTY_MODEL_OUTPUT',
      message: `${label} returned no text. Please retry.`,
    },
    retryable: true,
  } as const;
}
