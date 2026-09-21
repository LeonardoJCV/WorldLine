import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?seed=482913')
})

test('shows the seed from the URL and starts at year zero', async ({ page }) => {
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByTestId('year')).toHaveText('0000')
})

test('plays and pauses time', async ({ page }) => {
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByTestId('year')).not.toHaveText('0000')
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  const paused = await page.getByTestId('year').textContent()
  await page.waitForTimeout(500)
  await expect(page.getByTestId('year')).toHaveText(paused ?? '')
})

test('advances one year at a time', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  await step.click()
  await step.click()
  await expect(page.getByTestId('year')).toHaveText('0002')
})

test('switches language and remembers the choice', async ({ page }) => {
  await page.getByRole('button', { name: 'Português' }).click()
  await expect(page.getByRole('button', { name: 'Reproduzir' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reproduzir' })).toBeVisible()
})

test('runs without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.reload()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(800)
  expect(errors).toEqual([])
})
