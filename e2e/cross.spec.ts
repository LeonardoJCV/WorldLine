import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'

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
  // espera o painel carregar o ano observado
  await expect(branch).toBeEnabled()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await branch.click()
}

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

test('picks the crossing origin from the strip by keyboard and marks it without moving the focus', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()

  // FIX: o painel também oferece "From worldline A"; escopa à tira de worldlines
  const strip = page.getByRole('region', { name: 'Worldlines' })
  const origin = strip.getByRole('button', { name: 'From worldline A' })
  await origin.focus()
  await origin.press('Enter')

  await expect(origin).toHaveAttribute('aria-pressed', 'true')
  await expect(strip.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'data-origin',
    'true',
  )
  await expect(strip.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
