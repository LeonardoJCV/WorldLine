import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

test.skip(!process.env.SCREENS, 'screenshots are captured on demand')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

for (const viewport of VIEWPORTS) {
  test(`observatory ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `screens/observatory-${viewport.name}.png` })
  })
}

for (const viewport of VIEWPORTS) {
  test(`genesis ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await page.getByLabel('Seed (a number or a word)').fill('atlantis')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `screens/genesis-${viewport.name}.png` })
  })
}

test('observatory causal chain', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.locator('.events__item').first().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-causal.png' })
})

test('observatory intervene', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screens/observatory-intervene.png' })
})

for (const level of ['low', 'high', 'ultra'] as const) {
  test(`genesis planet ${level}`, async ({ page }) => {
    await useGraphics(page, level)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `screens/genesis-planet-${level}.png` })
  })
}

test('observatory multiverse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 25; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-multiverse.png' })
})
