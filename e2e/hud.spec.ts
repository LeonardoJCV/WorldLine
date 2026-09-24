import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'

const WIDE = { width: 1440, height: 900 }

async function observe(page: Page) {
  await useGraphics(page, '2d')
  await page.setViewportSize(WIDE)
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
}

function boxes(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      if (!found) return null
      return { top: found.top, bottom: found.bottom, left: found.left, height: found.height }
    }
    return { bar: rect('.topbar'), stage: rect('.stage'), hud: rect('.hud'), view: innerHeight }
  })
}

test('the stage takes the whole screen below the top bar', async ({ page }) => {
  await observe(page)
  const { bar, stage, hud, view } = await boxes(page)
  if (!bar || !stage || !hud) throw new Error('the observatory did not render its layers')
  expect(Math.abs(stage.top - bar.bottom)).toBeLessThanOrEqual(1)
  expect(Math.abs(stage.bottom - view)).toBeLessThanOrEqual(1)
  expect(stage.height).toBeGreaterThan(view * 0.8)
  // FEAT: a camada dos cartões cobre o palco, e não uma faixa própria
  expect(hud.top).toBeGreaterThanOrEqual(stage.top - 1)
  expect(hud.bottom).toBeLessThanOrEqual(stage.bottom + 1)
})

test('the canvas measures the whole stage', async ({ page }) => {
  await observe(page)
  const measures = await page.evaluate(() => {
    const canvas = document.querySelector('.current')
    const stage = document.querySelector('.stage')?.getBoundingClientRect()
    if (!(canvas instanceof HTMLCanvasElement) || !stage) return null
    const box = canvas.getBoundingClientRect()
    return { canvas: box.height, stage: stage.height, drawn: canvas.height }
  })
  if (!measures) throw new Error('the 2d current did not render')
  expect(Math.abs(measures.canvas - measures.stage)).toBeLessThanOrEqual(1)
  expect(measures.drawn).toBeGreaterThanOrEqual(measures.stage)
})

test('the universe answers the pointer between the cards', async ({ page }) => {
  await observe(page)
  const { stage } = await boxes(page)
  if (!stage) throw new Error('the stage did not render')
  const axis = Math.round(stage.top + stage.height / 2)
  const open = Math.round(stage.left + 640)
  const gap = axis + 40

  const onCanvas = (x: number, y: number) =>
    page.evaluate(
      ([px, py]) => document.elementFromPoint(px as number, py as number)?.className ?? '',
      [x, y],
    )
  expect(await onCanvas(open, gap)).toContain('current')

  const history = page.getByRole('slider', { name: /Worldline history/ })
  const present = Number(await history.getAttribute('aria-valuemax'))
  await page.mouse.move(open, gap)
  await page.mouse.down()
  await page.mouse.move(open - 240, gap, { steps: 8 })
  await page.mouse.up()
  await expect(history).not.toHaveAttribute('aria-valuenow', String(present))
  const dragged = Number(await history.getAttribute('aria-valuenow'))
  expect(dragged).toBeLessThan(present)

  const fit = page.getByRole('button', { name: 'Show all' })
  await expect(fit).toBeDisabled()
  await page.mouse.move(open, gap)
  await page.mouse.wheel(0, -120)
  await expect(fit).toBeEnabled()
  await fit.click()

  // FEAT: o marcador de era mora no eixo, e o cursor do ponteiro avisa quando está sobre um
  const hit = await page.locator('.current').evaluate((node, y) => {
    for (let x = Math.round(node.getBoundingClientRect().left) + 320; x < 880; x += 4) {
      node.style.cursor = ''
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
      if (node.style.cursor === 'pointer') return x
    }
    return 0
  }, axis)
  expect(hit).toBeGreaterThan(0)
  expect(await onCanvas(hit, axis)).toContain('current')
  await page.mouse.click(hit, axis)
  await expect(page.locator('.causal__node').first()).toBeVisible()
})
