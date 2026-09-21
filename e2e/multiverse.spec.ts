import { expect, test, type Page } from '@playwright/test'

async function worldAtYear(page: Page, years: number) {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < years; i++) await step.click()
}

async function branchFromStart(page: Page) {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await page.getByRole('button', { name: 'Branch from year 0000' }).click()
}

test('branches from the past into a new focused worldline', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('From A, year 0000')).toBeVisible()
  await expect(page.getByTestId('year')).toHaveText('0005')
  await expect(page.getByText('vs A')).toBeVisible()
})

test('switches focus between worldlines', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('vs A')).toHaveCount(0)
})

test('removes a worldline after confirmation', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Remove worldline B' }).click()
  await expect(page.getByText('Remove B and every worldline that branched from it?')).toBeVisible()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveCount(0)
})

test('keeps the multiverse in the link across a reload', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await expect(page).toHaveURL(/#\/m\//)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toBeVisible()
  await expect(page.getByTestId('year')).toHaveText('0005')
})

test('stops branching at six worldlines', async ({ page }) => {
  await worldAtYear(page, 5)
  for (let i = 0; i < 5; i++) {
    await branchFromStart(page)
    await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  }
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  await expect(page.getByText('Six worldlines is the limit; remove one to branch.')).toBeVisible()
})
