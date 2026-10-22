import nodemailer, { type Transporter } from 'nodemailer';
import logger from '../utils/logger.js';

export class EmailService {
  private static instance: EmailService;

  private constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      logger.info('[EmailService] SMTP transport credentials are configured.');
    } else {
      logger.warn('[EmailService] SMTP credentials not fully configured. Emails will be logged to console.');
    }
  }

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

  /**
   * Sends one email over SMTP (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO).
   * Without SMTP settings nothing is sent and the result says so; callers never treat that as delivered.
   */
  public async sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }): Promise<{ success: boolean; messageId?: string; skipped?: boolean; error?: string }> {
    const from = process.env.SMTP_FROM || 'Bwenge AI <noreply@bwenge.space>';
    const transport = this.getTransport();
    if (!transport) {
      logger.warn('[EmailService] SMTP is not configured; email not sent.', { subject });
      return { success: false, skipped: true };
    }
    try {
      const info = await transport.sendMail({
        from, to, subject, html,
        text: text ?? html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>(?!\n)/gi, '\n').replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim(),
        ...(process.env.SMTP_REPLY_TO ? { replyTo: process.env.SMTP_REPLY_TO } : {}),
      });
      logger.info('[EmailService] Email sent.', { subject, messageId: info.messageId });
      return { success: true, messageId: info.messageId };
    } catch (err) {
      logger.error('[EmailService] Email failed.', { subject, errorType: (err as Error)?.name });
      return { success: false, error: (err as Error)?.message };
    }
  }

  public async sendOtpEmail(to: string, otpCode: string) {
    const subject = 'Your Bwenge AI Verification Code';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verification Code</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #101114; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FAF9F5;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #101114; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" max-width="600px" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #1c1c20; border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; margin-bottom: 24px;">
                      <span style="font-size: 24px; color: #D97757; margin-right: 8px;">✦</span>
                      <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: #FAF9F5;">Bwenge AI Studio</span>
                    </div>
                    <h1 style="font-size: 24px; font-weight: 600; color: #FAF9F5; margin-top: 0; margin-bottom: 12px;">Sign in to Bwenge</h1>
                    <p style="font-size: 14px; line-height: 24px; color: #A0A0AA; margin-bottom: 24px;">You requested a one-time verification code to sign in to your workspace at <a href="https://www.bwenge.space" style="color: #D97757; text-decoration: none;">www.bwenge.space</a>.</p>
                    <div style="background: #26262a; border: 1px solid rgba(217,119,87,0.3); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px;">
                      <div style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #D97757;">${otpCode}</div>
                    </div>
                    <p style="font-size: 13px; color: #71717A; margin-bottom: 0;">This code will expire in 5 minutes. If you did not request this, you can safely ignore this email.</p>
                  </td>
                </tr>
              </table>
              <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #52525B;">
                © 2026 Bwenge AI Studio · <a href="https://www.bwenge.space" style="color: #71717A; text-decoration: underline;">www.bwenge.space</a>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    return this.sendEmail({ to, subject, html });
  }

  public async sendPasswordResetEmail(to: string, resetToken: string) {
    const resetUrl = `https://www.bwenge.space/reset-password?token=${resetToken}`;
    const subject = 'Reset your Bwenge AI password';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Password Reset</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #101114; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FAF9F5;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #101114; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" max-width="600px" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #1c1c20; border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                <tr>
                  <td>
                    <div style="margin-bottom: 24px;">
                      <span style="font-size: 24px; color: #D97757; margin-right: 8px;">✦</span>
                      <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: #FAF9F5;">Bwenge AI Studio</span>
                    </div>
                    <h1 style="font-size: 24px; font-weight: 600; color: #FAF9F5; margin-top: 0; margin-bottom: 12px;">Reset your password</h1>
                    <p style="font-size: 14px; line-height: 24px; color: #A0A0AA; margin-bottom: 24px;">We received a request to reset the password for your account associated with <strong>${to}</strong>.</p>
                    <div style="text-align: center; margin-bottom: 24px;">
                      <a href="${resetUrl}" style="display: inline-block; background: #D97757; color: white; padding: 14px 28px; text-decoration: none; border-radius: 14px; font-weight: 700; font-size: 14px; box-shadow: 0 10px 20px rgba(217,119,87,0.3);">Reset Password</a>
                    </div>
                    <p style="font-size: 13px; color: #71717A; margin-bottom: 0;">If you didn't request this, you can safely ignore this email.</p>
                  </td>
                </tr>
              </table>
              <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #52525B;">
                © 2026 Bwenge AI Studio · <a href="https://www.bwenge.space" style="color: #71717A; text-decoration: underline;">www.bwenge.space</a>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    return this.sendEmail({ to, subject, html });
  }

  public async sendWelcomeEmail(to: string, name: string) {
    const subject = 'Welcome to Bwenge AI Studio';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to Bwenge</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #101114; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FAF9F5;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #101114; padding: 40px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" max-width="600px" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #1c1c20; border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                <tr>
                  <td>
                    <div style="margin-bottom: 24px;">
                      <span style="font-size: 24px; color: #D97757; margin-right: 8px;">✦</span>
                      <span style="font-size: 20px; font-weight: 700; letter-spacing: -0.5px; color: #FAF9F5;">Bwenge AI Studio</span>
                    </div>
                    <h1 style="font-size: 24px; font-weight: 600; color: #FAF9F5; margin-top: 0; margin-bottom: 12px;">Welcome, ${name}!</h1>
                    <p style="font-size: 14px; line-height: 24px; color: #A0A0AA; margin-bottom: 24px;">Your workspace account is ready at <a href="https://www.bwenge.space" style="color: #D97757; text-decoration: none;">www.bwenge.space</a>.</p>
                    <p style="font-size: 14px; line-height: 24px; color: #A0A0AA; margin-bottom: 24px;">Start grading student submissions, scanning papers with AI, and building intelligent workflows today.</p>
                    <div style="text-align: center; margin-bottom: 24px;">
                      <a href="https://www.bwenge.space" style="display: inline-block; background: #D97757; color: white; padding: 14px 28px; text-decoration: none; border-radius: 14px; font-weight: 700; font-size: 14px; box-shadow: 0 10px 20px rgba(217,119,87,0.3);">Open Studio Workspace</a>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #52525B;">
                © 2026 Bwenge AI Studio · <a href="https://www.bwenge.space" style="color: #71717A; text-decoration: underline;">www.bwenge.space</a>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    return this.sendEmail({ to, subject, html });
  }
}
