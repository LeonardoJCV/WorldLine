import { expect, test, type Page } from '@playwright/test'
import { INHERITANCE_CASE } from '../src/engine/golden.ts'
import { useGraphics } from './stage.ts'
import { inheritanceLink, SIBLING_CASE, siblingInheritanceLink, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

test('shows how far a history has settled once the rocket is standing', async ({ page }) => {
  test.slow()
  test.setTimeout(120_000)
  // FEAT: o portão é a obra, não a era: o roteiro dourado funda a colônia no ano seguinte ao do
  // foguete, e cento e vinte anos depois ela já se basta (golden.ts, check.test.ts)
  await page.goto(inheritanceLink(INHERITANCE_CASE.founded + 120))

  const colonies = page.locator('.state__colonies')
  await expect(colonies).toBeVisible({ timeout: 90_000 })

  await expect(colonies).toContainText('Colonies')
  await expect(colonies).toContainText(/One on \S+|\d+, the most advanced on \S+/)
  await expect(colonies).toContainText(/self-sufficient|still supported from home/)
})

test('has no colonies line on a worldline that never leaves its planet', async ({ page }) => {
  await worldAtYear(page, 5)
  await expect(page.locator('.state__colonies')).toHaveCount(0)
})

// FEAT: só conta a mutação que a região viva anunciaria, como em paradox.spec.ts
async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('.notices')
    if (!region) throw new Error('the notices region is missing')
    const counter = { announced: 0 }
    Object.assign(window, { noticeWatch: counter })
    new MutationObserver((records) => {
      counter.announced += records.length
    }).observe(region, { childList: true, characterData: true, subtree: true })
  })
}

async function announced(page: Page): Promise<number> {
  return page.evaluate(() => {
    const watch = (window as unknown as { noticeWatch?: { announced: number } }).noticeWatch
    return watch ? watch.announced : -1
  })
}

test('announces that a history survived its own world', async ({ page }) => {
  test.slow()
  // FEAT: a colônia já se basta desde 2262; o paradoxo do ciclo vence o prazo em 2470
  await page.goto(inheritanceLink(INHERITANCE_CASE.ended - 13))
  await expect(page.locator('.state__colonies')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.paradox[data-state="warning"]')).toBeVisible()
  await watchAnnouncements(page)

  await page.getByRole('button', { name: '×16' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const notice = page.locator('.inheritance')
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Pause' }).click()

  // FEAT: Lulia e Dedes são os corpos desta semente, e o ano é o gravado no roteiro dourado
  await expect(notice.locator('.inheritance__when')).toContainText(`Year ${INHERITANCE_CASE.ended}`)
  await expect(notice.locator('.inheritance__moved')).toHaveText(
    'The history moved to Lulia. 835.6K survived the end of Dedes.',
  )
  await expect(notice.locator('.inheritance__kept')).toHaveText('What the world knew was not lost.')
  // FEAT: o paradoxo morreu com o planeta; ninguém quitou nada, e nada de alívio é anunciado
  await expect(page.locator('.paradox')).toHaveCount(0)
  // FEAT: a história continua, agora sem frota — a colônia virou o lar
  await expect(page.locator('.state__colonies')).toHaveCount(0)

  // FEAT: o anúncio não se repete a cada ano que passa na casa nova
  const once = await announced(page)
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(notice).toBeVisible()
  expect(await announced(page)).toBe(once)

  // FEAT: alguns segundos de leitura e o anúncio sai sozinho, sem nada para recolher
  await expect(notice).toHaveCount(0, { timeout: 30_000 })
})

test('says nothing on a history that arrives already moved', async ({ page }) => {
  test.slow()
  await page.goto(inheritanceLink(INHERITANCE_CASE.year + 100))
  await expect(page.locator('.panel.state')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.inheritance')).toHaveCount(0)
  await expect(page.locator('.paradox')).toHaveCount(0)
})

test('reaches the colony that saved the history, and tells the whole story of the fleet', async ({
  page,
}) => {
  test.slow()
  test.setTimeout(150_000)
  await useGraphics(page, '2d')
  // FEAT: a semente 4242 (support.ts) funda duas colônias antes do colapso, ao contrário do roteiro
  // dourado da herança (uma só) — só assim a lista tem uma irmã para perder de verdade
  // FIX: +5 anos depois do colapso — no próprio ano do prazo o passo que resolve o paradoxo ainda
  // não rodou, e a herança daquele ano ainda não teria aparecido na lista
  await page.goto(siblingInheritanceLink(SIBLING_CASE.ended + 5))
  const events = page.locator('.panel.events')
  await expect(events).toBeVisible({ timeout: 60_000 })
  // FIX: vinte e cinco séculos para calcular — o painel aparece antes de o worker chegar ao ano pedido
  await expect(events.locator('.events__item').first()).toContainText('Inheritance', {
    timeout: 90_000,
  })

  // FEAT: fundamos duas, uma se salvou, a outra se perdeu com o planeta — a leitura do conjunto
  await expect(events.locator('.events__item', { hasText: 'Colony lost' })).toBeVisible()
  await expect(events.locator('.events__item', { hasText: 'New colony' }).first()).toBeVisible()

  // FEAT: a cadeia causal da herança alcança a fundação da colônia que a salvou (Colony.record) e
  // sobe dali até a era que abriu a fundação — sem clicar de novo, dentro do MAX_DEPTH do painel
  await events.locator('.events__item', { hasText: 'Inheritance' }).first().click()
  await expect(
    page.locator('.causal__node[data-kind="event"]', { hasText: 'New colony' }),
  ).toBeVisible()
  await expect(
    page.locator('.causal__node[data-kind="event"]', { hasText: 'Space age' }),
  ).toBeVisible()
})
