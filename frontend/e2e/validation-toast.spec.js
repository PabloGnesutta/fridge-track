import { test, expect } from '@playwright/test';
import { ensureLocation } from './helpers.js';


test('missing name shows a toast, not the debug log panel', async ({ page }) => {
  await page.goto('/');
  await ensureLocation(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.click('#itemForm .submit');

  await expect(page.locator('#errorToast')).not.toHaveClass(/folded/);
  await expect(page.locator('#errorToast .message')).toHaveText('Ingresar nombre');
  await expect(page.locator('#logger')).toHaveClass(/display-none/);
});

test('missing due date/shelf-life shows the matching message', async ({ page }) => {
  await page.goto('/');
  await ensureLocation(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', 'Leche');
  await page.click('#itemForm .submit');

  await expect(page.locator('#errorToast .message'))
    .toHaveText('Ingresar una fecha de vencimiento o una duración en días');
});

test('a valid submission creates the item and closes the form', async ({ page }) => {
  await page.goto('/');
  await ensureLocation(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', 'Leche');
  await page.fill('#itemForm input[name="shelfLifeDays"]', '5');
  await page.click('#itemForm .submit');

  await expect(page.locator('#itemForm')).toBeHidden();
  await expect(page.locator('.list .row')).toHaveCount(1);
});
