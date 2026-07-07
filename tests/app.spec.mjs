import { test, expect } from '@playwright/test';

/* ------------------------------------------------------------------
 * End-to-end tests for the Spark Homes Repair Estimator.
 * These drive the real app in an emulated phone browser — the same way
 * an acquisition agent (and the contest reviewer) would use it.
 * ------------------------------------------------------------------ */

// Reset to a clean, empty project (dismissing the first-run welcome).
async function startFresh(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  if (await page.locator('.welcome').count()) {
    await page.locator('.welcome [data-action="new-project"]').click();
    await page.locator('#sheet-input').fill('Test Estimate');
    await page.locator('[data-action="sheet-ok"]').click();
  }
  await expect(page.locator('#hdr-total')).toBeVisible();
}

test('first run shows the welcome screen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.welcome')).toBeVisible();
});

test('demo loads a populated estimate', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-action="load-demo"]').click();
  await expect(page.locator('#hdr-total')).not.toHaveText('$0');
});

test('checking an item + quantity updates the running total and progress', async ({ page }) => {
  await startFresh(page);
  await page.locator('.group__head').first().click();
  await page.locator('.item .check').first().click();
  await page.locator('.stepper input').first().fill('25');
  await page.locator('.stepper input').first().blur();
  await expect(page.locator('#hdr-total')).not.toHaveText('$0');
  await expect(page.locator('#pgtxt')).toContainText('groups');
});

test('"No Action Needed" marks a group reviewed', async ({ page }) => {
  await startFresh(page);
  await page.locator('.group__head').nth(2).click();          // open an empty group
  await page.locator('.group .noaction').last().click();
  await expect(page.locator('.group .noaction.on')).toHaveCount(1);
});

test('rooms: add a Bedroom; whole-house rooms are singletons', async ({ page }) => {
  await startFresh(page);
  await page.locator('.roomtab__add').click();
  await page.locator('.roomopt:has-text("Bedroom")').click();
  await expect(page.locator('.roomtab', { hasText: 'Bedroom' })).toBeVisible();
  // a second Interior must not be addable
  await page.locator('.roomtab__add').click();
  await expect(page.locator('.roomopt:has-text("Interior")[disabled]')).toHaveCount(1);
});

test('Deal Analyzer computes profit and a verdict', async ({ page }) => {
  await startFresh(page);
  await page.locator('[data-action="open-deal"]').click();
  await page.locator('[data-field="purchase"]').fill('95000');
  await page.locator('[data-field="arv"]').fill('185000');
  await expect(page.locator('.deal__badge')).toContainText('Good Deal');
});

test('project name is escaped (no HTML injection)', async ({ page }) => {
  await startFresh(page);
  await page.locator('[data-action="rename-project"]').click();
  await page.locator('#sheet-input').fill('123 "Main" <b>St</b>');
  await page.locator('[data-action="sheet-ok"]').click();
  await expect(page.locator('.appbar__meta .name b')).toHaveCount(0);
});

test('export downloads a ZIP', async ({ page }) => {
  await startFresh(page);
  await page.locator('.group__head').first().click();
  await page.locator('.item .check').first().click();
  await page.locator('.stepper input').first().fill('30');
  await page.locator('.stepper input').first().blur();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="export"]').first().click(),
  ]);
  expect(await download.suggestedFilename()).toMatch(/\.zip$/);
});

test('state persists across a reload', async ({ page }) => {
  await startFresh(page);
  await page.locator('.group__head').first().click();
  await page.locator('.item .check').first().click();
  await page.locator('.stepper input').first().fill('10');
  await page.locator('.stepper input').first().blur();
  const total = (await page.locator('#hdr-total').textContent()).trim();
  await page.reload();
  await expect(page.locator('#hdr-total')).toHaveText(total);
});

test('works offline after first load (service worker)', async ({ page, context }) => {
  await startFresh(page);
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller != null,
    null, { timeout: 10_000 },
  ).catch(() => {});
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#hdr-total')).toBeVisible();   // boots with no network
});
