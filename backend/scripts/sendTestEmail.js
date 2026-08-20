/**
 * One-off manual check that backend/.env's SMTP_* values actually work -
 * not part of the test suite (hits a real network/SMTP server), just a
 * throwaway dev utility. Run with:
 *   npm run send-test-email -- you@example.com
 * (defaults to sending to SMTP_USER if no address is given).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as configEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
configEnv({ path: join(__dirname, '../.env') });

const { createEmailService } = await import('../src/services/emailService.js');

const to = process.argv[2] || process.env.SMTP_USER;
if (!to) {
  console.error('Usage: npm run send-test-email -- you@example.com');
  process.exit(1);
}

const { sendEmail } = createEmailService();

const success = await sendEmail({
  to,
  subject: 'FridgeTrack - test email',
  text: 'Si estás leyendo esto, la configuración de SMTP funciona.\n\nEnviado desde scripts/sendTestEmail.js.',
});

if (!success) {
  process.exit(1)
}
