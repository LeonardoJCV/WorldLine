import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { worldAtYear } from './support.ts'

const stage = (page: import('@playwright/test').Page) => page.locator('main.stage')

test('opens the planet from the currents and returns', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.getByRole('img', { name: /Planet surface in year/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('with motion turned down the dive lands without waiting for the flight', async ({ page }) => {
  // FIX: em 'auto' o movimento reduzido já cai no 2D; só um nível explícito e um mundo com cabeça voam de verdade
  await useGraphics(page, 'high')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await worldAtYear(page, 12)
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '3d')
  const enter = page.getByRole('button', { name: 'View planet' })
  await expect(enter).toBeVisible()
  const start = Date.now()
  await enter.click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  // FEAT: sem o voo da câmera nem o desvanecer da superfície, o mergulho chega quase na hora
  expect(Date.now() - start).toBeLessThan(500)
  const duration = await page
    .locator('.surface')
    .evaluate((node) => getComputedStyle(node).animationDuration)
  expect(Number.parseFloat(duration)).toBeLessThan(0.05)
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('survives a rapid double-click into the planet', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?seed=482913')
  const enter = page.getByRole('button', { name: 'View planet' })
  await expect(enter).toBeVisible()
  // FIX: dois cliques no mesmo quadro reaproveitam a promise do mergulho sem travar a entrada
  await enter.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet', { timeout: 5_000 })
  expect(errors).toEqual([])
})

test('zooms to the region and back to orbit', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await expect(page.getByRole('button', { name: 'Region' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Orbit' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'orbit', { timeout: 10_000 })
})

test('leaves the planet with Escape', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('img', { name: /Planet surface/ }).press('Escape')
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
})

test('keeps the planet view in the link', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page).toHaveURL(/\/planet$/)
  await page.reload()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
})

test('keeps time controls working inside the planet', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0001')
  await expect(page.getByRole('img', { name: 'Planet surface in year 0001' })).toBeVisible()
})

test('has no planet view in 2D', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.goto('/?seed=482913')
  await expect(page.getByRole('button', { name: 'View planet' })).toHaveCount(0)
})

test('runs the planet without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await page.waitForTimeout(2500)
  expect(errors).toEqual([])
})

test('names the cities and opens a city card', async ({ page }) => {
  test.slow()
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  const city = page.locator('.surface__city').first()
  await expect(city).toBeVisible({ timeout: 15_000 })
  const name = (await city.textContent()) ?? ''
  await city.click()
  const card = page.getByRole('dialog')
  await expect(card.getByRole('heading', { name })).toBeVisible()
  await expect(card).toBeFocused()
  await expect(card.getByText('Founded')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(page.locator('main.stage')).toHaveAttribute('data-lens', 'planet')
})

async function planetPoint(page: import('@playwright/test').Page) {
  const canvas = page.locator('.scene3d__canvas')
  const label = page.locator('.scene3d__letter').first()
  await expect(label).toBeVisible()
  // FIX: espera a câmera assentar no trilho (rótulo parado por vários quadros) antes de procurar
  await label.evaluate(
    (el: HTMLElement) =>
      new Promise<void>((resolve) => {
        const read = () => el.getBoundingClientRect()
        let last = read()
        let still = 0
        const step = () => {
          const now = read()
          const moved = Math.hypot(now.x - last.x, now.y - last.y)
          still = moved < 0.3 ? still + 1 : 0
          last = now
          if (still >= 12) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
  )
  const box = await label.boundingBox()
  if (!box) throw new Error('planet label is not visible')
  const hits: { x: number; y: number }[] = []
  for (let t = 0; t <= 240; t += 4) {
    const x = box.x - t * 0.7
    const y = box.y + box.height + t * 0.7
    await page.mouse.move(x, y)
    const cursor = await canvas.evaluate((el: HTMLCanvasElement) => el.style.cursor)
    if (cursor === 'pointer') hits.push({ x, y })
    else if (hits.length > 0) break
  }
  const middle = hits[Math.floor(hits.length / 2)]
  if (!middle) throw new Error('planet is not under the pointer')
  return middle
}

test('dives into the planet on click, not on press', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const point = await planetPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForTimeout(1200)
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await page.mouse.up()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet', { timeout: 5_000 })
})

test('scrubs time when a drag starts on the planet', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const point = await planetPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x - 150, point.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await expect(page.getByRole('button', { name: 'Return to the present' })).toBeVisible()
})

test('keeps the hidden currents out of keyboard reach', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.locator('.scene3d')).toHaveAttribute('inert', '')
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => {
      const active = document.activeElement
      return active instanceof HTMLElement && active.closest('.scene3d') !== null
    })
    expect(inside).toBe(false)
    await expect(page.getByRole('button', { name: 'View planet' })).not.toBeFocused()
    await expect(page.getByRole('button', { name: 'Recenter' })).not.toBeFocused()
  }
})

test('keeps the 3D currents when the terrain map fails', async ({ page }) => {
  await page.route(/terrain\.worker/, (route) => route.abort())
  await page.goto('/?seed=482913')
  await expect(page.getByText(/The simulation stopped/)).toBeVisible({ timeout: 10_000 })
  await expect(stage(page)).toHaveAttribute('data-view', '3d')
  await expect(page.locator('.scene3d__canvas')).toBeVisible()
})

test('returns to live currents from a planet link', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page).toHaveURL(/\/planet$/)
  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await page.getByRole('button', { name: 'Back to the currents' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await expect(page.locator('.scene3d')).not.toHaveAttribute('inert', '')
  const current = page.getByRole('slider', { name: /Worldline history/ })
  await current.focus()
  await expect(current).toBeFocused()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByTestId('year')).not.toHaveText('0000', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
})

