import { expect, test, type Page } from '@playwright/test'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../src/engine/golden.ts'
import { MODEL_VERSION } from '../src/engine/params.ts'
import { encodeMultiverse } from '../src/app/world/link.ts'
import { useGraphics } from './stage.ts'
import {
  installParadox,
  pickOrigin,
  runToCollapse,
  runToParadox,
  SIBLING_CASE,
  siblingInheritanceLink,
} from './support.ts'

test.skip(!process.env.SCREENS, 'screenshots are captured on demand')

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

for (const viewport of VIEWPORTS) {
  test(`observatory ${viewport.name}`, async ({ page }) => {
    await useGraphics(page, '2d')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `screens/observatory-${viewport.name}.png` })
  })
}

for (const viewport of VIEWPORTS) {
  test(`hud ${viewport.name}`, async ({ page }) => {
    await useGraphics(page, '2d')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `screens/hud-${viewport.name}.png` })
  })
}

test('hud phone bar', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Pause' }).click()
  // FEAT: com o menu aberto a captura mostra a barra curta e o que passou a morar atrás dela
  await page.getByRole('button', { name: 'World and language' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screens/hud-phone-bar.png' })
})

test('hud collapsed', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Pause' }).click()
  for (const name of [
    /^Collapse State in year/,
    'Collapse Why it happened',
    'Collapse Keep this world',
  ]) {
    await page.getByRole('button', { name }).click()
  }
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screens/hud-collapsed.png' })
})

