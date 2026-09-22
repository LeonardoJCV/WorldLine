import { expect, test } from '@playwright/test'

test('opens on genesis and starts a world from a word', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Every decision creates a different future.' }),
  ).toBeVisible()
  await page.getByLabel('Seed (a number or a word)').fill('atlantis')
  await expect(page.getByText('World #3286682525')).toBeVisible()
  await expect(page.getByText('Soil fertility')).toBeVisible()
  await page.getByRole('button', { name: 'Start worldline' }).click()
  await expect(page.getByTestId('seed')).toHaveText('3286682525')
  await expect(page.getByTestId('year')).toHaveText('0000')
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/)
})

test('refuses seeds outside the range', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Seed (a number or a word)').fill('99999999999')
  await expect(page.getByText('Use a word, or a whole number up to 4294967295.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start worldline' })).toBeDisabled()
})

test('opens a shared world link', async ({ page }) => {
  await page.goto('/#/w/AQAHXmEAAAAA')
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByText('This link was made with model')).toHaveCount(0)
})

test('warns only about a link from a model it does not know', async ({ page }) => {
  await page.goto('/#/w/BwAHXmEAAAAA')
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByText('This link was made with model v7')).toBeVisible()
})

test('keeps the world and its year across a reload', async ({ page }) => {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 3; i++) await step.click()
  await expect(page.getByTestId('year')).toHaveText('0003')
  await expect(page).toHaveURL(/#\/w\//)
  await page.reload()
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page.getByTestId('year')).toHaveText('0003')
})

test('returns to genesis for a new world', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'New world' }).click()
  await expect(page.getByRole('button', { name: 'Start worldline' })).toBeVisible()
})
