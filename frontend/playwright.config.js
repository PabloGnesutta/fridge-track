import { defineConfig, devices } from '@playwright/test';


export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/globalTeardown.js',
  // Parallel workers each launch their own Chromium instance; running more
  // than one at a time overwhelms this dev machine and causes spurious
  // navigation timeouts. The full suite runs in under 10s serially anyway.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node ../backend/src/index.fridge.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    // Blank out SMTP_* so this server can't send real mail through
    // backend/.env's live credentials - dotenv's configEnv() call in
    // index.fridge.js never overrides a var that's already a key in
    // process.env (even an empty-string one), so this wins over the .env
    // file. Every e2e signup (helpers.js's ensureAuth, run on nearly every
    // spec via ensureOnboarded) triggers a real verification-email send
    // otherwise, since createUser()'s emailService.sendEmail() has no
    // test-awareness of its own. mailClient.js's getMailTransport() then
    // throws "not configured", which emailService.sendEmail() already
    // catches and no-ops on by design - e2e never reads the code from an
    // inbox anyway (readVerificationCode() pulls it straight out of sqlite),
    // so nothing here depends on the email actually going out.
    env: { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' },
  },
});
