import { expect, test, type Locator, type Page } from '@playwright/test'
import { VARIABLES, type Variable } from '../src/engine/state.ts'
import { STRANDS } from '../src/app/current/normalize.ts'
import { useGraphics } from './stage.ts'
import { branchFromStart, installParadox, runToParadox, worldAtYear } from './support.ts'

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

// FEAT: a tira e o painel oferecem a mesma escolha por dois botões diferentes; o nome acessível
// mais longo é o da tira, e é por ele que se distingue um do outro
function stripPick(page: Page, id: string) {
  return page.getByRole('button', { name: `From history ${id}, let it flow into this one` })
}

function panelPick(page: Page, id: string) {
  return page
    .locator('.merge__group')
    .getByRole('button', { name: `From history ${id}`, exact: true })
}

async function pickHistory(page: Page, id: string) {
  await stripPick(page, id).click()
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
  await expect(page.locator('.merge__shock')).toHaveText(
    /^The seam takes [\d.]+ from stability, and the number above already counts it$/,
  )
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

// FIX: todo o resto da suíte escolhe pela tira; sem isto o botão do próprio painel podia não
// fazer nada e nenhum teste notaria
test('chooses the history from the panel itself, and both offers agree on the choice', async ({
  page,
}) => {
  test.slow()
  await pairAtYearFive(page)
  await expect(panelPick(page, 'A')).toHaveAttribute('aria-pressed', 'false')

  await panelPick(page, 'A').click()

  await expect(panelPick(page, 'A')).toHaveAttribute('aria-pressed', 'true')
  await expect(stripPick(page, 'A')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.merge__pair')).toHaveText('Merge B with A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)
  await expect(confirm(page)).toBeEnabled()

  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')
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

// FIX: numa janela baixa o cartão não pode passar do pé da coluna; se passar, o botão de aceitar
// sai da vista e só volta rolando a coluna inteira
test('never lets the seam card grow past the column, however short the window', async ({
  page,
}) => {
  test.slow()
  await page.setViewportSize({ width: 1440, height: 640 })
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)

  const squeeze = await page.evaluate(() => {
    const rail = document.querySelector('.hud__left')
    const card = document.querySelector('.card--merge')
    const seam = document.querySelector('.merge__seam')
    if (!rail || !card || !seam) return null
    return {
      card: card.getBoundingClientRect().height,
      rail: rail.clientHeight,
      seamScrolls: seam.scrollHeight > seam.clientHeight,
    }
  })
  if (!squeeze) throw new Error('the merge rail did not render')
  expect(squeeze.card).toBeLessThanOrEqual(squeeze.rail + 1)
  // FEAT: o aperto degrada para rolagem dos níveis, não para um cartão que transborda
  expect(squeeze.seamScrolls).toBe(true)
})

// FEAT: no celular os níveis voltam a uma coluna só, e a costura cabe na largura que tem
test('reads the seam on a phone without pushing anything sideways', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 390, height: 844 })
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(page.locator('.merge__rows li')).toHaveCount(VARIABLES.length)

  const narrow = await page.evaluate(() => {
    const seam = document.querySelector('.merge__seam')
    const rows = [...document.querySelectorAll('.merge__rows li')]
    if (!seam) return null
    const width = seam.clientWidth
    const flows = [...document.querySelectorAll('.merge__flow')]
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      seamOverflow: seam.scrollWidth - seam.clientWidth,
      wide: rows.filter((row) => row.getBoundingClientRect().width > width + 1).length,
      // FEAT: numa coluna só, cada nível ocupa a largura inteira; em duas, metade dela
      narrowed: rows.filter((row) => row.getBoundingClientRect().width < width * 0.9).length,
      clipped: flows.filter((flow) => flow.scrollWidth > flow.clientWidth + 1).length,
      width,
    }
  })
  if (!narrow) throw new Error('the seam did not render')
  expect(narrow.width).toBeGreaterThan(0)
  // FEAT: legível é a costura caber no que se vê dela, não só a página não andar de lado
  expect(narrow.seamOverflow).toBeLessThanOrEqual(0)
  expect(narrow.wide).toBe(0)
  expect(narrow.narrowed).toBe(0)
  expect(narrow.clipped).toBe(0)
  expect(narrow.page).toBe(0)
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
  await expect(stripPick(page, 'A')).toHaveCount(0)
  await expect(panelPick(page, 'A')).toHaveCount(0)
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

  const offer = stripPick(page, 'A')
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

// FEAT: só conta a mutação que a região viva anunciaria, como a suíte do paradoxo já conta
async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('.notices')
    if (!region) throw new Error('the notices region is missing')
    const counter = { announced: 0 }
    Object.assign(window, { confluenceWatch: counter })
    new MutationObserver((records) => {
      counter.announced += records.length
    }).observe(region, { childList: true, characterData: true, subtree: true })
  })
}