for (const viewport of VIEWPORTS) {
  test(`genesis ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await page.getByLabel('Seed (a number or a word)').fill('atlantis')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `screens/genesis-${viewport.name}.png` })
  })
}

test('observatory causal chain', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.locator('.events__item').first().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-causal.png' })
})

test('observatory intervene', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screens/observatory-intervene.png' })
})

for (const level of ['low', 'high', 'ultra'] as const) {
  test(`genesis planet ${level}`, async ({ page }) => {
    await useGraphics(page, level)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `screens/genesis-planet-${level}.png` })
  })
}

test('observatory multiverse', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 25; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-multiverse.png' })
})

async function enterCross(page: Page, width: number, height: number) {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width, height })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 25; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await expect(page.locator('.cross__price')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open the crossing' })).toBeEnabled()
  await page.waitForTimeout(300)
}

test('cross panel', async ({ page }) => {
  await enterCross(page, 1440, 900)
  await page.screenshot({ path: 'screens/cross-panel.png' })
})

test('cross causal', async ({ page }) => {
  test.setTimeout(120_000)
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < 5; i++) await step.click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await branch.click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Doctrine' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  const golden = page.locator('.events__item', { hasText: 'Golden age' }).first()
  await expect(golden).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await golden.click()
  await expect(page.locator('.causal__node[data-kind="crossing"]')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/cross-causal.png' })
})

test('state debt', async ({ page }) => {
  test.slow()
  await enterCross(page, 1440, 900)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await page.getByRole('button', { name: 'Observe' }).click()
  // FIX: a dívida entra na engine só no passo que segue a chegada, não no ano em que a travessia abre
  await page.getByRole('button', { name: 'Advance one year' }).click()
  const panel = page.locator('.panel.state')
  await expect(panel.locator('.state__debt')).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await panel.screenshot({ path: 'screens/state-debt.png' })
})

test('state colonies', async ({ page }) => {
  test.setTimeout(120_000)
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  // FIX: com o presente ainda no ano 0 a régua não tem para onde voltar e "Home" não dispara o
  // cursor; um passo antes dá à régua uma faixa de verdade para escolher o ano 0 como passado
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  // FEAT: mesma alocação do roteiro dourado SPACEFARING, a única calibrada a abrir a era espacial
  // perto do ano 1800 nesta semente (calibration.test.ts, "the quickest path to the sky")
  await page.getByRole('slider', { name: /Agriculture/ }).fill('20')
  await page.getByRole('slider', { name: /Research/ }).fill('30')
  await page.getByRole('slider', { name: /Conservation/ }).fill('0')
  await page.getByRole('slider', { name: /Industry/ }).fill('50')
  await branch.click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: '×64' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.state__colonies')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Pause' }).click()

  // FEAT: uma dívida ao lado das colônias, para a captura mostrar as duas linhas convivendo
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A little' }).click()
  await expect(page.getByRole('button', { name: 'Open the crossing' })).toBeEnabled()
  await page.getByRole('button', { name: 'Open the crossing' }).click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await page.getByRole('button', { name: 'Observe' }).click()
  // FIX: a dívida entra na engine só no passo que segue a chegada, não no ano em que a travessia abre
  await page.getByRole('button', { name: 'Advance one year' }).click()

  const panel = page.locator('.panel.state')
  await expect(panel.locator('.state__debt')).toBeVisible()
  await expect(panel.locator('.state__colonies')).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await panel.screenshot({ path: 'screens/state-colonies.png' })
})

for (const viewport of VIEWPORTS) {
  test(`inheritance notice ${viewport.name}`, async ({ page }) => {
    test.slow()
    await useGraphics(page, '2d')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    // FEAT: o roteiro dourado da herança (golden.ts), aberto treze anos antes da queda do mundo natal
    const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
    const link = encodeMultiverse({
      version: MODEL_VERSION,
      seed: INHERITANCE_CASE.seed,
      tick: INHERITANCE_CASE.ended - 13,
      decisions: plan.decisions,
      crossings: plan.crossings,
      branches: [],
    })
    await page.goto(`/#/m/${link}`)
    await expect(page.getByRole('button', { name: '×16' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '×16' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    const notice = page.locator('.inheritance')
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Pause' }).click()
    // FEAT: o anúncio é a frase mais larga da tela; num celular ela não pode empurrar a página
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    await expect(notice).toBeInViewport()
    await page.waitForTimeout(300)
    const name = viewport.name === 'desktop' ? 'inheritance-notice' : 'inheritance-notice-mobile'
    await page.screenshot({ path: `screens/${name}.png` })
  })
}

test('inheritance causal', async ({ page }) => {
  test.slow()
  test.setTimeout(150_000)
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  // FEAT: semente 4242 (support.ts) — duas colônias fundadas, uma vira a herdeira, a outra se perde
  // com o planeta; a captura mostra a cadeia inteira e a irmã perdida na mesma lista
  await page.goto(siblingInheritanceLink(SIBLING_CASE.ended + 5))
  const events = page.locator('.panel.events')
  await expect(events.locator('.events__item').first()).toContainText('Inheritance', {
    timeout: 90_000,
  })
  await events.locator('.events__item', { hasText: 'Inheritance' }).first().click()
  await expect(
    page.locator('.causal__node[data-kind="event"]', { hasText: 'Space age' }),
  ).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/inheritance-causal.png' })
})

for (const viewport of VIEWPORTS) {
  test(`paradox notice ${viewport.name}`, async ({ page }) => {
    test.slow()
    await useGraphics(page, '2d')
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await installParadox(page)
    await runToParadox(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    const notice = page.locator('.paradox')
    await notice.scrollIntoViewIfNeeded()
    await expect(notice).toBeInViewport()
    await page.waitForTimeout(300)
    const name = viewport.name === 'desktop' ? 'paradox-notice' : 'paradox-notice-mobile'
    await page.screenshot({ path: `screens/${name}.png` })
  })
}

test('worlds collapsed', async ({ page }) => {
  test.slow()
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await installParadox(page)
  await runToCollapse(page)
  const strip = page.locator('.worlds')
  await strip.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await strip.screenshot({ path: 'screens/worlds-collapsed.png' })
})

test('paradox causal', async ({ page }) => {
  test.slow()
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await installParadox(page)
  await runToCollapse(page)
  await page.locator('.events__item', { hasText: 'Collapse' }).first().click()
  await expect(page.locator('.causal__node[data-kind="crossing"]')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/paradox-causal.png' })
})

test('cross panel mobile', async ({ page }) => {
  await enterCross(page, 390, 844)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  const action = page.getByRole('button', { name: 'Open the crossing' })
  await action.scrollIntoViewIfNeeded()
  await expect(action).toBeInViewport()
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'screens/cross-panel-mobile.png' })
})

test('observatory multiverse 3d', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 25; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-multiverse-3d.png' })
})

for (const level of ['low', 'high', 'ultra'] as const) {
  test(`observatory 3d ${level}`, async ({ page }) => {
    await useGraphics(page, level)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `screens/observatory-3d-${level}.png` })
  })
}

