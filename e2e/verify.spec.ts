import { expect, test } from '@playwright/test'

test('reproduces every reference world in this browser', async ({ page }) => {
  await page.goto('/verify.html')
  await expect(page.getByRole('status')).toHaveText('All 12 fingerprints match in this browser.', {
    timeout: 60_000,
  })
  await expect(page.locator('tbody tr[data-ok="true"]')).toHaveCount(12)
})
