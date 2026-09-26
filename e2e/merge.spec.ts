import { expect, test, type Locator, type Page } from '@playwright/test'
import { VARIABLES, type Variable } from '../src/engine/state.ts'
import { STRANDS } from '../src/app/current/normalize.ts'
import { useGraphics } from './stage.ts'
import { branchFromStart, worldAtYear } from './support.ts'

test.beforeEach(async ({ page }) => {
  await useGraphics(page, '2d')
})

// FEAT: a mesma ordem que o painel de estado desenha, para ler cada nível pela posição
const STATE_ROWS: readonly Variable[] = [...STRANDS, 'stability']

const modeTab = (page: Page) => page.locator('.mode').getByRole('button', { name: 'Merge' })
const confirm = (page: Page) => page.locator('button.merge__confirm')
const reason = (page: Page) => page.locator('#merge-reason')
const flow = (page: Page, variable: Variable) =>
  page.locator(`.merge__rows li[data-variable="${variable}"] .merge__flow`)

async function stateValue(page: Page, variable: Variable): Promise<string> {
  const row = page.locator('.state__list li').nth(STATE_ROWS.indexOf(variable))
  return ((await row.locator('.state__value').textContent()) ?? '').trim()
}

// FEAT: '1.2M + 800K → 2M' e '5.0 and 4.0 → 4.5' — as três parcelas e a conjunção que as liga
async function parts(row: Locator): Promise<{
  readonly now: string
  readonly incoming: string
  readonly next: string
  readonly kind: 'sum' | 'blend'
}> {
  const text = ((await row.textContent()) ?? '').trim()
  const match = /^(.+?) (\+|and) (.+?) → (.+)$/.exec(text)
  if (!match) throw new Error(`cannot read the seam row: ${text}`)
  const [, now = '', sign = '', incoming = '', next = ''] = match
  return { now, incoming, next, kind: sign === '+' ? 'sum' : 'blend' }
}

async function pairAtYearFive(page: Page) {
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await modeTab(page).click()
}

async function pickHistory(page: Page, id: string) {
  await page.getByRole('button', { name: `From history ${id}, let it flow into this one` }).click()
}

const SCALES: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }

// FEAT: '13.9M' volta a ser um número, para a promessa e o resultado se compararem como grandezas
function compact(text: string): number {
  const match = /^([\d.]+)([KMBT]?)$/.exec(text)
  if (!match) throw new Error(`cannot read the number: ${text}`)
  const [, digits = '', scale = ''] = match
  return Number(digits) * (SCALES[scale] ?? 1)
}

test('opens the fourth mode, shows the seam, and sews the two histories into one', async ({
  page,
}) => {
  test.slow()
  await pairAtYearFive(page)
  await expect(modeTab(page)).toHaveAttribute('aria-pressed', 'true')

  // FEAT: sem escolha, o painel pede uma em vez de desabilitar um botão calado
  await expect(reason(page)).toHaveText('Choose the history that flows into this one')
  await expect(confirm(page)).toBeDisabled()

  await pickHistory(page, 'A')
  await expect(page.locator('.merge__pair')).toHaveText('Merge B with A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)
  await expect(page.locator('.merge__shock')).toHaveText(/^Stability takes [\d.]+ from the seam$/)
  await expect(page.locator('.merge__ends')).toHaveText('Both histories end here. B continues.')
  await expect(reason(page)).toHaveText('')
  await expect(confirm(page)).toBeEnabled()

  await confirm(page).click()

  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toContainText(
    'Flowed into B in 0005',
  )
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // FEAT: a que sobrou segue viva, e é ela que o ano seguinte faz andar
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0006')
  await expect(page.locator('.events__item', { hasText: 'Confluence' })).toBeVisible()
})

// FEAT: a asserção que sustenta o painel — cada número que ele mostra é um número que o estado tem
test('shows the two histories exactly as their own states read them, and sums what the seam sums', async ({
  page,
}) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)

  const shown = new Map<Variable, Awaited<ReturnType<typeof parts>>>()
  for (const variable of VARIABLES) shown.set(variable, await parts(flow(page, variable)))

  // FEAT: a coluna da esquerda é o estado da história em foco, lido no painel de estado dela
  for (const variable of VARIABLES) {
    expect(shown.get(variable)?.now).toBe(await stateValue(page, variable))
  }

  // FEAT: e a do meio é o estado da outra, lido no painel de estado DELA
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  for (const variable of VARIABLES) {
    expect(shown.get(variable)?.incoming).toBe(await stateValue(page, variable))
  }

  // FEAT: gente e celeiro somam-se na costura; os níveis misturam-se, e o rótulo de cada linha diz qual foi
  expect(shown.get('population')?.kind).toBe('sum')
  expect(shown.get('food')?.kind).toBe('sum')
  for (const variable of ['energy', 'technology', 'economy', 'environment', 'stability'] as const) {
    expect(shown.get(variable)?.kind).toBe('blend')
  }
  expect(shown.get('population')?.next).not.toBe(shown.get('population')?.now)
})