test('observatory 3d cursor', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 20; i++) await history.press('Shift+ArrowRight')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'screens/observatory-3d-cursor.png' })
})

test('current micro', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  const current = page.getByRole('slider', { name: /Worldline history/ })
  await current.focus()
  for (let i = 0; i < 20; i++) await current.press('+')
  await expect(page.locator('.scene3d')).not.toHaveAttribute('data-micro', '0', { timeout: 10_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'screens/current-micro.png' })
})

test('current crossing', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  await page.getByRole('slider', { name: /Industry/ }).fill('95')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  // FEAT: uma travessia no meio da história de B pousa na trança, já divergida da origem
  const canvas = page.locator('.scene3d__canvas')
  const present = Number(await canvas.getAttribute('aria-valuemax'))
  const target = Math.round(present / 2)
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(target / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < target % 10; i++) await history.press('ArrowRight')
  const year = await page.getByTestId('year').textContent()
  await page.getByRole('button', { name: `Cross in year ${year}` }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.scene3d')).not.toHaveAttribute('data-arcs', '0', { timeout: 10_000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'screens/current-crossing.png' })
})

test('current crossing card', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  await page.getByRole('slider', { name: /Industry/ }).fill('95')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  // FEAT: mesmo enquadramento de current-crossing, mas com a ficha da travessia aberta
  const canvas = page.locator('.scene3d__canvas')
  const present = Number(await canvas.getAttribute('aria-valuemax'))
  const target = Math.round(present / 2)
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(target / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < target % 10; i++) await history.press('ArrowRight')
  const year = await page.getByTestId('year').textContent()
  await page.getByRole('button', { name: `Cross in year ${year}` }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.scene3d')).not.toHaveAttribute('data-arcs', '0', { timeout: 10_000 })
  const list = page.getByRole('list', { name: 'Crossings on the currents' })
  await expect(list.getByRole('button').first()).toBeAttached({ timeout: 10_000 })
  const crossing = list.getByRole('button').first()
  await crossing.focus()
  await crossing.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'screens/current-crossing-card.png' })
})

test('current echo', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  await page.getByRole('slider', { name: /Industry/ }).fill('95')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  // FEAT: mesmo enquadramento de current-crossing (a travessia é Knowledge por padrão, ecoa)
  const canvas = page.locator('.scene3d__canvas')
  const present = Number(await canvas.getAttribute('aria-valuemax'))
  const target = Math.round(present / 2)
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(target / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < target % 10; i++) await history.press('ArrowRight')
  const year = await page.getByTestId('year').textContent()
  await page.getByRole('button', { name: `Cross in year ${year}` }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.scene3d')).not.toHaveAttribute('data-arcs', '0', { timeout: 10_000 })
  // FEAT: cursor pousa 15 anos depois da travessia, dentro da janela de eco de 30 anos
  const echoYear = target + 15
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(echoYear / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < echoYear % 10; i++) await history.press('ArrowRight')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'screens/current-echo.png' })
})

test('current echo zoomed', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  await page.getByRole('slider', { name: /Industry/ }).fill('95')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  const canvas = page.locator('.scene3d__canvas')
  const present = Number(await canvas.getAttribute('aria-valuemax'))
  const target = Math.round(present / 2)
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(target / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < target % 10; i++) await history.press('ArrowRight')
  const year = await page.getByTestId('year').textContent()
  await page.getByRole('button', { name: `Cross in year ${year}` }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Observe' }).click()
  await expect(page.locator('.scene3d')).not.toHaveAttribute('data-arcs', '0', { timeout: 10_000 })
  // FEAT: cursor pousa perto do fim da janela de eco, dentro dela, e vira o foco do zoom
  const echoYear = target + 20
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(echoYear / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < echoYear % 10; i++) await history.press('ArrowRight')
  // FEAT: zoom fechado o bastante para o início da janela (o ano da travessia) sair da tela
  for (let i = 0; i < 30; i++) await history.press('+')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'screens/current-echo-zoomed.png' })
})

