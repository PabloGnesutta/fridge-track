import { getMailTransport } from './mailClient.js';
import { renderEmailHtml } from '../lib/emailTemplate.js';
import { log, error } from '../logger/logger.js';

/**
 * Injectable mail client, same shape/purpose as recipeService.js's
 * edamamClient param: production code gets the real nodemailer transport,
 * tests pass a stub with no network/SMTP config required.
 * @param {{getMailTransport: () => import('nodemailer').Transporter}} [mailClient]
 */
function createEmailService(mailClient = { getMailTransport }) {
  /**
   * Sends a plain-text email, auto-wrapped in a basic styled HTML document
   * (see lib/emailTemplate.js) unless the caller already has HTML to send.
   * Never throws - logs and returns false on missing config or a transport
   * failure, true on success, same best-effort/log-and-continue contract as
   * the push scheduler, so a caller can fire-and-forget without a try/catch.
   * @param {{to: string, subject: string, text?: string, html?: string, appName?: string}} opts
   * @returns {Promise<boolean>}
   */
  async function sendEmail({ to, subject, text, html, appName }) {
    try {
      if (!to || !subject || (!text && !html)) {
        error('sendEmail requires "to", "subject", and either "text" or "html".');
        return false;
      }

      const transport = mailClient.getMailTransport();
      const finalHtml = html ?? renderEmailHtml({
        title: subject,
        bodyText: text,
        appName: appName ?? process.env.MAIL_APP_NAME ?? 'App',
      });

      const info = await transport.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text,
        html: finalHtml,
      });
      log('Email sent OK:', info.messageId || info);
      return true;
    } catch (err) {
      error('Send email failed:', err.message);
      return false;
    }
  }

  return { sendEmail };
}

export { createEmailService };
