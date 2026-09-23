import { expect, test, type Page } from '@playwright/test'
import { useGraphics } from './stage.ts'
import { installParadox, runToParadox, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

// FEAT: só conta a mutação que a região viva anunciaria; o prazo vive fora dela, e corre calado
async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('.notices')
    if (!region) throw new Error('the notices region is missing')
    const counter = { announced: 0 }
    Object.assign(window, { paradoxWatch: counter })
    new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target
        const element = node instanceof Element ? node : node.parentElement
        if (element?.closest('[aria-live="off"]')) continue
        counter.announced += 1
      }
    }).observe(region, { childList: true, characterData: true, subtree: true })
  })
}

async function announced(page: Page): Promise<number> {
  return page.evaluate(() => {
    const watch = (window as unknown as { paradoxWatch?: { announced: number } }).paradoxWatch
    return watch ? watch.announced : -1
  })
}

test('warns that a history is about to break, and lets go once the debt is cleared', async ({
  page,
}) => {
  test.slow()
  await installParadox(page)
  await runToParadox(page)

  const notice = page.locator('.paradox[data-state="warning"]')
  await expect(notice).toContainText(
    'This history no longer holds: it depends on more than it ever produced.',
  )
  const deadline = notice.locator('.paradox__deadline')
  await expect(deadline).toHaveText(/^Collapses in \d+ years unless 10 of debt is cleared\.$/)
  await expect(notice).toContainText('Its own research pays this down.')

  // FEAT: o prazo cai ano após ano sem a região viva repetir o aviso uma única vez
  await watchAnnouncements(page)
  const before = await deadline.textContent()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(deadline).not.toHaveText(before ?? '')
  await expect(notice).toBeVisible()
  expect(await announced(page)).toBe(0)

  // FEAT: a pesquisa é a única moeda que paga uma dívida de conhecimento
  await page.getByRole('button', { name: 'Intervene' }).click()
  await page.getByRole('slider', { name: /Research/ }).fill('60')
  await page.getByRole('button', { name: 'Apply decision' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×16' }).click()
  await page.getByRole('button', { name: 'Play' }).click()

  const relief = page.locator('.paradox[data-state="relief"]')
  await expect(relief).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(relief).toContainText('The debt was cleared. The history holds again.')
  await expect(notice).toHaveCount(0)
  // FEAT: o mesmo observador que ficou em zero durante a contagem registra o fim do paradoxo
  expect(await announced(page)).toBeGreaterThan(0)
})

test('shows no paradox notice on a history that holds', async ({ page }) => {
  await worldAtYear(page, 5)
  await expect(page.locator('.paradox')).toHaveCount(0)
})