test('current 2d crossing', async ({ page }) => {
  await useGraphics(page, '2d')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < 6; i++) await history.press('Shift+ArrowRight')
  await expect(page.getByRole('button', { name: /Branch from year/ })).toBeEnabled()
  const industry = page.getByRole('slider', { name: /Industry/ })
  await industry.focus()
  for (let i = 0; i < 25; i++) await industry.press('ArrowRight')
  await page.getByRole('button', { name: /Branch from year/ }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  // FEAT: a travessia pousa logo após a bifurcação, quando a distância até a origem é maior
  const target = 75
  await history.focus()
  await history.press('Home')
  for (let i = 0; i < Math.floor(target / 10); i++) await history.press('Shift+ArrowRight')
  for (let i = 0; i < target % 10; i++) await history.press('ArrowRight')
  const year = await page.getByTestId('year').textContent()
  await page.getByRole('button', { name: `Cross in year ${year}` }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Observe' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: 'screens/current-2d-crossing.png' })
})

test('observatory 3d mobile', async ({ page }) => {
  await useGraphics(page, 'low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.waitForTimeout(800)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  await expect(page.getByRole('button', { name: 'Recenter' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeInViewport()
  await page.screenshot({ path: 'screens/observatory-3d-mobile.png' })
})

test('surface orbit', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'orbit', { timeout: 10_000 })
  await page.getByLabel('Follow the sun').uncheck()
  const orbitHour = page.getByLabel('Time of day')
  await orbitHour.focus()
  await orbitHour.press('Home')
  for (let i = 0; i < 8; i++) await orbitHour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-orbit.png' })
})

test('surface continent', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'continent', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const continentHour = page.getByLabel('Time of day')
  await continentHour.focus()
  await continentHour.press('Home')
  for (let i = 0; i < 8; i++) await continentHour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-continent.png' })
})

test('surface region', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const regionHour = page.getByLabel('Time of day')
  await regionHour.focus()
  await regionHour.press('Home')
  for (let i = 0; i < 8; i++) await regionHour.press('ArrowRight')
  const regionCanvas = page.locator('.surface__canvas')
  await regionCanvas.focus()
  for (let i = 0; i < 6; i++) await regionCanvas.press('+')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-region.png' })
})

test('surface night', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Continent' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'continent', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const hour = page.getByLabel('Time of day')
  await hour.focus()
  await hour.press('Home')
  for (let i = 0; i < 75; i++) await hour.press('ArrowRight')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-night.png' })
})

test('surface mobile', async ({ page }) => {
  await useGraphics(page, 'low')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'Region' }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', 'region', {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const mobileHour = page.getByLabel('Time of day')
  await mobileHour.focus()
  await mobileHour.press('Home')
  for (let i = 0; i < 8; i++) await mobileHour.press('ArrowRight')
  const mobileCanvas = page.locator('.surface__canvas')
  await mobileCanvas.focus()
  for (let i = 0; i < 6; i++) await mobileCanvas.press('+')
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'screens/surface-mobile.png' })
})

for (const level of ['Continent', 'Region'] as const) {
  test(`surface ${level.toLowerCase()} ultra`, async ({ page }) => {
    await useGraphics(page, 'ultra')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.getByRole('button', { name: 'View planet' }).click()
    await page.getByRole('button', { name: level }).click()
    await expect(page.locator('.surface')).toHaveAttribute('data-level', level.toLowerCase(), {
      timeout: 10_000,
    })
    await page.getByLabel('Follow the sun').uncheck()
    const hour = page.getByLabel('Time of day')
    await hour.focus()
    await hour.press('Home')
    for (let i = 0; i < 8; i++) await hour.press('ArrowRight')
    await page.waitForTimeout(5000)
    await page.screenshot({ path: `screens/surface-${level.toLowerCase()}-ultra.png` })
  })
}

interface LifeRun {
  readonly level: 'Orbit' | 'Continent' | 'Region'
  readonly steps?: number
  readonly hour?: number
  readonly industry?: number
  readonly extinct?: boolean
  readonly seconds?: number
  readonly seed?: number
  readonly back?: number
  readonly zoom?: number
  readonly until?: string
  readonly width?: number
  readonly height?: number
}

