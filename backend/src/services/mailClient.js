import nodemailer from 'nodemailer';

/**
 * Thin wrapper around nodemailer's SMTP transport - SMTP rather than a
 * provider-specific API (SES/SendGrid/Postmark/...) so swapping providers
 * later is just swapping env vars, and this file ports unchanged to another
 * project. Configured lazily inside getMailTransport(), not at module top
 * level: this module is reachable via a static import chain from index.js
 * (through emailService.js), and ES module imports are hoisted - they all
 * evaluate before index.js's own configEnv() dotenv call runs, so reading
 * process.env.SMTP_* here at import time would always see undefined. Same
 * ESM-ordering quirk webPushClient.js and edamamClient.js already document.
 */

let transport = null;

/**
 * @returns {import('nodemailer').Transporter}
 * @throws {Error} if SMTP_HOST/SMTP_USER/SMTP_PASS aren't set
 */
function getMailTransport() {
  if (transport) { return transport; }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'Email is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASS (see backend/.env.example).'
    );
  }

  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT ? Number(SMTP_PORT) : 587,
    secure: SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transport;
}

export { getMailTransport };
