import { expect, test, type Page } from '@playwright/test'
import { system } from '../src/engine/system.ts'
import { useGraphics } from './stage.ts'

const SEED = 482913
const BODIES = system(SEED).length

const stage = (page: Page) => page.locator('main.stage')

async function openPlanet(page: Page) {
  await page.goto(`/?seed=${SEED}`)
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  // FIX: o relógio só anda depois que a cena existe, e antes dela o zoom não tem em que pegar
  await expect(page.getByLabel('Time of day')).not.toHaveValue('50', { timeout: 20_000 })
  return page.getByRole('img', { name: /Planet surface in year/ })
}

test('climbs from the planet to the system only on the second push at the ceiling', async ({
  page,
}) => {
  const canvas = await openPlanet(page)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('the planet canvas is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 120)
  // FEAT: a primeira volta só encosta no teto; sair é insistir já estando nele
  await page.waitForTimeout(300)
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await page.mouse.wheel(0, 120)
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await expect(page.getByRole('img', { name: `The bodies of ${SEED}` })).toBeVisible()
})

test('climbs to the system with the keyboard only on the second push', async ({ page }) => {
  const canvas = await openPlanet(page)
  await canvas.press('-')
  await page.waitForTimeout(300)
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await canvas.press('-')
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
})

test('leaves the system with Escape', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await page.getByRole('img', { name: `The bodies of ${SEED}` }).press('Escape')
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('leaves the system with the visible way out', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('keeps the system in the link and opens straight into it', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(page).toHaveURL(/\/system$/)
  const link = page.url()
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(page).not.toHaveURL(/\/system$/)
  await page.goto('about:blank')
  await page.goto(link)
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await expect(page.getByRole('img', { name: `The bodies of ${SEED}` })).toBeVisible()
})

test('names every body of the seed', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  const labels = page.locator('.system__body')
  await expect(labels).toHaveCount(BODIES)
  const names = new Set<string>()
  for (let i = 0; i < BODIES; i++) {
    const label = labels.nth(i)
    await expect(label).toBeVisible()
    const name = (await label.textContent())?.trim() ?? ''
    expect(name).not.toBe('')
    names.add(name)
  }
  expect(names.size).toBe(BODIES)
})

test('runs the whole round trip on the keyboard alone', async ({ page }) => {
  await page.goto(`/?seed=${SEED}`)
  const enter = page.getByRole('button', { name: 'View planet' })
  await enter.focus()
  await enter.press('Enter')
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  const up = page.getByRole('button', { name: 'View the system' })
  await up.focus()
  await up.press('Enter')
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  const sky = page.getByRole('img', { name: `The bodies of ${SEED}` })
  await expect(sky).toBeFocused()
  await expect(page.locator('.system__body').first()).toBeVisible()
  await sky.press('Escape')
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('falls back to the planet when the zoom digs past the floor', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  const sky = page.getByRole('img', { name: `The bodies of ${SEED}` })
  // FEAT: 1 -> 0.8 -> 0.64 -> chão; a quarta é a que pede para baixo já estando nele
  for (let i = 0; i < 4; i++) await sky.press('+')
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
})

test('has no system lens in 2D', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.goto('/#/w/AQAHXmEAAAAA/system')
  await expect(page.getByTestId('seed')).toHaveText(String(SEED))
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await expect(page.locator('.system')).toHaveCount(0)
  await expect(page.locator('.planet-slot')).toBeVisible()
  await expect(page).not.toHaveURL(/\/system$/)
})

test('runs the system without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(page.locator('.system__body').first()).toBeVisible()
  await page.waitForTimeout(2500)
  expect(errors).toEqual([])
})

test('holds the system still when motion is turned down', async ({ page }) => {
  // FIX: em 'auto' o movimento reduzido já cai no 2D; só um nível explícito chega à lente
  await useGraphics(page, 'high')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  const label = page.locator('.system__body').first()
  await expect(label).toBeVisible()
  await page.waitForTimeout(600)
  const before = await label.boundingBox()
  await page.waitForTimeout(1600)
  const after = await label.boundingBox()
  if (!before || !after) throw new Error('a body label is not on the screen')
  // FEAT: sem movimento a deriva ambiente não anda — o corpo fica onde a semente o pôs
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1)
})
