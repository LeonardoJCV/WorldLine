import { expect, test } from '@playwright/test'
import { useGraphics } from './stage.ts'

test.skip(!process.env.MEASURE, 'measured on demand against the dev server (npx vite --port 4173)')

for (const tier of ['low', 'high', 'ultra'] as const) {
  for (const level of ['Continent', 'Region'] as const) {
    test(`surface ${tier} ${level}`, async ({ page }) => {
      test.setTimeout(120_000)
      await useGraphics(page, tier)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/?seed=482913')
      await page.getByRole('button', { name: 'View planet' }).click()
      await expect(page.locator('.surface__canvas')).toHaveAttribute('data-chunks', /\d+/, {
        timeout: 30_000,
      })
      await page.getByRole('button', { name: level }).click()
      await expect(page.locator('.surface')).toHaveAttribute('data-level', level.toLowerCase(), {
        timeout: 30_000,
      })
      const canvas = page.locator('.surface__canvas')
      let rebuilds = ''
      for (let still = 0, waited = 0; still < 3 && waited < 60; waited++) {
        await page.waitForTimeout(1000)
        const now = (await canvas.getAttribute('data-rebuilds')) ?? ''
        still = now === rebuilds ? still + 1 : 0
        rebuilds = now
      }
      const life = (await canvas.getAttribute('data-life')) ?? '0/0'
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
      const [count = 0, total = 0, max = 0] = rebuilds.split('/').map(Number)
      console.log(
        `measure ${tier} ${level}: ${result.fps.toFixed(1)} fps, ${result.chunks} chunks, life ${life}, ` +
          `${count} rebuilds, ${(total / Math.max(1, count)).toFixed(1)} ms mean, ${max} ms max`,
      )
      expect(result.chunks).toBeGreaterThan(0)
      if (level === 'Region') expect(Number(life.split('/')[0])).toBeGreaterThan(0)
    })
  }
}