async function enterLife(page: Page, run: LifeRun) {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: run.width ?? 1440, height: run.height ?? 900 })
  await page.goto(`/?seed=${run.seed ?? 482913}`)
  if (run.industry !== undefined) {
    await page.getByRole('button', { name: 'Intervene' }).click()
    if (run.extinct) await page.getByRole('slider', { name: /Conservation/ }).fill('0')
    await page.getByRole('slider', { name: /Industry/ }).fill(String(run.industry))
    await page.getByRole('button', { name: 'Apply decision' }).click()
    await page.getByRole('button', { name: 'Observe' }).click()
  }
  if (run.extinct) {
    await page.getByRole('button', { name: 'Max' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 120_000 })
    if (run.back) {
      const history = page.getByRole('slider', { name: /Worldline history from year 0/ })
      await expect(history).not.toHaveAttribute('aria-valuemax', '0')
      const present = Number(await history.getAttribute('aria-valuemax'))
      for (let i = 0; i < Math.floor(run.back / 10); i++) await history.press('Shift+ArrowLeft')
      for (let i = 0; i < run.back % 10; i++) await history.press('ArrowLeft')
      await expect(history).toHaveAttribute('aria-valuenow', String(present - run.back))
    }
  } else if (run.steps) {
    const step = page.getByRole('button', { name: 'Advance one year' })
    for (let i = 0; i < run.steps; i++) await step.click()
  } else if (run.until) {
    await page.getByRole('button', { name: '×64' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.locator('.events__item', { hasText: run.until })).toBeVisible({
      timeout: 120_000,
    })
    await page.getByRole('button', { name: 'Pause' }).click()
  } else {
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout((run.seconds ?? 4) * 1000)
    await page.getByRole('button', { name: 'Pause' }).click()
  }
  await page.getByRole('button', { name: 'View planet' }).click()
  if (run.level !== 'Orbit') await page.getByRole('button', { name: run.level }).click()
  await expect(page.locator('.surface')).toHaveAttribute('data-level', run.level.toLowerCase(), {
    timeout: 10_000,
  })
  await page.getByLabel('Follow the sun').uncheck()
  const hour = page.getByLabel('Time of day')
  await hour.focus()
  await hour.press('Home')
  for (let i = 0; i < (run.hour ?? 8); i++) await hour.press('ArrowRight')
  if (run.zoom) {
    const canvas = page.locator('.surface__canvas')
    await canvas.focus()
    for (let i = 0; i < run.zoom; i++) await canvas.press('+')
  }
  await page.waitForTimeout(4000)
}

const NIGHT_HOUR = 58

test('surface life region', async ({ page }) => {
  await enterLife(page, { level: 'Region' })
  await page.screenshot({ path: 'screens/surface-life-region.png' })
})

test('surface life continent', async ({ page }) => {
  await enterLife(page, { level: 'Continent' })
  await page.screenshot({ path: 'screens/surface-life-continent.png' })
})

test('surface life early', async ({ page }) => {
  await enterLife(page, { level: 'Region', steps: 20 })
  await page.screenshot({ path: 'screens/surface-life-early.png' })
})

test('surface life night', async ({ page }) => {
  await enterLife(page, { level: 'Region', hour: NIGHT_HOUR })
  await page.screenshot({ path: 'screens/surface-life-night.png' })
})

test('surface life continent night', async ({ page }) => {
  await enterLife(page, { level: 'Continent', hour: NIGHT_HOUR })
  await page.screenshot({ path: 'screens/surface-life-continent-night.png' })
})

test('surface life orbit night', async ({ page }) => {
  await enterLife(page, { level: 'Orbit', hour: NIGHT_HOUR })
  await page.screenshot({ path: 'screens/surface-life-orbit-night.png' })
})

test('surface life orbit day', async ({ page }) => {
  await enterLife(page, { level: 'Orbit' })
  await page.screenshot({ path: 'screens/surface-life-orbit.png' })
})

test('surface life industrial', async ({ page }) => {
  test.setTimeout(180_000)
  await enterLife(page, {
    level: 'Region',
    industry: 50,
    until: 'Industrial revolution',
    seconds: 2,
  })
  await page.screenshot({ path: 'screens/surface-life-industrial.png' })
})

