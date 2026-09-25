import { expect, test, type Page } from '@playwright/test'
import { system } from '../src/engine/system.ts'
import { useGraphics } from './stage.ts'
import { SIBLING_CASE, siblingInheritanceLink } from './support.ts'

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

test('leaves the system with the wheel only after the span runs out', async ({ page }) => {
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  const sky = page.getByRole('img', { name: `The bodies of ${SEED}` })
  const box = await sky.boundingBox()
  if (!box) throw new Error('the system canvas is not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(300)
  // FEAT: 1 -> 1.15 -> 1.32 -> teto; só a quarta volta pede para fora já estando nele
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, 120)
  await page.waitForTimeout(300)
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await page.mouse.wheel(0, 120)
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('keeps the phone sheet off the orbit plane', async ({ page }) => {
  // FIX: em 'auto' o movimento reduzido já cai no 2D; só um nível explícito chega à lente
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 390, height: 844 })
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(page.locator('.system__body').first()).toBeVisible()
  await expect(page.locator('.sheet')).toBeHidden()
  const audit = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.system__body')]
    return labels.map((node) => {
      const box = node.getBoundingClientRect()
      const found = document.elementFromPoint(
        (box.left + box.right) / 2,
        (box.top + box.bottom) / 2,
      )
      return found === null || found.closest('.hud') === null
    })
  })
  expect(audit.length).toBe(BODIES)
  expect(audit.every(Boolean)).toBe(true)
})

test('keeps the title readable above the exit row at phone width', async ({ page }) => {
  // FIX: scrollWidth não vê um elemento pintado por cima de outro; isto olha o próprio pixel do título
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 390, height: 844 })
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  const title = page.locator('.system__title')
  await expect(title).toBeVisible()
  const clear = await page.evaluate(() => {
    const node = document.querySelector('.system__title')
    if (!node) return false
    const box = node.getBoundingClientRect()
    const found = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2)
    return found !== null && found.closest('.system__title') !== null
  })
  expect(clear).toBe(true)
})

test('dives to the planet with the visible way down, no gesture needed', async ({ page }) => {
  // FEAT: sem pinça, o toque só desce por este botão — a mesma disciplina do botão que sobe
  await openPlanet(page)
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'system')
  await page.getByRole('button', { name: 'Descend to the planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
})

test('reads the natal body alive and the colony with people before the inheritance', async ({
  page,
}) => {
  // FEAT: semente 4242 (support.ts), ano 2500 — as duas colônias já fundadas, o natal ainda de pé
  await page.goto(siblingInheritanceLink(2500))
  const enter = page.getByRole('button', { name: 'View planet' })
  await expect(enter).toBeVisible({ timeout: 30_000 })
  await enter.click()
  await page.getByRole('button', { name: 'View the system' }).click()
  const labels = page.locator('.system__body')
  await expect(labels.first()).toBeVisible()
  await expect(labels.nth(1)).toHaveText(/ — where the history began$/)
  // FIX: \S+ também casaria com "{people}" sem preencher; exige um dígito para provar que o número chegou
  await expect(labels.nth(0)).toHaveText(/ — \d\S* settled$/)
})

test('reads the natal body as ended and the heir as home after the inheritance', async ({
  page,
}) => {
  test.slow()
  // FEAT: cinco anos depois do prazo, a herança já rodou (colonies.spec.ts explica o +5)
  await page.goto(siblingInheritanceLink(SIBLING_CASE.ended + 5))
  const enter = page.getByRole('button', { name: 'View planet' })
  await expect(enter).toBeVisible({ timeout: 60_000 })
  await enter.click()
  await page.getByRole('button', { name: 'View the system' }).click()
  const labels = page.locator('.system__body')
  await expect(labels.first()).toBeVisible()
  await expect(labels.nth(1)).toHaveText(/ — the world that ended$/)
  await expect(labels.nth(0)).toHaveText(/ — home$/)
  // FEAT: morto e vazio só se separam pelas palavras — a asserção é sobre o texto, não sobre a cor
  await expect(labels.nth(2)).toHaveText(/ — no one there$/)
})
