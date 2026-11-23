import type { BroadcastSender } from '../../shared/bwengeBroadcast.js';
import * as nodemailer from 'nodemailer';
import { renderBwengeCode, renderBwengeEmail } from './BwengeEmailLayout.js';
import { hasResendConfiguration, sendResendEmail, usesResend } from './ResendEmailSender.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(options: SendEmailOptions): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(options: SendEmailOptions): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Console email delivery is disabled in production');
    }
    console.log(`[EMAIL CONSOLE SENDER] To: ${options.to} | Subject: ${options.subject}`);
    console.log(`[BODY]:\n${options.text}`);
  }
}

export class SmtpEmailSender implements EmailSender {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport(process.env.EMAIL_SMTP_URL || {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    const from = process.env.EMAIL_FROM || 'Bwenge <login@bwenge.ai>';
    await this.transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: renderBwengeEmail(options.html),
    });
  }
}

export function hasSmtpConfiguration(): boolean {
  return Boolean(process.env.EMAIL_SMTP_URL || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
}

export function validateEmailSenderConfiguration(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (usesResend()) {
    if (!hasResendConfiguration()) {
      console.error('Email delivery is unavailable: Resend requires RESEND_API_KEY.');
    }
  } else if (!hasSmtpConfiguration()) {
    console.error('Email delivery is unavailable: production requires EMAIL_SMTP_URL or SMTP_HOST, SMTP_USER, and SMTP_PASS. OTP sending is disabled until configured.');
  }
}

export function getEmailSender(sender?: BroadcastSender): EmailSender {
  if (usesResend()) {
    if (!hasResendConfiguration()) throw new Error('Resend email delivery requires RESEND_API_KEY');
    return { async send(options) { await sendResendEmail(options, sender); } };
  }

  if (sender && sender !== 'notifications') throw new Error('This sender requires Resend');

  if (process.env.NODE_ENV === 'production') {
    if (!hasSmtpConfiguration()) {
      throw new Error('Production email delivery requires SMTP_HOST, SMTP_USER, and SMTP_PASS');
    }
    return new SmtpEmailSender();
  }

  const provider = process.env.EMAIL_PROVIDER || (process.env.EMAIL_SMTP_URL || process.env.SMTP_HOST || process.env.SMTP_USER ? 'smtp' : 'console');
  if (provider === 'smtp' || provider === 'sendgrid') {
    try {
      return new SmtpEmailSender();
    } catch (err) {
      console.warn('Failed to initialize SMTP email sender, falling back to development console:', err);
      return new ConsoleEmailSender();
    }
  }
  return new ConsoleEmailSender();
}

export function getVerificationEmailContent(code: string, locale: string = 'en') {
  const loc = (locale || 'en').toLowerCase();
  if (loc.startsWith('rw')) {
    return {
      subject: `${code} ni kode yawe ya Bwenge`,
      text: `${code} ni kode yawe yo kwinjira muri Bwenge. Irangira mu minota 10. Niba utabisabye, irengagize ubutumwa.`,
      html: `
          <p>Kode yawe yo kwinjira:</p>
          ${renderBwengeCode(code)}
          <p>Irangira mu minota 10. Niba utabisabye, irengagize.</p>
      `,
    };
  }
  if (loc.startsWith('fr')) {
    return {
      subject: `${code} est votre code Bwenge`,
      text: `${code} est votre code de connexion Bwenge. Il expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail.`,
      html: `
          <p>Votre code de vérification :</p>
          ${renderBwengeCode(code)}
          <p>Il expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>
      `,
    };
  }
  // Default EN
  return {
    subject: `${code} is your Bwenge code`,
    text: `${code} is your Bwenge login verification code. It expires in 10 minutes. If you didn't ask for this, ignore this email.`,
    html: `
        <p>Your one-time login verification code is:</p>
        ${renderBwengeCode(code)}
        <p>It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>
    `,
  };
}
