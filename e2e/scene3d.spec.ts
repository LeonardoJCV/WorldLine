import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

test('shows the 3D current by default', async ({ page }) => {
  await page.goto('/?seed=482913')
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '3d')
  await expect(page.getByText(/Worldlines in space/)).toBeVisible()
})

test('switches to 2D from the graphics menu and remembers it', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Graphics' }).click()
  await page.getByRole('radio', { name: '2D' }).check()
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '2d')
  await page.reload()
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '2d')
})

test('uses 2D when the system asks for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?seed=482913')
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '2d')
})

test('keeps particles still in a forced 3D level under reduced motion', async ({ page }) => {
  await useGraphics(page, 'low')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?seed=482913')
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '3d')
})

test('uses 2D without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      if (type.startsWith('webgl')) return null
      return original.call(this, type as '2d', options as CanvasRenderingContext2DSettings)
    } as typeof original
  })
  await page.goto('/?seed=482913')
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '2d')
})

test('settles on a level automatically', async ({ page }) => {
  await page.goto('/?seed=482913')
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('worldline.tier')), { timeout: 20_000 })
    .toMatch(/^(low|high|ultra)$/)
  await page.getByRole('button', { name: 'Graphics' }).click()
  await expect(page.getByRole('radio', { name: /Automatic \((Low|High|Ultra)\)/ })).toBeChecked()
})

test('runs without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  expect(errors).toEqual([])
})

test('moves through time with the keyboard in 3D', async ({ page }) => {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 5; i++) await step.click()
  const current = page.getByRole('slider', { name: /Worldline history/ })
  await current.focus()
  await current.press('Home')
  await expect(page.getByTestId('year')).toHaveText('0000')
  await current.press('ArrowRight')
  await expect(page.getByTestId('year')).toHaveText('0001')
})

test('recenters the camera', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Recenter' }).click()
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '3d')
})

test('scrubs the past with the pointer in 3D', async ({ page }) => {
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  const current = page.getByRole('slider', { name: /Worldline history/ })
  const box = await current.boundingBox()
  if (!box) throw new Error('scene is not visible')
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await expect(page.getByRole('button', { name: 'Return to the present' })).toBeVisible()
})

test('releases the WebGL context when leaving 3D', async ({ page }) => {
  await page.addInitScript(() => {
    const contexts: WebGLRenderingContext[] = []
    Object.assign(window, { __contexts: contexts })
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      const context = original.call(this, type as '2d', options as CanvasRenderingContext2DSettings)
      if (type.startsWith('webgl') && context && this.classList.contains('scene3d__canvas')) {
        contexts.push(context as unknown as WebGLRenderingContext)
      }
      return context
    } as typeof original
  })
  await useGraphics(page, 'low')
  await page.goto('/?seed=482913')
  await expect(page.locator('.scene3d__canvas')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __contexts: unknown[] }).__contexts.length),
    )
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Graphics' }).click()
  await page.getByRole('radio', { name: '2D' }).check()
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '2d')
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __contexts: WebGLRenderingContext[] }).__contexts.every((c) =>
          c.isContextLost(),
        ),
      ),
    )
    .toBe(true)
})

test('keeps the 3D scene alive when the level changes', async ({ page }) => {
  await useGraphics(page, 'low')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: 'Graphics' }).click()
  await page.getByRole('radio', { name: 'High', exact: true }).check()
  await page.getByRole('radio', { name: 'Ultra', exact: true }).check()
  await page.getByRole('radio', { name: 'Low' }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('main.stage')).toHaveAttribute('data-view', '3d')
  await page.waitForTimeout(500)
  const lost = await page
    .locator('.scene3d__canvas')
    .evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')?.isContextLost() ?? true)
  expect(lost).toBe(false)
  expect(errors).toEqual([])
})

test.describe('touch', () => {
  test.use({ hasTouch: true })

  test('orbits with two fingers without scrubbing and pinches to zoom time', async ({ page }) => {
    await useGraphics(page, 'low')
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Pause' }).click()
    const current = page.getByRole('slider', { name: /Worldline history/ })
    const box = await current.boundingBox()
    if (!box) throw new Error('scene is not visible')
    const present = await page.getByTestId('year').textContent()
    const session = await page.context().newCDPSession(page)
    const y = box.y + box.height * 0.5
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    await touch('touchStart', [{ x: box.x + box.width * 0.3, y, id: 1 }])
    await touch('touchStart', [
      { x: box.x + box.width * 0.3, y, id: 1 },
      { x: box.x + box.width * 0.4, y, id: 2 },
    ])
    for (let step = 1; step <= 5; step++) {
      await touch('touchMove', [
        { x: box.x + box.width * (0.3 - step * 0.04), y, id: 1 },
        { x: box.x + box.width * (0.4 + step * 0.04), y, id: 2 },
      ])
    }
    await touch('touchEnd', [])
    await expect(page.getByTestId('year')).toHaveText(present ?? '')
    await expect(page.getByRole('button', { name: 'Show all' })).toBeEnabled()
  })
})
