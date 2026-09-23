import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { branchFromStart, pickOrigin, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

async function quoted(page: Page): Promise<{ cost: number; credit: number }> {
  const price = page.locator('.cross__price')
  await expect(price).toHaveText(/^Costs \d+ of \d+ credit$/)
  const match = /Costs (\d+) of (\d+) credit/.exec((await price.textContent()) ?? '')
  const [, cost = '', credit = ''] = match ?? []
  return { cost: Number(cost), credit: Number(credit) }
}

test('picks the crossing origin from the strip by keyboard and marks it without moving the focus', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()

  const origin = page.getByRole('button', {
    name: 'From worldline A, use as the crossing origin',
  })
  await origin.focus()
  await origin.press('Enter')

  await expect(origin).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'data-origin',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('opens a crossing into the focused worldline', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()

  const origin = page.getByRole('button', {
    name: 'From worldline A, use as the crossing origin',
  })
  await origin.focus()
  await origin.press('Enter')
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()

  const { cost, credit } = await quoted(page)
  expect(cost).toBeGreaterThan(0)
  expect(credit).toBeGreaterThanOrEqual(cost)
  await expect(page.locator('.cross__price')).toHaveAttribute('role', 'status')

  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await expect(page.locator('.cross__price')).toHaveText(
    new RegExp(`^Costs \\d+ of ${credit - cost} credit$`),
  )

  await page.getByRole('button', { name: 'Observe' }).click()
  const arrival = page.locator('.events__item', { hasText: 'Received Knowledge from A' })
  await expect(arrival).toBeVisible()
  await expect(arrival.locator('.events__year')).toHaveText('0005')
})

test('warns that a doctrine crossing carries the allocation from before this year’s decision', async ({
  page,
}) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await page.getByRole('button', { name: 'Apply decision' }).click()

  await page.getByRole('button', { name: 'Focus on worldline B' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Doctrine' }).click()

  await expect(
    page.getByText(
      'A decision made this year only takes effect next year, so this carries the allocation A was following before it.',
    ),
  ).toBeVisible()
})

test('crossing in a past year creates a worldline', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)

  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 2; i++) await history.press('ArrowRight')
  await expect(page.getByTestId('year')).toHaveText('0002')

  await expect(
    page.getByText('Crossing in year 0002 creates a new worldline from that year.'),
  ).toBeVisible()
  const open = page.getByRole('button', { name: 'Cross in year 0002' })
  await expect(open).toBeEnabled()
  await open.click()

  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('From B, year 0002')).toBeVisible()
  await expect(page.getByTestId('year')).toHaveText('0005')

  await page.getByRole('button', { name: 'Observe' }).click()
  const arrival = page.locator('.events__item', { hasText: 'Received Knowledge from A' })
  await expect(arrival).toBeVisible()
  await expect(arrival.locator('.events__year')).toHaveText('0002')
})

test('says why a crossing cannot happen', async ({ page }) => {
  await worldAtYear(page, 5)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()

  await expect(
    page.getByText('Branch a second worldline first: a crossing needs somewhere to come from.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /From worldline/ })).toHaveCount(0)
  const open = page.getByRole('button', { name: 'Open the crossing' })
  await expect(open).toBeDisabled()
  await expect(open).toHaveAttribute('aria-describedby', 'cross-reason')
})

test('keeps the crossing after a reload from the link', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await expect(page).toHaveURL(/#\/m\//)

  // FIX: a travessia tem de voltar do endereço, não do que sobrou na memória
  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)

  await page.getByRole('button', { name: 'Focus on worldline B' }).click()
  await expect(page.getByTestId('year')).toHaveText('0005')
  const arrival = page.locator('.events__item', { hasText: 'Received Knowledge from A' })
  await expect(arrival).toBeVisible()
  await expect(arrival.locator('.events__year')).toHaveText('0005')
})
