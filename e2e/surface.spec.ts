import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

const stage = (page: import('@playwright/test').Page) => page.locator('main.stage')

test('opens the planet from the currents and returns', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(stage(page)).toHaveAttribute('data-lens', 'planet')
  await expect(page.getByRole('img', { name: /Planet surface in year/ })).toBeVisible()
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
  // FIX: dois cliques quase simultâneos reaproveitam a mesma promise do mergulho, sem travar a entrada
  await Promise.all([enter.click(), enter.click()])
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

async function planetPoint(page: import('@playwright/test').Page) {
  const canvas = page.locator('.scene3d__canvas')
  const label = page.locator('.scene3d__letter').first()
  await expect(label).toBeVisible()
  await page.waitForTimeout(500)
  const box = await label.boundingBox()
  if (!box) throw new Error('planet label is not visible')
  const hits: { x: number; y: number }[] = []
  for (let t = 0; t <= 240; t += 8) {
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
