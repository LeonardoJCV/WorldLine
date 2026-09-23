import { expect, type Page } from '@playwright/test'

export async function worldAtYear(page: Page, years: number) {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < years; i++) await step.click()
}

export async function branchFromStart(page: Page) {
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

export async function pickOrigin(page: Page, id = 'A') {
  await page.getByRole('button', { name: `From worldline ${id}`, exact: true }).click()
}

async function branchFromStartInto(page: Page, born: string, tune?: (page: Page) => Promise<void>) {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  if (tune) await tune(page)
  await branch.click()
  await expect(page.getByRole('button', { name: `Focus on worldline ${born}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

// FEAT: um presente grande demais num mundo que nunca pesquisa nunca quita, e vira paradoxo
export async function installParadox(page: Page) {
  await worldAtYear(page, 5)
  // FEAT: o crédito nasce das realidades vivas, e uma travessia deste tamanho custa dez
  for (const id of ['B', 'C', 'D', 'E']) await branchFromStartInto(page, id)
  await branchFromStartInto(page, 'F', async (target) => {
    await target.getByRole('slider', { name: /Research/ }).fill('0')
  })
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A great deal' }).click()
  const open = page.getByRole('button', { name: 'Open the crossing' })
  await expect(open).toBeEnabled()
  await open.click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await page.getByRole('button', { name: 'Observe' }).click()
}

// FEAT: oitenta anos de dívida acima do limite antes de a história deixar de se sustentar
export async function runToParadox(page: Page) {
  await page.getByRole('button', { name: '×16' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.paradox[data-state="warning"]')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
}
