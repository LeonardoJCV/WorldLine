import { expect, test } from '@playwright/test'

test('remembers the graphics choice', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Graphics' }).click()
  await page.getByRole('radio', { name: 'Low' }).check()
  await page.reload()
  await page.getByRole('button', { name: 'Graphics' }).click()
  await expect(page.getByRole('radio', { name: 'Low' })).toBeChecked()
})

test('closes the graphics menu with Escape', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Graphics' }).click()
  await expect(page.getByRole('radio', { name: '2D' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radio', { name: '2D' })).toHaveCount(0)
})
