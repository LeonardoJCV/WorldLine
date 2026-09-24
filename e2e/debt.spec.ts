import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'
import {
  branchFromStart,
  installParadox,
  pickOrigin,
  runToCollapse,
  runToParadox,
  worldAtYear,
} from './support.ts'

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

test('lives through the whole arc of a debt: it shows while owed, warns of a paradox with its deadline, and clears once the right currency repays it', async ({
  page,
}) => {
  test.slow()
  await installParadox(page)
  await runToParadox(page)

  const debt = page.locator('.state__debt')
  await expect(debt).toBeVisible()
  await expect(debt).toContainText('Causal debt')
  await expect(debt).toContainText('owed to A')
  await expect(page.locator('.paradox[data-state="warning"]')).toBeVisible()

  // FEAT: pesquisa é a moeda certa para uma dívida de conhecimento, o mesmo caminho que já leva ao alívio
  await page.getByRole('button', { name: 'Intervene' }).click()
  await page.getByRole('slider', { name: /Research/ }).fill('60')
  await page.getByRole('button', { name: 'Apply decision' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×16' }).click()
  await page.getByRole('button', { name: 'Play' }).click()

  const relief = page.locator('.paradox[data-state="relief"]')
  await expect(relief).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  // FEAT: sem dívidas em aberto a lista fica vazia, e a linha some do painel
  await expect(debt).toHaveCount(0)
})

test('lets the deadline pass, labels the ending a collapse and not an extinction, and keeps that through a reload from the link', async ({
  page,
}) => {
  test.slow()
  await installParadox(page)
  await runToCollapse(page)

  // FEAT: o fim de uma história é dito na mesma região viva que passou séculos avisando dele
  const announcement = page.locator('.paradox[data-state="collapse"]')
  await expect(announcement).toBeVisible()
  await expect(announcement).toContainText(/collapsed in year \d+/)
  await expect(page.locator('.paradox[data-state="warning"]')).toHaveCount(0)

  const chip = page.getByRole('button', { name: 'Focus on worldline F' })
  const label = (await chip.textContent()) ?? ''
  const [, year] = /collapsed in (\d+)/.exec(label) ?? []
  expect(year).toBeTruthy()
  await expect(chip).not.toContainText('Extinct in')
  await expect(page.locator('.events__item', { hasText: 'Collapse' })).toBeVisible()
  await expect(page.locator('.events__item', { hasText: 'Extinction' })).toHaveCount(0)

  // FEAT: o colapso tem de voltar do endereço, não do que sobrou na memória
  await expect(page).toHaveURL(/#\/m\//)
  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)

  const reopened = page.getByRole('button', { name: 'Focus on worldline F' })
  await reopened.click()
  await expect(reopened).toHaveText(new RegExp(`collapsed in ${year}\\b`))
  await expect(page.locator('.paradox')).toHaveCount(0)
  await expect(page.locator('.events__item', { hasText: 'Collapse' })).toBeVisible()
})
