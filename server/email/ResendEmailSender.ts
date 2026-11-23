import { renderBwengeEmail } from './BwengeEmailLayout.js';
import type { SendEmailOptions } from './EmailSender.js';

type ResendEmailOptions = Omit<SendEmailOptions, 'text'> & { text?: string };

export function usesResend(): boolean {
  const provider = process.env.EMAIL_PROVIDER;
  return provider ? provider === 'resend' : Boolean(process.env.RESEND_API_KEY?.trim());
}

export function hasResendConfiguration(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendResendEmail(options: ResendEmailOptions, category?: 'billing'): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('Resend email delivery requires RESEND_API_KEY');

  const from = category === 'billing'
    ? process.env.RESEND_BILLING_FROM?.trim() || 'Bwenge Billing <billing@bwenge.space>'
    : process.env.RESEND_FROM?.trim() || 'Bwenge <notifications@bwenge.space>';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...options,
      html: renderBwengeEmail(options.html),
      from,
      ...(process.env.RESEND_REPLY_TO?.trim() ? { reply_to: process.env.RESEND_REPLY_TO.trim() } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Resend rejected email delivery (HTTP ${response.status})`);
  }

  const result = await response.json() as { id?: string };
  if (typeof result?.id !== 'string' || !result.id) {
    throw new Error('Resend returned no email ID');
  }
  return result.id;
}
