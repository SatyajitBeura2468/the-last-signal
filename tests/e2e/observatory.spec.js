import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
});

test('boots the receiver and exposes six authoritative destinations', async ({ page }) => {
  await expect(page).toHaveTitle('The Last Signal');
  await expect(page.locator('h1')).toHaveText('THE LAST SIGNAL');
  await expect(page.locator('[data-destination]')).toHaveCount(6);
  await expect(page.locator('#tuner-marker')).toHaveAttribute('role', 'slider');
  await expect(page.locator('#waterfall-canvas')).toBeVisible();
});

test('target selection changes the mission and opens a timed command', async ({ page, isMobile }) => {
  const skyTrigger = isMobile
    ? page.locator('[data-mobile-destination="sky"]')
    : page.locator('[data-destination="sky"]');
  await skyTrigger.click();
  await expect(page.locator('#observatory-world-title')).toHaveText('SKY CONTROL');
  const sector = page.locator('[data-select-sector="aquila"]');
  await sector.click();
  await expect(page.locator('body')).toHaveAttribute('data-command-type', 'SLEW_TARGET');
  await expect(sector).toHaveClass(/active/);
});

test('mobile shell has no horizontal page overflow and keeps controls above the dock', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only shell assertion');
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    dockTop: document.querySelector('.mobile-observatory-dock').getBoundingClientRect().top,
    controlsBottom: document.querySelector('.mode-bar').getBoundingClientRect().bottom,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.controlsBottom).toBeLessThanOrEqual(dimensions.dockTop);
  await expect(page.locator('.mobile-observatory-dock')).toBeVisible();
});

test('completes the evidence-gated mission chain through the real controls', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The complete workflow is covered once in the desktop project');
  test.setTimeout(90_000);
  await page.goto('/?e2e=1');
  await page.locator('#boot-screen').waitFor({ state: 'detached' });

  await expect.poll(
    async () => Number(await page.locator('body').getAttribute('data-array-slew')),
    { timeout: 20_000 },
  ).toBeGreaterThan(0.94);
  await expect.poll(async () => {
    if (await page.locator('#lock-caption').textContent() === 'LOCKED SIGNAL') return true;
    if (await page.locator('body').getAttribute('data-telemetry-lockable') === 'true') {
      await page.locator('#lock-button').click();
    }
    return false;
  }, { timeout: 15_000, intervals: [80, 160, 320] }).toBe(true);

  await page.locator('[data-destination="lab"]').click();
  for (const filter of ['rfi', 'doppler']) {
    await expect.poll(async () => {
      const control = page.locator(`[data-toggle-filter="${filter}"]`);
      if ((await control.getAttribute('class') ?? '').includes('active')) return true;
      await control.click();
      return false;
    }, { timeout: 10_000, intervals: [160, 320, 640] }).toBe(true);
  }
  await expect.poll(async () => {
    const match = Number((await page.locator('.correlation-bay header b').textContent())?.match(/\d+/)?.[0]);
    if (match >= 55) return match;
    await page.locator('[data-lab-action="correlate"]').click();
    return match;
  }, { timeout: 15_000, intervals: [240, 480, 960] }).toBeGreaterThanOrEqual(55);

  await page.locator('[data-world-tab="sky"]').click();
  await expect.poll(async () => {
    const revisit = await page.locator('#mission-revisit-state').textContent();
    if (revisit === 'QUEUED' || revisit === 'CONFIRMED') return revisit;
    await page.locator('[data-nav-action="schedule"]').click();
    return revisit;
  }, { timeout: 10_000, intervals: [240, 480, 960] }).toMatch(/QUEUED|CONFIRMED/);
  await expect.poll(async () => {
    const revisit = await page.locator('#mission-revisit-state').textContent();
    if (revisit === 'CONFIRMED') return revisit;
    await page.locator('[data-nav-action="optimize"]').click();
    return revisit;
  }, { timeout: 15_000, intervals: [240, 480, 960] }).toBe('CONFIRMED');

  await page.locator('[data-world-tab="lab"]').click();
  await expect.poll(async () => {
    const committed = await page.locator('#mission-evidence-state').textContent();
    if (committed === 'COMMITTED') return committed;
    await page.locator('[data-lab-action="commit"]').click();
    return committed;
  }, { timeout: 10_000, intervals: [240, 480, 960] }).toBe('COMMITTED');

  await page.locator('[data-world-tab="evidence"]').click();
  await expect(page.locator('.evidence-board')).toContainText('1 SEALED ITEMS');
  await expect(page.locator('.evidence-board')).toContainText('TLS-4217812651');
  await page.locator('.observatory-world-close').click();
  await page.locator('#decode-button').click();
  await expect(page.locator('#decode-progress-value')).toHaveText('100%', { timeout: 12_000 });
});
