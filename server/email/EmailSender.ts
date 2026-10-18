import * as nodemailer from 'nodemailer';

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
      html: options.html,
    });
  }
}

export function hasSmtpConfiguration(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function validateEmailSenderConfiguration(): void {
  if (process.env.NODE_ENV === 'production' && !hasSmtpConfiguration()) {
    console.error('Email delivery is unavailable: production requires SMTP_HOST, SMTP_USER, and SMTP_PASS. OTP sending is disabled until configured.');
  }
}

export function getEmailSender(): EmailSender {
  if (process.env.NODE_ENV === 'production') {
    if (!hasSmtpConfiguration()) {
      throw new Error('Production email delivery requires SMTP_HOST, SMTP_USER, and SMTP_PASS');
    }
    return new SmtpEmailSender();
  }

  const provider = process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST || process.env.SMTP_USER ? 'smtp' : 'console');
  if (provider === 'smtp' || provider === 'resend' || provider === 'sendgrid') {
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
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #101114; color: #FAF9F5; border-radius: 12px;">
          <h2 style="color: #D97757;">Bwenge</h2>
          <p>Kode yawe yo kwinjira:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #D97757; margin: 20px 0;">${code}</div>
          <p style="font-size: 12px; color: #888;">Irangira mu minota 10. Niba utabisabye, irengagize.</p>
        </div>
      `,
    };
  }
  if (loc.startsWith('fr')) {
    return {
      subject: `${code} est votre code Bwenge`,
      text: `${code} est votre code de connexion Bwenge. Il expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail.`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #101114; color: #FAF9F5; border-radius: 12px;">
          <h2 style="color: #D97757;">Bwenge</h2>
          <p>Votre code de vérification :</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #D97757; margin: 20px 0;">${code}</div>
          <p style="font-size: 12px; color: #888;">Il expire dans 10 minutes. Si vous n'avez pas demandé ce code, ignorez cet e-mail.</p>
        </div>
      `,
    };
  }
  // Default EN
  return {
    subject: `${code} is your Bwenge code`,
    text: `${code} is your Bwenge login verification code. It expires in 10 minutes. If you didn't ask for this, ignore this email.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #101114; color: #FAF9F5; border-radius: 12px;">
        <h2 style="color: #D97757;">Bwenge</h2>
        <p>Your one-time login verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #D97757; margin: 20px 0;">${code}</div>
        <p style="font-size: 12px; color: #888;">It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>
      </div>
    `,
  };
}