async function announced(page: Page): Promise<number> {
  return page.evaluate(() => {
    const watch = (window as unknown as { confluenceWatch?: { announced: number } }).confluenceWatch
    return watch ? watch.announced : -1
  })
}

const notice = (page: Page) => page.locator('.confluence')

// FEAT: os dois relógios da tela — o do aviso do painel e o tempo de leitura do anúncio
const TOAST_MS = 6000
const READING_MS = 15000

test('announces that two histories became one, in a live region, once and in the seam year', async ({
  page,
}) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()

  // FIX: o motor costura DENTRO do ano seguinte, então o que se promete aqui é o ano que vira
  await expect(page.locator('.merge__turns')).toHaveText(
    'The seam is written; it takes effect as the year turns.',
  )
  await expect(notice(page)).toHaveCount(0)
  await expect(page.getByTestId('year')).toHaveText('0005')

  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(notice(page)).toBeVisible()
  // FEAT: cumprida a promessa, quem fala da união é o anúncio, e a promessa sai da tela
  await expect(page.locator('.merge__turns')).toHaveCount(0)

  // FEAT: o anúncio é lido por região viva, a mesma em que o paradoxo e a herança falam
  const live = await page.evaluate(() => {
    const section = document.querySelector('.confluence')
    return section?.closest('[role="status"], [aria-live]')?.getAttribute('role') ?? null
  })
  expect(live).toBe('status')

  // FIX: três anos não mexem no número arredondado; séculos mexem, e é com eles que se prova que
  // um anúncio recontado a cada ano reescreveria diante dos olhos de quem o lê
  await watchAnnouncements(page)
  const spoken = await page.locator('.confluence').innerHTML()
  const said = compact(/([\d.]+[KMBT]?) live on together/.exec(spoken)?.[1] ?? '0')
  await page.getByRole('button', { name: '×64' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(READING_MS / 2)
  await page.getByRole('button', { name: 'Pause' }).click()

  // FEAT: a premissa do teste, medida e não suposta: a gente de agora já não é a que se anunciou
  expect(compact(await stateValue(page, 'population'))).not.toBe(said)
  await expect(notice(page)).toBeVisible()
  await expect(page.locator('.confluence__when')).toHaveText('✧Year 0005')
  await expect(page.locator('.confluence__joined')).toHaveText(
    /^A flowed into B\. [\d.]+[KMBT]? live on together\.$/,
  )
  await expect(page.locator('.confluence__kept')).toHaveText('Two histories, one from here on.')
  expect(await page.locator('.confluence').innerHTML()).toBe(spoken)
  expect(await announced(page)).toBe(0)

  // FEAT: e passado o tempo de leitura ele vai embora e não volta, por mais anos que corram
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(READING_MS)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(notice(page)).toHaveCount(0)
})

// FIX: a promessa não é torrada de aviso: ela vale enquanto a costura estiver pendente, e estar
// pendente não tem prazo — quem a apagasse antes devolveria o silêncio que ela existe para tapar
test('keeps the promise on screen for as long as the seam waits for the year', async ({ page }) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()
  await expect(page.locator('.merge__turns')).toBeVisible()

  await page.waitForTimeout(TOAST_MS + 1000)
  await expect(page.getByTestId('year')).toHaveText('0005')
  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')
  await expect(page.locator('.merge__turns')).toHaveText(
    'The seam is written; it takes effect as the year turns.',
  )
  await expect(notice(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(notice(page)).toBeVisible()
  await expect(page.locator('.merge__turns')).toHaveCount(0)
})

// FEAT: desaguar não é fracassar, e a tira tem de dizer isso sem depender de cor nenhuma
test('says in words where a history went, never that it ended', async ({ page }) => {
  test.slow()
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('A flowed into B.')

  const gone = page.getByRole('button', { name: 'Focus on worldline A' })
  await expect(gone).toContainText('Flowed into B in 0005')
  await expect(gone).not.toContainText('Extinct')
  await expect(gone).not.toContainText('Collapsed')
  await expect(gone).not.toContainText('Distance')
})

// FIX: a filha de quem desaguou não fica parada com o pai, e distância a um ano que o pai nunca
// viveu não existe — a tira cala essa linha em vez de comparar dois anos diferentes
test('shows no distance on a history whose origin flowed away', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  await branchFromStart(page)
  await branchFromStart(page)
  await modeTab(page).click()
  await pickHistory(page, 'B')
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('B flowed into C.')

  const child = page.getByRole('button', { name: 'Focus on worldline C' })
  await expect(child).toContainText('Distance')
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0006')
  await expect(child).toContainText('From B, year 0000')
  await expect(child).not.toContainText('Distance')
})

// FIX: o Plano 18 achou o alívio falso com a herança; medido aqui, a confluência anula a dívida com
// quem desaguou e o paradoxo anunciava "the debt was cleared" sem ninguém ter quitado nada
test('keeps the paradox silent in the year a confluence swallowed the debt', async ({ page }) => {
  test.slow()
  test.setTimeout(180_000)
  await installParadox(page)
  await runToParadox(page)
  await expect(page.locator('.paradox[data-state="warning"]')).toBeVisible()

  await modeTab(page).click()
  await pickHistory(page, 'A')
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toContainText('A flowed into F.')

  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(notice(page)).toBeVisible()
  // FEAT: quem manda no ano da costura é a confluência; o alívio do paradoxo não foi merecido
  await expect(page.locator('.paradox[data-state="relief"]')).toHaveCount(0)
  await expect(page.locator('.paradox')).toHaveCount(0)
})

// FIX: o hospedeiro recusa remover história que uma costura nomeia, e a recusa dele é inglês cru
test('refuses in words to remove a history that a confluence names', async ({ page }) => {
  test.slow()
  await worldAtYear(page, 5)
  // FEAT: três irmãs de A, para remover uma não levar a outra junto, e uma que nunca se costura
  await branchFromStart(page)
  for (const born of ['C', 'D']) {
    await page.getByRole('button', { name: 'Focus on worldline A' }).click()
    await branchFromStart(page)
    await expect(page.getByRole('button', { name: `Focus on worldline ${born}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  await page.getByRole('button', { name: 'Focus on worldline C' }).click()
  await modeTab(page).click()
  await pickHistory(page, 'B')
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('B flowed into C.')

  const alert = page.locator('.worlds__confirm')
  // FEAT: medido no hospedeiro: a costura nomeia as DUAS, e nenhuma das duas se remove mais
  for (const sewn of [
    { id: 'B', other: 'C' },
    { id: 'C', other: 'B' },
  ]) {
    await page.getByRole('button', { name: `Remove worldline ${sewn.id}` }).click()
    await expect(alert).toHaveText(
      `${sewn.id} flowed together with ${sewn.other}; a confluence cannot be undone.Cancel`,
    )
    await expect(alert.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    await alert.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: `Focus on worldline ${sewn.id}` })).toBeVisible()
  }
  // FEAT: nada de erro cru do worker na faixa de avisos
  await expect(page.locator('.notices')).toHaveText('')

  // FEAT: e a que nenhuma costura nomeia continua removível, com a pergunta de sempre
  await page.getByRole('button', { name: 'Remove worldline D' }).click()
  await expect(alert).toContainText('Remove D and every worldline that branched from it?')
  await expect(alert.getByRole('button', { name: 'Remove' })).toBeVisible()
})

// FEAT: o anúncio é a frase mais larga da tela; num celular ela não pode empurrar a página
test('announces the confluence on a phone without pushing anything sideways', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 390, height: 844 })
  await pairAtYearFive(page)
  await pickHistory(page, 'A')
  await confirm(page).click()
  await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(notice(page)).toBeVisible()

  const narrow = await page.evaluate(() => {
    const section = document.querySelector('.confluence')
    if (!section) return null
    const parent = section.parentElement
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflow: section.scrollWidth - section.clientWidth,
      wider: parent === null ? 1 : section.getBoundingClientRect().width - parent.clientWidth,
    }
  })
  if (!narrow) throw new Error('the confluence notice did not render')
  expect(narrow.page).toBe(0)
  expect(narrow.overflow).toBeLessThanOrEqual(0)
  expect(narrow.wider).toBeLessThanOrEqual(0)
  await expect(notice(page)).toBeInViewport()
})

// FIX: reaberta de um endereço, uma história já unida não anuncia nada — ninguém viu as duas virarem
// uma, e um anúncio de um ano antigo seria a tela contando o que não aconteceu agora
test('never announces a confluence the observer did not watch happen', async ({ page }) => {
  test.slow()
  await pairAtYearFive(page)
  await page.getByRole('button', { name: 'Focus on worldline A' }).click()
  await pickHistory(page, 'B')
  await expect(confirm(page)).toBeEnabled()
  await confirm(page).click()
  await expect(page.locator('.merge__status')).toHaveText('B flowed into A.')
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Advance one year' }).click()
  await expect(page.getByTestId('year')).toHaveText('0007')
  await expect(notice(page)).toBeVisible()
  await expect(page).toHaveURL(/#\/m\//)

  const link = page.url()
  await page.goto('about:blank')
  await page.goto(link)

  await expect(page.getByTestId('year')).toHaveText('0007')
  // FEAT: a sobrevivente é a que o foco pega ao abrir, e é nela que o anúncio se calaria mal
  await expect(page.getByRole('button', { name: 'Focus on worldline A' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Focus on worldline B' })).toContainText(
    'Flowed into A in 0005',
  )
  await expect(notice(page)).toHaveCount(0)
})
