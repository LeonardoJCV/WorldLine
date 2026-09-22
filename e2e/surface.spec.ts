import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

const stage = (page: import('@playwright/test').Page) => page.locator('main.stage')

test('opens the planet from the currents and returns', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.getByRole('img', { name: /Planet surface in year/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('survives a rapid double-click into the planet', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?seed=482913')
  const enter = page.getByRole('button', { name: 'View planet' })
  // FIX: dois cliques quase simultâneos reaproveitam a mesma promise do mergulho, sem travar a entrada
  await Promise.all([enter.click(), enter.click()])
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet', { timeout: 5_000 })
  expect(errors).toEqual([])
})

test('zooms to the region and back to orbit', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Region' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Orbit' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'orbit', { timeout: 10_000 })
})

test('leaves the planet with Escape', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('img', { name: /Planet surface/ }).press('Escape')
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('keeps the planet view in the link', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page).toHaveURL(/\/planet$/)
  await page.reload()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
})

test('keeps time controls working inside the planet', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0001')
  await expect(page.getByRole('img', { name: 'Planet surface in year 0001' })).toBeVisible()
})

test('has no planet view in 2D', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.goto('/?seed=482913')
  await expect(page.getByRole('button', { name: 'View planet' })).toHaveCount(0)
})

test('runs the planet without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await page.waitForTimeout(2500)
  expect(errors).toEqual([])
})
