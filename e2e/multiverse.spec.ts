import { expect, test, type Page } from '@playwright/test'

async function worldAtYear(page: Page, years: number) {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < years; i++) await step.click()
}

// FIX: a tira também oferece "From worldline A"; escopa ao grupo do painel
async function pickOrigin(page: Page) {
  await page
    .getByRole('group', { name: 'Where it comes from' })
    .getByRole('button', { name: 'From worldline A' })
    .click()
}

async function branchFromStart(page: Page) {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  // espera o painel carregar o ano observado
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
  // ano 0 vem antes da decisão: volta à alocação padrão
  await expect(agriculture).toHaveValue('40')

  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  await branch.click()
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('vs A')).toBeVisible()

  // ramo copia A até a decisão: sem divergência em "vs A"
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
  // alocação editada persiste no ramo
  await expect(page.getByText('Distance 0.00')).toHaveCount(0)
})

test('stops branching at six worldlines', async ({ page }) => {
  test.slow()
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

test('keeps the keyboard and the choices when a crossing origin is picked', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  const supplies = page.getByRole('button', { name: 'Supplies' })
  await supplies.click()
  const origin = page.getByRole('button', { name: 'From worldline A' })
  await origin.focus()
  await page.keyboard.press('Enter')
  await expect(origin).toHaveAttribute('aria-pressed', 'true')
  await expect(origin).toBeFocused()
  await expect(supplies).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Open the crossing' })).toBeEnabled()
})

test('announces a crossing only once the worker has recorded it', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await page.getByRole('button', { name: 'From worldline A' }).click()
  const arrived = page.getByText('Knowledge arrived from A.')
  await expect(arrived).toHaveCount(0)
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(arrived).toBeVisible()
  await expect(page.locator('.notices p')).toHaveCount(0)
})
test('files an arriving crossing among the events of the worldline that received it', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  const arrival = page.locator('.events__item', { hasText: 'Received Knowledge from A' })
  await expect(arrival).toBeVisible()
  await expect(arrival.locator('.events__year')).toHaveText('0005')
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(page.locator('.events__item', { hasText: 'Received Knowledge from A' })).toHaveCount(
    0,
  )
})

test('shows the departure in the worldline the people left', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'People' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.events__item', { hasText: 'Received People from A' })).toBeVisible()
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(page.locator('.events__item', { hasText: 'People left for B' })).toBeVisible()
})

test('shows the crossing as a cause of the events it changed', async ({ page }) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Doctrine' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const golden = page.locator('.events__item', { hasText: 'Golden age' }).first()
  await expect(golden).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await golden.click()
  await expect(
    page.locator('.causal__node[data-kind="crossing"]', { hasText: 'Doctrine that crossed in' }),
  ).toBeVisible()
})
