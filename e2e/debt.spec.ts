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
  await expect(debt).toContainText('unchanged')
})

test('has no causal debt line on a worldline that never crossed', async ({ page }) => {
  await worldAtYear(page, 5)
  await expect(page.locator('.state__debt')).toHaveCount(0)
})
