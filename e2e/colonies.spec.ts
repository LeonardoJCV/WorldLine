import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { worldAtYear } from './support.ts'

// FEAT: mesma alocação do roteiro dourado SPACEFARING (golden.ts), a única calibrada a abrir a
// era espacial perto do ano 1800 nesta semente (calibration.test.ts, "the quickest path to the sky")
async function turnToSpace(page: Page) {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Intervene' }).click()
  // FIX: cada slider reequilibra os outros pela proporção atual; esta ordem é a única, achada por
  // busca, que sai do padrão inicial (40/30/20/10) e pousa exatamente em 20/50/30/0
  await page.getByRole('slider', { name: /Agriculture/ }).fill('20')
  await page.getByRole('slider', { name: /Research/ }).fill('30')
  await page.getByRole('slider', { name: /Conservation/ }).fill('0')
  await page.getByRole('slider', { name: /Industry/ }).fill('50')
  await page.getByRole('button', { name: 'Apply decision' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×64' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
}

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

test('shows how far a history has settled once it reaches the space era', async ({ page }) => {
  test.setTimeout(120_000)
  await turnToSpace(page)

  const colonies = page.locator('.state__colonies')
  // FEAT: dezoito séculos de indústria e pesquisa até o portão abrir (calibration.test.ts)
  await expect(colonies).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Pause' }).click()

  await expect(colonies).toContainText('Colonies')
  await expect(colonies).toContainText(/One on \S+|\d+, the largest on \S+/)
  await expect(colonies).toContainText(/self-sufficient|still supported from home/)
})

test('has no colonies line on a worldline that never leaves its planet', async ({ page }) => {
  await worldAtYear(page, 5)
  await expect(page.locator('.state__colonies')).toHaveCount(0)
})