// FIX: o instante da costura não é um estado de ninguém — o motor o aplica DENTRO do ano seguinte,
// então o que se confere depois de confirmar é o presente intacto e a união no ano que vira
test('keeps the seam pending until the year turns, and then the union the panel promised is there', async ({
  page,
}) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)
  const before = await stateValue(page, 'population')
  const promised = (await parts(flow(page, 'population'))).next

  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')

  await expect(page.getByTestId('year')).toHaveText('0005')
  expect(await stateValue(page, 'population')).toBe(before)

  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0006')
  const after = await stateValue(page, 'population')
  expect(after).not.toBe(before)
  // FEAT: o ano vivido por cima da costura move a gente uns poucos por cento; mostrar a coluna
  // da esquerda no lugar da direita erraria por metade, e esta margem pegaria
  expect(compact(after)).toBeGreaterThan(compact(promised) * 0.9)
  expect(compact(after)).toBeLessThan(compact(promised) * 1.1)
  expect(compact(promised)).toBeGreaterThan(compact(before) * 1.8)
})

// FIX: a costura cortada pelo pé da coluna foi o que a captura mostrou; aceitar às cegas é o que
// este teste impede — os níveis, o aviso e o botão cabem todos dentro do que se vê
test('keeps the whole seam, the warning and the button inside the column that holds them', async ({
  page,
}) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)

  const fits = await page.evaluate(() => {
    const rail = document.querySelector('.hud__left')
    if (!rail) return null
    const box = rail.getBoundingClientRect()
    const inside = (selector: string) => {
      const node = document.querySelector(selector)
      if (!node) return false
      const rect = node.getBoundingClientRect()
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
    }
    const seam = document.querySelector('.merge__seam')
    return {
      rows: inside('.merge__rows'),
      shock: inside('.merge__shock'),
      ends: inside('.merge__ends'),
      confirm: inside('button.merge__confirm'),
      seamWhole: seam ? seam.scrollHeight <= seam.clientHeight + 1 : false,
    }
  })
  if (!fits) throw new Error('the merge rail did not render')
  expect(fits).toEqual({ rows: true, shock: true, ends: true, confirm: true, seamWhole: true })
})

// FEAT: no celular os níveis voltam a uma coluna só, e nada empurra a tela de lado
test('reads the seam on a phone without pushing the screen sideways', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 390, height: 844 })
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(sideways).toBe(0)
})

test('reproduces the confluence from the link alone', async ({ page }) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')
  await expect(page).toHaveURL(/#\/m\//)

  // FIX: a costura tem de voltar do endereço, não do que sobrou na memória
  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)

  await expect(page.getByTestId('year')).toHaveText('0005')
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toContainText(
    'Flowed into B in 0005',
  )
  await modeTab(page).click()
  // FEAT: reaberto, o foco cai em A, que desaguou — e nem ela nem a que sobrou têm com quem costurar
  await expect(reason(page)).toHaveText('This history has ended; nothing can flow into it')
  await page.getByRole('button', { name: 'Focus on worldline B' }).click()
  await expect(reason(page)).toHaveText('No other living history to merge with')
})

test('refuses a dead history, a second seam in the same year and a history that has ended, each with its own words', async ({
  page,
}) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await branchFromStart(page)
  await modeTab(page).click()
  await expect(page.getByRole('button', { name: 'Focus on worldline C' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await pickHistory(page, 'A')
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('A flowed into C.')

  // FEAT: a que desaguou não se oferece mais, e o ano já gastou a sua costura
  await expect(
    page.getByRole('button', { name: 'From history A, let it flow into this one' }),
  ).toHaveCount(0)
  await pickHistory(page, 'B')
  await expect(reason(page)).toHaveText(
    'C already took a confluence in 0005, and a history takes one a year',
  )
  await expect(confirm(page)).toBeDisabled()
  await expect(confirm(page)).toHaveAttribute('aria-describedby', /merge-reason/)

  // FEAT: no ano seguinte a mesma escolha passa a valer
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(reason(page)).toHaveText('')
  await expect(confirm(page)).toBeEnabled()

  // FEAT: e dentro de uma história que já desaguou nada mais deságua
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await expect(reason(page)).toHaveText('This history has ended; nothing can flow into it')
  await expect(confirm(page)).toBeDisabled()
})

test('sews the two histories by keyboard alone, reading the cost before accepting it', async ({
  page,
}) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)

  const tab = modeTab(page)
  await tab.focus()
  await tab.press('Enter')
  await expect(page.locator('.panel.merge')).toBeVisible()

  const offer = page.getByRole('button', { name: 'From history A, let it flow into this one' })
  await offer.focus()
  await offer.press('Enter')
  await expect(offer).toHaveAttribute('aria-pressed', 'true')

  // FEAT: a costura se lê inteira antes de ser aceita, sem tocar o mouse
  await expect(page.locator('.merge__pair')).toHaveText('Merge B with A')
  await expect(page.locator('.merge__ends')).toHaveText('Both histories end here. B continues.')
  const button = confirm(page)
  await expect(button).toBeEnabled()
  await button.focus()
  await button.press('Enter')

  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')

  // FEAT: e sair do modo também é coisa de teclado
  const observe = page.locator('.mode').getByRole('button', { name: 'Observe' })
  await observe.focus()
  await observe.press('Enter')
  await expect(page.locator('.panel.merge')).toHaveCount(0)
})
