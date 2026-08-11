import { defineConfig, devices } from '@playwright/test';


export default defineConfig({
  testDir: './e2e',
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
    command: 'node ../backend/src/index.js',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
