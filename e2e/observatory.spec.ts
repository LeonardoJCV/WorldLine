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

test('moves through time with the keyboard', async ({ page }) => {
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 12; i++) await step.click()
  await expect(page.getByTestId('year')).toHaveText('0012')
  const current = page.getByRole('slider')
  await current.focus()
  await current.press('ArrowLeft')
  await expect(page.getByTestId('year')).toHaveText('0011')
  await current.press('Shift+ArrowLeft')
  await expect(page.getByTestId('year')).toHaveText('0001')
  await current.press('End')
  await expect(page.getByTestId('year')).toHaveText('0012')
  await expect(page.getByRole('button', { name: 'Return to the present' })).toHaveCount(0)
})

test('scrubs the past with the pointer', async ({ page }) => {
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const current = page.getByRole('slider')
  const box = await current.boundingBox()
  if (!box) throw new Error('current is not visible')
  await page.mouse.click(box.x + 40, box.y + box.height / 2)
  await expect(page.getByRole('button', { name: 'Return to the present' })).toBeVisible()
  const year = Number(await page.getByTestId('year').textContent())
  const present = Number(await current.getAttribute('aria-valuemax'))
  expect(year).toBeLessThan(present / 2)
})

test('lists every variable in the legend', async ({ page }) => {
  const legend = page.getByRole('list', { name: 'Variables' })
  for (const name of ['Population', 'Food', 'Energy', 'Technology', 'Economy', 'Environment']) {
    await expect(legend.getByText(name)).toBeVisible()
  }
})
