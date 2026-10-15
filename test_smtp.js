import { getEmailSender, getVerificationEmailContent } from './server/email/EmailSender.js';

async function test() {
  console.log('Testing email sender...');
  console.log('EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER);
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('SMTP_USER:', process.env.SMTP_USER);

  const sender = getEmailSender();
  const content = getVerificationEmailContent('987654', 'en');

  try {
    await sender.send({
      to: 'niyibizisteven13@gmail.com',
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    console.log('Successfully sent test OTP email to niyibizisteven13@gmail.com!');
  } catch (err) {
    console.error('Failed to send test OTP email:', err);
  }
}

test();
