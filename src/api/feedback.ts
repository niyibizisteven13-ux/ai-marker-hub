import { authFetch } from '../utils/authFetch';
import type { ResponseFeedbackDetails } from '../types';

export async function submitResponseFeedback(
  messageId: string,
  rating: 'up' | 'down',
  details: ResponseFeedbackDetails,
): Promise<void> {
  const response = await authFetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId, rating, ...details }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || 'Feedback could not be sent. Please try again.');
  }
}
