import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
});

test('has no serious or critical automated accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
});

test('supports keyboard tuning and dialog focus restoration', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard flow is validated in the desktop project');
  const slider = page.locator('#tuner-marker');
  await slider.focus();
  const before = Number(await slider.getAttribute('aria-valuenow'));
  await slider.press('ArrowRight');
  const after = Number(await slider.getAttribute('aria-valuenow'));
  expect(after).toBeGreaterThan(before);

  const trigger = page.locator('[data-destination="lab"]');
  await trigger.focus();
  await trigger.press('Enter');
  await expect(page.locator('#observatory-world')).toBeVisible();
  await expect(page.locator('.observatory-world-close')).toBeFocused();
  await page.locator('.observatory-world-close').press('Escape');
  await expect(page.locator('#observatory-world')).toBeHidden();
  await expect(trigger).toBeFocused();
});
