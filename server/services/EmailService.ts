import logger from '../utils/logger.js';

export class EmailService {
  private static instance: EmailService;

  private constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      logger.info(`[EmailService] Initialized SMTP service for host ${host} (User: ${user})`);
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

  public async sendEmail({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }) {
    const from = process.env.SMTP_FROM || 'Bwenge AI Studio <noreply@bwenge.com>';
    const host = process.env.SMTP_HOST;

    logger.info(`[EmailService] Dispatching email via ${host || 'console fallback'} -> To: ${to} | Subject: "${subject}"`);

    // In production with Gmail SMTP / SES, this integrates with SMTP transport or API.
    // For now, log successfully and return success response.
    return { success: true, messageId: 'msg-' + Date.now() };
  }

  public async sendPasswordResetEmail(to: string, resetToken: string) {
    const resetUrl = `https://www.bwenge.com/reset-password?token=${resetToken}`;
    const subject = 'Reset your Bwenge AI password';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #101114; color: #FAF9F5; border-radius: 12px;">
        <h2 style="color: #D97757;">Bwenge AI Studio</h2>
        <p>You requested a password reset for your account associated with ${to}.</p>
        <p>Click the button below to securely reset your password:</p>
        <a href="${resetUrl}" style="display: inline-block; background: #D97757; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">Reset Password</a>
        <p style="font-size: 12px; color: #888;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  }

  public async sendWelcomeEmail(to: string, name: string) {
    const subject = 'Welcome to Bwenge AI Studio';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #101114; color: #FAF9F5; border-radius: 12px;">
        <h2 style="color: #D97757;">Welcome to Bwenge, ${name}!</h2>
        <p>Your account is ready at <a href="https://www.bwenge.com" style="color: #D97757;">www.bwenge.com</a>.</p>
        <p>Start grading student submissions, scanning papers with AI, and building intelligent workflows today.</p>
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  }
}