test('surface life extinct', async ({ page }) => {
  test.setTimeout(180_000)
  await enterLife(page, { level: 'Region', industry: 60, extinct: true })
  await page.screenshot({ path: 'screens/surface-life-extinct.png' })
})

test('surface life fire', async ({ page }) => {
  test.setTimeout(180_000)
  await enterLife(page, {
    level: 'Region',
    industry: 60,
    extinct: true,
    back: 60,
    hour: NIGHT_HOUR,
  })
  await page.screenshot({ path: 'screens/surface-life-fire.png' })
})

test('surface life walkers', async ({ page }) => {
  await enterLife(page, { level: 'Region', seed: 192, zoom: 3 })
  await page.screenshot({ path: 'screens/surface-life-walkers.png' })
})

test('surface life unrest', async ({ page }) => {
  test.setTimeout(180_000)
  await enterLife(page, {
    level: 'Region',
    industry: 60,
    extinct: true,
    back: 11,
    hour: NIGHT_HOUR,
    zoom: 3,
  })
  await page.screenshot({ path: 'screens/surface-life-unrest.png' })
})

test('surface names continent', async ({ page }) => {
  await enterLife(page, { level: 'Continent' })
  await expect(page.locator('.surface__city').first()).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: 'screens/surface-names-continent.png' })
})

test('surface card', async ({ page }) => {
  await enterLife(page, { level: 'Continent' })
  const city = page.locator('.surface__city').first()
  await expect(city).toBeVisible({ timeout: 15_000 })
  await city.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'screens/surface-card.png' })
})

test('surface card mobile', async ({ page }) => {
  await enterLife(page, { level: 'Continent', width: 390, height: 844 })
  const city = page.locator('.surface__city').first()
  await expect(city).toBeVisible({ timeout: 15_000 })
  await city.click()
  const card = page.getByRole('dialog')
  await expect(card).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBe(0)
  await expect(card).toBeInViewport()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'screens/surface-card-mobile.png' })
})

for (const height of ['hidden', 'peek', 'open'] as const) {
  test(`hud sheet ${height}`, async ({ page }) => {
    await useGraphics(page, '2d')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?seed=482913')
    await page.getByRole('button', { name: '×256' }).click()
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(4000)
    await page.getByRole('button', { name: 'Pause' }).click()
    const handle = page.getByRole('button', { name: /^Panels/ })
    const presses = height === 'peek' ? 0 : height === 'open' ? 1 : 2
    for (let press = 0; press < presses; press++) await handle.click()
    await expect(page.locator('.sheet')).toHaveAttribute('data-state', height)
    // FIX: a folha desliza; a captura espera a altura assentar
    await expect
      .poll(async () => {
        const box = await page.locator('.sheet').boundingBox()
        const stage = await page.locator('.stage').boundingBox()
        if (!box || !stage) return false
        const fraction = height === 'hidden' ? 0.12 : height === 'peek' ? 0.4 : 0.85
        const target = Math.max(height === 'hidden' ? 76 : 0, fraction * stage.height)
        return Math.abs(box.height - target) <= 2
      })
      .toBe(true)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `screens/hud-sheet-${height}.png` })
  })
}

test('hud sheet planet', async ({ page }) => {
  test.slow()
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await installParadox(page)
  await runToParadox(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.paradox')).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'screens/hud-sheet-notice.png' })
  await page.getByRole('button', { name: 'View planet' }).click()
  await expect(page.locator('.stage')).toHaveAttribute('data-lens', 'planet')
  await expect(page.locator('.paradox')).toBeVisible()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: 'screens/hud-sheet-planet.png' })
})

test('system bare', async ({ page }) => {
  await useGraphics(page, 'high')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?seed=482913')
  await page.getByRole('button', { name: '×256' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('button', { name: 'View planet' }).click()
  await page.getByRole('button', { name: 'View the system' }).click()
  await expect(page.locator('.stage')).toHaveAttribute('data-lens', 'system')
  await expect(page.locator('.system__body').first()).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'screens/system-bare.png' })
})
