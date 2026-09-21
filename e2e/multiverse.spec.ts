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
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  // Wait for the panel to settle on the observed allocation before editing: the
  // sliders stay disabled until then, so editing too early would be discarded
  // once the panel catches up.
  await expect(branch).toBeEnabled()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await branch.click()
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

test('shows the allocation of the observed year, not the present, when branching before a later decision', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await page.getByRole('button', { name: 'Intervene' }).click()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await page.getByRole('button', { name: 'Apply decision' }).click()
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 3; i++) await step.click()

  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  // Year 0 is before the decision applied at year 5: the sliders must fall back
  // to the default allocation, not the present (post-decision) one.
  await expect(agriculture).toHaveValue('40')

  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  await branch.click()
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('vs A')).toBeVisible()

  // The branch was made without touching the sliders, so up to the year of the
  // original decision (5) it must retrace A exactly: no arrows in the "vs A" column.
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 4; i++) await history.press('ArrowRight')
  await expect(page.locator('.state__origin')).toHaveCount(7)
  await expect(
    page.locator('.state__origin[data-direction="up"], .state__origin[data-direction="down"]'),
  ).toHaveCount(0)
})

test('keeps the edited allocation when branching, so the new worldline actually diverges', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  // The edited allocation must have stuck (not been discarded by a remount),
  // so after enough years the branch measurably differs from its origin.
  await expect(page.getByText('Distance 0.00')).toHaveCount(0)
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
