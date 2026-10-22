/**
 * Billing emails: one branded layout (table-based, inline styles, works in Gmail and Outlook) and the
 * templates for receipts, failed payments, renewal reminders and expiry. Each returns subject, HTML and text.
 */

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const appUrl = () => (process.env.APP_BASE_URL || 'https://www.bwenge.space').replace(/\/$/, '');
const rwf = (n: number) => `${Math.round(n).toLocaleString('en-US')} RWF`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kigali' });

export interface Email { subject: string; html: string; text: string }

function layout(o: { preheader: string; title: string; intro: string; body: string; cta?: { label: string; url: string }; footnote?: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#F4F2EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F1E1D">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F4F2EE;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px">
<tr><td style="padding:0 4px 18px"><span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#0B1420;color:#F6B94A;font-weight:800;text-align:center;line-height:28px;font-size:16px;vertical-align:middle">B</span>
<span style="font-size:17px;font-weight:700;letter-spacing:-0.2px;vertical-align:middle;margin-left:8px">Bwenge AI</span></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E7E3DC;border-radius:18px;padding:32px 28px">
<h1 style="margin:0 0 10px;font-size:22px;line-height:1.3;color:#1F1E1D">${esc(o.title)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4A4842">${o.intro}</p>
${o.body}
${o.cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 4px"><tr><td style="border-radius:12px;background:#D97757"><a href="${esc(o.cta.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none">${esc(o.cta.label)}</a></td></tr></table>` : ''}
${o.footnote ? `<p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#8A867D">${o.footnote}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 6px;text-align:center;font-size:12px;line-height:1.6;color:#8A867D">Bwenge AI · Education, research &amp; data companion<br><a href="${appUrl()}" style="color:#8A867D">${appUrl().replace(/^https?:\/\//, '')}</a> · Questions? Reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
}

function rows(items: Array<[string, string]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #E7E3DC;border-radius:12px;border-collapse:separate;overflow:hidden">${items.map(([k, v], i) =>
    `<tr><td style="padding:11px 14px;font-size:13px;color:#8A867D;${i ? 'border-top:1px solid #EFEBE4;' : ''}width:45%">${esc(k)}</td><td style="padding:11px 14px;font-size:14px;color:#1F1E1D;font-weight:600;text-align:right;${i ? 'border-top:1px solid #EFEBE4;' : ''}">${v}</td></tr>`).join('')}</table>`;
}

const text = (lines: Array<string | false | undefined>) => lines.filter(Boolean).join('\n');

export interface ReceiptData {
  name: string; receiptNumber: string; paidAt: Date; item: string; amountRwf: number; amountUsd: number; currency: string;
  phoneMasked: string; transactionId?: string | null; grant: string; balanceNote?: string;
}

export function receiptEmail(d: ReceiptData): Email {
  const subject = `Receipt ${d.receiptNumber} · ${d.item}`;
  const amount = d.currency === 'RWF' ? rwf(d.amountRwf) : `${d.amountRwf.toLocaleString('en-US')} ${esc(d.currency)}`;
  return {
    subject,
    html: layout({
      preheader: `Payment received: ${d.item}, ${amount}.`,
      title: 'Payment received. Thank you!',
      intro: `Hi ${esc(d.name || 'there')}, your Mobile Money payment was successful. ${esc(d.grant)}`,
      body: rows([
        ['Receipt number', esc(d.receiptNumber)],
        ['Date', esc(day(d.paidAt))],
        ['Item', esc(d.item)],
        ['Amount paid', `${amount} <span style="color:#8A867D;font-weight:400">(≈ ${usd(d.amountUsd)})</span>`],
        ['Payment method', `MTN Mobile Money · ${esc(d.phoneMasked)}`],
        ...(d.transactionId ? [['MoMo transaction ID', esc(d.transactionId)] as [string, string]] : []),
        ['Status', '<span style="color:#1B8A5A">Paid</span>'],
      ]),
      cta: { label: 'Open Bwenge', url: appUrl() },
      footnote: `${d.balanceNote ? `${esc(d.balanceNote)} ` : ''}Keep this email as your receipt. You can also find it in Settings → Billing.`,
    }),
    text: text([`Payment received. Thank you!`, `Receipt: ${d.receiptNumber}`, `Date: ${day(d.paidAt)}`, `Item: ${d.item}`, `Amount: ${amount} (about ${usd(d.amountUsd)})`, `Paid with MTN Mobile Money ${d.phoneMasked}`, d.transactionId && `MoMo transaction ID: ${d.transactionId}`, d.grant, d.balanceNote, appUrl()]),
  };
}

export function paymentFailedEmail(d: { name: string; item: string; amountRwf: number; reason?: string | null }): Email {
  const why = d.reason === 'PAYER_DECLINED' || d.reason === 'APPROVAL_REJECTED' ? 'The payment was declined on the phone.'
    : d.reason === 'NOT_ENOUGH_FUNDS' ? 'There was not enough balance on the Mobile Money account.'
      : d.reason === 'TIMEOUT' || d.reason === 'EXPIRED' ? 'The payment request was not approved in time.' : 'The payment did not go through.';
  return {
    subject: `Payment not completed · ${d.item}`,
    html: layout({
      preheader: why, title: 'Your payment was not completed',
      intro: `Hi ${esc(d.name || 'there')}, ${esc(why)} No money was taken for ${esc(d.item)} (${rwf(d.amountRwf)}).`,
      body: `<p style="margin:0;font-size:14px;line-height:1.6;color:#4A4842">You can try again at any time. Keep your phone nearby: you will get a Mobile Money prompt to approve with your PIN.</p>`,
      cta: { label: 'Try again', url: `${appUrl()}/upgrade` },
    }),
    text: text(['Your payment was not completed.', why, `No money was taken for ${d.item} (${rwf(d.amountRwf)}).`, `Try again: ${appUrl()}/upgrade`]),
  };
}

export function renewalReminderEmail(d: { name: string; plan: string; endDate: Date; daysLeft: number; priceRwf: number; priceUsd: number }): Email {
  const when = d.daysLeft <= 0 ? 'today' : d.daysLeft === 1 ? 'tomorrow' : `in ${d.daysLeft} days`;
  return {
    subject: `Your ${d.plan} plan ends ${when}`,
    html: layout({
      preheader: `Renew for ${rwf(d.priceRwf)} with Mobile Money to keep your ${d.plan} features.`,
      title: `Your ${esc(d.plan)} plan ends ${when}`,
      intro: `Hi ${esc(d.name || 'there')}, your ${esc(d.plan)} access ends on <b>${esc(day(d.endDate))}</b>. Renew now to keep your daily credits and memory across all chats.`,
      body: rows([['Plan', esc(d.plan)], ['Renewal', `${rwf(d.priceRwf)} <span style="color:#8A867D;font-weight:400">(≈ ${usd(d.priceUsd)}) / month</span>`], ['Ends on', esc(day(d.endDate))]]),
      cta: { label: `Renew for ${rwf(d.priceRwf)}`, url: `${appUrl()}/upgrade?renew=1` },
      footnote: 'Mobile Money does not renew automatically, so nothing is charged until you approve a payment.',
    }),
    text: text([`Your ${d.plan} plan ends ${when} (${day(d.endDate)}).`, `Renew for ${rwf(d.priceRwf)} (about ${usd(d.priceUsd)}) per month: ${appUrl()}/upgrade?renew=1`]),
  };
}

export function expiredEmail(d: { name: string; plan: string; priceRwf: number }): Email {
  return {
    subject: `Your ${d.plan} plan has ended`,
    html: layout({
      preheader: 'You are now on the Free plan. Your memories and files are kept.',
      title: `Your ${esc(d.plan)} plan has ended`,
      intro: `Hi ${esc(d.name || 'there')}, you are now on the Free plan. Your files and memories are kept safely, and everything comes back as soon as you renew.`,
      body: '',
      cta: { label: `Renew ${d.plan} for ${rwf(d.priceRwf)}`, url: `${appUrl()}/upgrade?renew=1` },
    }),
    text: text([`Your ${d.plan} plan has ended. You are now on the Free plan; your files and memories are kept.`, `Renew: ${appUrl()}/upgrade?renew=1`]),
  };
}