test('leaves the planet with Escape from any control and refocuses the entry', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await page.getByRole('button', { name: 'Region' }).focus()
  await page.keyboard.press('Escape')
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await expect(page.getByRole('button', { name: 'View planet' })).toBeFocused()
})

test('describes the planet keys and follows the live hour', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page.getByRole('img', { name: /Planet surface/ })).toHaveAccessibleDescription(/Esc/)
  const slider = page.getByLabel('Time of day')
  await expect(slider).not.toHaveValue('50', { timeout: 5_000 })
  const first = Number(await slider.inputValue())
  await expect
    .poll(async () => Number(await slider.inputValue()), { timeout: 10_000 })
    .not.toBe(first)
})

test('drops the planet from the link when the stage is 2D', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.goto('/#/w/AQAHXmEAAAAA/planet')
  await expect(page.getByTestId('seed')).toHaveText('482913')
  await expect(page).not.toHaveURL(/\/planet$/)
})

test('starts a new world on the currents after leaving from the planet', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await page.getByRole('button', { name: 'New world' }).click()
  await page.getByLabel('Seed (a number or a word)').fill('atlantis')
  await page.getByRole('button', { name: 'Start worldline' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'current')
  await expect(page).not.toHaveURL(/\/planet$/)
})

test('shows the living surface without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await page.waitForTimeout(3000)
  expect(errors).toEqual([])
})

test('keeps the planet open while switching worlds', async ({ page }) => {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 5; i++) await step.click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 10; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

async function auditCard(page: import('@playwright/test').Page) {
  const audit = await page.evaluate(() => {
    const node = document.querySelector('.surface__card')
    const stage = document.querySelector('.stage')
    if (!node || !stage) return null
    const card = node.getBoundingClientRect()
    const board = stage.getBoundingClientRect()
    const reaches = (x: number, y: number) => {
      const found = document.elementFromPoint(x, y)
      return found !== null && found.closest('.surface__card') !== null
    }
    const visible = (n: Element) =>
      getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0
    return {
      buried: [...document.querySelectorAll('.hud .card')]
        .filter(visible)
        .filter((n) => {
          const other = n.getBoundingClientRect()
          return (
            card.left < other.right &&
            other.left < card.right &&
            card.top < other.bottom &&
            other.top < card.bottom
          )
        })
        .map((n) => n.className),
      inside:
        card.top >= board.top - 1 &&
        card.bottom <= board.bottom + 1 &&
        card.left >= board.left - 1 &&
        card.right <= board.right + 1,
      corners: [
        reaches((card.left + card.right) / 2, (card.top + card.bottom) / 2),
        reaches(card.right - 22, card.top + 22),
        reaches(card.left + 4, card.top + 4),
        reaches(card.right - 4, card.bottom - 4),
      ],
      markers: [...document.querySelectorAll('.surface__micro')].map((n) => {
        const mark = n.getBoundingClientRect()
        const found = document.elementFromPoint(
          (mark.left + mark.right) / 2,
          (mark.top + mark.bottom) / 2,
        )
        return found === null || found.closest('.hud') === null
      }),
    }
  })
  if (!audit) throw new Error('the planet card is not open')
  return audit
}

test("keeps the planet's own card clear of the floating cards", async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  // FEAT: dentro do planeta a lista dos rumos sai; o estado e as ações ficam
  await expect(page.locator('.card--events')).toBeHidden()
  await expect(page.locator('.card--causal')).toBeHidden()
  await expect(page.locator('.card--state')).toBeVisible()
  await expect(page.locator('.card--actions')).toBeVisible()

  const city = page.locator('.surface__city').first()
  await expect(city).toBeVisible({ timeout: 15_000 })
  await city.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const audit = await auditCard(page)
  expect(audit.buried).toEqual([])
  expect(audit.inside).toBe(true)
  expect(audit.corners).toEqual([true, true, true, true])
  expect(audit.markers.every(Boolean)).toBe(true)
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('keeps the microevent card and its markers clear of the floating cards', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect
    .poll(async () => Number(await page.getByTestId('year').textContent()), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(300)
  await page.getByRole('button', { name: 'Pause' }).click()
  const current = page.getByRole('slider', { name: /Worldline history/ })
  await current.focus()
  for (let i = 0; i < 20; i++) await current.press('+')
  const list = page.getByRole('list', { name: 'Microevents on the current' })
  await expect(list.getByRole('button').first()).toBeAttached({ timeout: 10_000 })
  await page.waitForTimeout(1000)
  const first = list.getByRole('button').first()
  const name = (await first.textContent()) ?? ''
  await list.getByRole('button', { name, exact: true }).press('Enter')
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })

  const audit = await auditCard(page)
  expect(audit.buried).toEqual([])
  expect(audit.inside).toBe(true)
  expect(audit.corners).toEqual([true, true, true, true])
  expect(audit.markers.length).toBeGreaterThan(0)
  expect(audit.markers.every(Boolean)).toBe(true)
})

test('keeps the planet card whole at phone width', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  const city = page.locator('.surface__city').first()
  await expect(city).toBeVisible({ timeout: 20_000 })
  await city.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const audit = await auditCard(page)
  expect(audit.buried).toEqual([])
  expect(audit.inside).toBe(true)
  expect(audit.corners).toEqual([true, true, true, true])
  expect(audit.markers.every(Boolean)).toBe(true)
})
