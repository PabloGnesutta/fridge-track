import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';


test.describe('notification toggles (header menu)', () => {
  test('email defaults on; push defaults off with no subscription yet', async ({ page }) => {
    await page.goto('/');
    await ensureOnboarded(page);

    // The stored pushEnabled preference defaults true (matches the DB
    // column's DEFAULT 1), but the toggle isn't really "on" until this
    // device has an actual subscription - a fresh signup has none yet, so
    // it should render unchecked despite the underlying preference.
    await page.click('#headerMenuBtn .btn');
    await expect(page.locator('#pushNotifToggle')).not.toBeChecked();
    await expect(page.locator('#emailNotifToggle')).toBeChecked();
  });

  test('email toggle persists across a reload', async ({ page }) => {
    await page.goto('/');
    await ensureOnboarded(page);

    await page.click('#headerMenuBtn .btn');
    const emailToggle = page.locator('#emailNotifToggle');
    await emailToggle.uncheck();
    // Waits on the localStorage write rather than a fixed timeout - the
    // toggle's change handler round-trips to the backend before persisting,
    // so the checkbox itself flips before that write actually lands.
    await page.waitForFunction(() => localStorage.getItem('emailEnabled') === '0');

    await page.reload();
    await page.click('#headerMenuBtn .btn');
    await expect(page.locator('#emailNotifToggle')).not.toBeChecked();
  });

  test('push toggle stays off and shows a toast when the browser denies permission', async ({ page }) => {
    await page.goto('/');
    await ensureOnboarded(page);

    // Headless Chromium has no real push service to grant/deny against -
    // override requestPermission directly (same class of substitution as
    // voice-item.spec.js's FakeSpeechRecognition) to deterministically
    // exercise the "browser blocked it" path without depending on whatever
    // the environment's default permission state happens to be.
    await page.evaluate(() => {
      // @ts-ignore
      window.Notification.requestPermission = async () => 'denied';
    });

    await page.click('#headerMenuBtn .btn');
    const pushToggle = page.locator('#pushNotifToggle');
    await expect(pushToggle).not.toBeChecked(); // starts off - no subscription yet

    await pushToggle.click();

    await expect(pushToggle).not.toBeChecked();
    await expect(page.locator('#errorToast')).not.toHaveClass(/folded/);
  });

  test('push toggle turns on after a successful subscribe, and stays on when the menu is reopened', async ({ page }) => {
    await page.goto('/');
    await ensureOnboarded(page);

    // Mocks the browser push plumbing a real subscribe attempt goes
    // through - permission grant, then the actual PushManager methods on
    // the real service worker registration this app already registers.
    // Everything else (the VAPID-key fetch, saving the subscription) hits
    // the real backend, same as any other e2e test.
    await page.evaluate(async () => {
      // @ts-ignore
      window.Notification.requestPermission = async () => 'granted';
      // requestPermission() and the `permission` property are separate -
      // hasActiveSubscription() reads the property directly, so it needs
      // its own override (it's a read-only accessor, not a plain field).
      Object.defineProperty(window.Notification, 'permission', { value: 'granted', configurable: true });
      const registration = await navigator.serviceWorker.ready;
      const fakeSubscription = {
        endpoint: 'https://push.example/fake',
        toJSON: () => ({ endpoint: 'https://push.example/fake', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
      };
      // getSubscription() only starts reporting one once subscribe() has
      // actually been called - otherwise this device would look
      // already-subscribed before the test even opens the menu once.
      let currentSubscription = null;
      registration.pushManager.subscribe = async () => { currentSubscription = fakeSubscription; return fakeSubscription; };
      registration.pushManager.getSubscription = async () => currentSubscription;
    });

    await page.click('#headerMenuBtn .btn');
    const pushToggle = page.locator('#pushNotifToggle');
    await expect(pushToggle).not.toBeChecked();

    await pushToggle.check();
    await page.waitForFunction(() => localStorage.getItem('pushEnabled') === '1');
    await expect(pushToggle).toBeChecked();

    // Closing and reopening re-derives the checked state from the (now
    // mocked) live subscription rather than just replaying the cached
    // preference, so this also proves refreshPushToggleState() actually ran.
    await page.click('.page-title');
    await page.click('#headerMenuBtn .btn');
    await expect(pushToggle).toBeChecked();
  });
});
