import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { branchFromStart, pickOrigin, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

test('shows what a world owes after a crossing lands', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()

  await page.getByRole('button', { name: 'Observe' }).click()
  // FIX: a dívida entra na engine só no passo que segue a chegada, não no ano em que a travessia abre
  await page.getByRole('button', { name: 'Advance one year' }).click()
  const debt = page.locator('.state__debt')
  await expect(debt).toBeVisible()
  await expect(debt).toContainText('Causal debt')
  await expect(debt).toContainText('owed to A')
  // FEAT: a âncora é o ano sem dívida logo antes da travessia chegar, então o primeiro ano é "growing"
  await expect(debt).toContainText('growing')
})

test('has no causal debt line on a worldline that never crossed', async ({ page }) => {
  await worldAtYear(page, 5)
  await expect(page.locator('.state__debt')).toHaveCount(0)
})

test('says the debt is being repaid once the world invests in paying it down', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  // FEAT: aposta pesado em pesquisa, a moeda que quita uma dívida de conhecimento
  await page.getByRole('button', { name: 'Intervene' }).click()
  const research = page.getByRole('slider', { name: /Research/ })
  await research.focus()
  for (let i = 0; i < 40; i++) await research.press('ArrowRight')
  await page.getByRole('button', { name: 'Apply decision' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()

  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await page.getByRole('button', { name: 'Observe' }).click()

  const step = page.getByRole('button', { name: 'Advance one year' })
  // FIX: o primeiro ano após a chegada ainda compara com a âncora sem dívida (growing); o segundo
  // já compara com um ano que já tinha dívida e a pesquisa alta reduziu — aí a linha vira "being repaid"
  await step.click()
  await step.click()
  const debt = page.locator('.state__debt')
  await expect(debt).toContainText('being repaid')
})
