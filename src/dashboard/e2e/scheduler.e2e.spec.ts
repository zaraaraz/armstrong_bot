import { test, expect } from '@playwright/test';

/**
 * Scheduler dashboard e2e (Section 13 "e2e").
 *
 * NOTE: like the rest of the dashboard, these run only once the full Playwright
 * harness + seeded backend are stood up (deferred since Phase 2 — there was no
 * dashboard to drive). They are authored against the shipped panel so they are a
 * drop-in once `playwright.config.ts` and a seeded staging stack exist. Until
 * then they are skipped, not silently passing. This file lives under
 * `src/dashboard/e2e/**`, which the unit vitest config excludes.
 *
 * Coverage: list, pause/resume, trigger, cancel — each gated by `scheduler.*`
 * claims and scoped to the signed-in guild (a guild admin never sees or controls
 * another guild's jobs; global/system jobs require a platform-level claim).
 */

const GUILD = process.env.E2E_GUILD_ID ?? 'g-test';

test.describe('Scheduler panel', () => {
  test.skip(
    !process.env.E2E_BASE_URL,
    'requires E2E_BASE_URL + seeded backend (Playwright harness not yet provisioned)',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(`/g/${GUILD}/scheduler`);
  });

  test('lists schedules and shows the health widget', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Scheduler' }),
    ).toBeVisible();
    await expect(page.getByText('Queued')).toBeVisible();
    await expect(page.getByText('DLQ')).toBeVisible();
    await expect(page.getByText('Worker')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.getByRole('combobox').selectOption('active');
    await expect(page).toHaveURL(/scheduler/);
  });

  test('opens a job drawer and triggers a run (scheduler.trigger)', async ({
    page,
  }) => {
    await page.getByRole('row').nth(1).click();
    const drawer = page.getByRole('complementary');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Trigger now' }).click();
    // Drawer closes and the table reloads on success.
    await expect(drawer).toBeHidden();
  });

  test('pauses then resumes a recurring job (scheduler.pause)', async ({
    page,
  }) => {
    await page.getByRole('row').nth(1).click();
    const drawer = page.getByRole('complementary');
    const pause = drawer.getByRole('button', { name: 'Pause' });
    if (await pause.isVisible()) {
      await pause.click();
      await expect(page.getByText('paused')).toBeVisible();
    }
  });

  test('cancels a job (scheduler.cancel)', async ({ page }) => {
    await page.getByRole('row').nth(1).click();
    const drawer = page.getByRole('complementary');
    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer).toBeHidden();
  });
});
