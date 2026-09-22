import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

test.skip(!process.env.MEASURE, 'frame rates are measured on demand')

for (const tier of ['low', 'high', 'ultra'] as const) {
  for (const level of ['Continent', 'Region'] as const) {
    test(`surface ${tier} ${level}`, async ({ page }) => {
      test.setTimeout(60_000)
      await useGraphics(page, tier)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/?seed=482913')
      await page.getByRole('button', { name: 'View planet' }).click()
      await page.getByRole('button', { name: level }).click()
      await expect(page.locator('.surface')).toHaveAttribute('data-level', level.toLowerCase(), {
        timeout: 10_000,
      })
      await page.waitForTimeout(5000)
      const result = await page.evaluate(
        () =>
          new Promise<{ fps: number; chunks: number }>((resolve) => {
            const start = performance.now()
            let frames = 0
            const step = (now: number) => {
              frames++
              if (now - start < 3000) {
                requestAnimationFrame(step)
                return
              }
              const canvas = document.querySelector<HTMLCanvasElement>('.surface__canvas')
              resolve({
                fps: (frames * 1000) / (now - start),
                chunks: Number(canvas?.dataset.chunks ?? 0),
              })
            }
            requestAnimationFrame(step)
          }),
      )
      console.log(`measure ${tier} ${level}: ${result.fps.toFixed(1)} fps, ${result.chunks} chunks`)
      expect(result.chunks).toBeGreaterThan(0)
    })
  }
}
