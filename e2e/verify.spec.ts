import { expect, test } from '@playwright/test'

test('reproduces every reference world in this browser', async ({ page }) => {
  await page.goto('/verify.html')
  const status = page.getByRole('status')
  await expect(status.first()).toHaveText('All 14 fingerprints match in this browser.', {
    timeout: 60_000,
  })
  await expect(page.locator('table').first().locator('tbody tr[data-ok="true"]')).toHaveCount(14)
})

test('reproduces the collapse, and its fingerprint, in this browser', async ({ page }) => {
  await page.goto('/verify.html')
  const status = page.getByRole('status')
  await expect(status.last()).toHaveText(
    'The collapse and its fingerprint match in this browser.',
    { timeout: 60_000 },
  )
  const row = page.locator('table').last().locator('tbody tr')
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute('data-ok', 'true')
})
