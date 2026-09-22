import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'

test.skip(!process.env.SCREENS, 'screenshots are captured on demand')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

for (const viewport of VIEWPORTS) {
  test(`observatory ${viewport.name}`, async ({ page }) => {
    await useGraphics(page, '2d')
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
  await useGraphics(page, '2d')
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
  await useGraphics(page, '2d')
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
  await useGraphics(page, '2d')
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

test('observatory multiverse 3d', async ({ page }) => {
  await useGraphics(page, 'high')
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
  await page.screenshot({ path: 'screens/observatory-multiverse-3d.png' })
})

for (const level of ['low', 'high', 'ultra'] as const) {
  test(`observatory 3d ${level}`, async ({ page }) => {
    await useGraphics(page, level)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `screens/observatory-3d-${level}.png` })
  })
}

test('observatory 3d cursor', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 20; i++) await history.press('Shift+ArrowRight')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-3d-cursor.png' })
})

test('observatory 3d mobile', async ({ page }) => {
  await useGraphics(page, 'low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(800)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeInViewport()
  await page.screenshot({ path: 'screens/observatory-3d-mobile.png' })
})

test('surface orbit', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'orbit', { timeout: 10_000 })
  await page.getByLabel('Follow the sun').uncheck()
  const orbitHour = page.getByLabel('Time of day')
  await orbitHour.focus()
  await orbitHour.press('Home')
  for (let i = 0; i < 8; i++) await orbitHour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-orbit.png' })
})

test('surface continent', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'continent', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const continentHour = page.getByLabel('Time of day')
  await continentHour.focus()
  await continentHour.press('Home')
  for (let i = 0; i < 8; i++) await continentHour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-continent.png' })
})

test('surface region', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const regionHour = page.getByLabel('Time of day')
  await regionHour.focus()
  await regionHour.press('Home')
  for (let i = 0; i < 8; i++) await regionHour.press('ArrowRight')
  const regionCanvas = page.locator('.surface__canvas')
  await regionCanvas.focus()
  for (let i = 0; i < 6; i++) await regionCanvas.press('+')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-region.png' })
})

test('surface night', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'continent', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const hour = page.getByLabel('Time of day')
  await hour.focus()
  await hour.press('Home')
  for (let i = 0; i < 75; i++) await hour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-night.png' })
})

test('surface mobile', async ({ page }) => {
  await useGraphics(page, 'low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const mobileHour = page.getByLabel('Time of day')
  await mobileHour.focus()
  await mobileHour.press('Home')
  for (let i = 0; i < 8; i++) await mobileHour.press('ArrowRight')
  const mobileCanvas = page.locator('.surface__canvas')
  await mobileCanvas.focus()
  for (let i = 0; i < 6; i++) await mobileCanvas.press('+')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-mobile.png' })
})

for (const level of ['Continent', 'Region'] as const) {
  test(`surface ${level.toLowerCase()} ultra`, async ({ page }) => {
    await useGraphics(page, 'ultra')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.getByRole('button', { name: 'View planet' }).click()
    await page.getByRole('button', { name: level }).click()
    await expect(page.locator('.surface')).toHaveAttribute('data-level', level.toLowerCase(), {
      timeout: 10_000,
    })
    await page.getByLabel('Follow the sun').uncheck()
    const hour = page.getByLabel('Time of day')
    await hour.focus()
    await hour.press('Home')
    for (let i = 0; i < 8; i++) await hour.press('ArrowRight')
    await page.waitForTimeout(5000)
    await page.screenshot({ path: `screens/surface-${level.toLowerCase()}-ultra.png` })
  })
}

const CAPITAL = { lat: 0.373, lon: -0.572 } as const
const START = { lat: 0.35, lon: 0 } as const
const PAN_STEP = 40

async function panToCapital(page: Page, altitude: number) {
  const canvas = page.locator('.surface__canvas')
  const box = await canvas.boundingBox()
  const rate = (altitude * 1.4 * PAN_STEP) / Math.max(1, box?.height ?? 1)
  await canvas.focus()
  const east = Math.round(((START.lon - CAPITAL.lon) * Math.cos(START.lat)) / rate)
  for (let i = 0; i < east; i++) await canvas.press('ArrowLeft')
  const north = Math.round((CAPITAL.lat - START.lat) / rate)
  for (let i = 0; i < north; i++) await canvas.press('ArrowUp')
}

async function enterLife(page: Page, level: 'Continent' | 'Region', steps: number) {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  if (steps > 0) {
    const step = page.getByRole('button', { name: 'Advance one year' })
    for (let i = 0; i < steps; i++) await step.click()
  } else {
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Pause' }).click()
  }
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: level }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', level.toLowerCase(), {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const hour = page.getByLabel('Time of day')
  await hour.focus()
  await hour.press('Home')
  for (let i = 0; i < 8; i++) await hour.press('ArrowRight')
  await page.waitForTimeout(2000)
  await panToCapital(page, level === 'Region' ? 0.03 : 0.35)
  if (level === 'Continent') {
    for (let i = 0; i < 3; i++) await page.locator('.surface__canvas').press('+')
  }
  await page.waitForTimeout(3000)
}

test('surface life region', async ({ page }) => {
  await enterLife(page, 'Region', 0)
  await page.screenshot({ path: 'screens/surface-life-region.png' })
})

test('surface life continent', async ({ page }) => {
  await enterLife(page, 'Continent', 0)
  await page.screenshot({ path: 'screens/surface-life-continent.png' })
})

test('surface life early', async ({ page }) => {
  await enterLife(page, 'Region', 20)
  await page.screenshot({ path: 'screens/surface-life-early.png' })
})
