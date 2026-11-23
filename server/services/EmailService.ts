import nodemailer, { type Transporter } from 'nodemailer';
import { sendResendEmail, usesResend } from '../email/ResendEmailSender.js';
import { escapeEmailHtml, renderBwengeCode, renderBwengeEmail } from '../email/BwengeEmailLayout.js';
import logger from '../utils/logger.js';

export class EmailService {
  private static instance: EmailService;

  private constructor() {}

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private transport: Transporter | null = null;
  private static testTransport: Transporter | null = null;

  /** Tests capture mail with a nodemailer stream/json transport instead of SMTP. */
  public static setTestTransport(t: Transporter | null) { EmailService.testTransport = t; }

  private getTransport(): Transporter | null {
    if (EmailService.testTransport) return EmailService.testTransport;
    if (this.transport) return this.transport;
    const host = process.env.SMTP_HOST;
    if (!host || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
    const port = Number(process.env.SMTP_PORT) || 587;
    this.transport = nodemailer.createTransport({
      host, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      pool: true, maxConnections: 3, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    return this.transport;
  }

  public async sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }, category?: 'billing'): Promise<{ success: boolean; messageId?: string; skipped?: boolean; error?: string }> {
    try {
      if (!EmailService.testTransport && usesResend()) {
        const messageId = await sendResendEmail({ to, subject, html, text }, category);
        logger.info('[EmailService] Resend accepted email.', { messageId });
        return { success: true, messageId };
      }

      const transport = this.getTransport();
      if (!transport) {
        logger.warn('[EmailService] SMTP is not configured; email not sent.');
        return { success: false, skipped: true };
      }

      const info = await transport.sendMail({
        from: process.env.SMTP_FROM || 'Bwenge AI <noreply@bwenge.space>',
        to, subject, html: renderBwengeEmail(html),
        text: text ?? html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>(?!\n)/gi, '\n').replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim(),
        ...(process.env.SMTP_REPLY_TO ? { replyTo: process.env.SMTP_REPLY_TO } : {}),
      });
      logger.info('[EmailService] Email sent.', { messageId: info.messageId });
      return { success: true, messageId: info.messageId };
    } catch (err) {
      logger.error('[EmailService] Email failed.', { errorType: (err as Error)?.name });
      return { success: false, error: (err as Error)?.message };
    }
  }

  public async sendOtpEmail(to: string, otpCode: string) {
    return this.sendEmail({
      to,
      subject: 'Your Bwenge AI Verification Code',
      html: `<h1>Sign in to Bwenge</h1>
        <p>Your one-time verification code is:</p>
        ${renderBwengeCode(otpCode)}
        <p>This code expires in 5 minutes. If you didn't request it, you can ignore this email.</p>`,
    });
  }

  public async sendPasswordResetEmail(to: string, resetToken: string) {
    const resetUrl = `https://www.bwenge.space/reset-password?token=${encodeURIComponent(resetToken)}`;
    return this.sendEmail({
      to,
      subject: 'Reset your Bwenge AI password',
      html: `<h1>Reset your password</h1>
        <p>We received a request to reset the password for ${escapeEmailHtml(to)}.</p>
        <p><a href="${resetUrl}" style="color:#4CE5D6;">Reset password</a></p>
        <p>If you didn't request this, you can ignore this email.</p>`,
    });
  }

  public async sendWelcomeEmail(to: string, name: string) {
    return this.sendEmail({
      to,
      subject: 'Welcome to Bwenge AI Studio',
      html: `<h1>Welcome, ${escapeEmailHtml(name)}!</h1>
        <p>Your Bwenge workspace is ready. You can grade submissions, scan papers, and build workflows.</p>
        <p><a href="https://www.bwenge.space" style="color:#4CE5D6;">Open your workspace</a></p>`,
    });
  }
}
