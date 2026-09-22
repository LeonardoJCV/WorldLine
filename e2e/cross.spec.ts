import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { branchFromStart, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

test('picks the crossing origin from the strip by keyboard and marks it without moving the focus', async ({
  page,
}) => {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await page.getByRole('button', { name: 'Cross', exact: true }).click()

  const origin = page.getByRole('button', { name: 'Use worldline A as the crossing origin' })
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
