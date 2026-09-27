import { expect, type Page } from '@playwright/test'
import type { Commission } from '../src/engine/commission.ts'
import type { Crossing } from '../src/engine/crossing.ts'
import { GOLDEN_SCRIPTS, INHERITANCE_CASE } from '../src/engine/golden.ts'
import { MODEL_VERSION } from '../src/engine/params.ts'
import type { Decision } from '../src/engine/state.ts'
import { encodeMultiverse } from '../src/app/world/link.ts'

// FEAT: o roteiro dourado da herança (golden.ts) aberto direto no ano pedido, comissões e tudo, para
// o navegador assistir ao ano que interessa sem reviver vinte e cinco séculos em tempo real
export function inheritanceLink(tick: number): string {
  const plan = GOLDEN_SCRIPTS[INHERITANCE_CASE.script]
  return `/#/m/${encodeMultiverse({
    version: MODEL_VERSION,
    seed: INHERITANCE_CASE.seed,
    tick,
    decisions: plan.decisions,
    crossings: plan.crossings,
    commissions: plan.commissions,
    branches: [],
  })}`
}

export async function worldAtYear(page: Page, years: number) {
  await page.goto('/?seed=482913')
  const step = page.getByRole('button', { name: 'Advance one year' })
  for (let i = 0; i < years; i++) await step.click()
}

export async function branchFromStart(page: Page) {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  // espera o painel carregar o ano observado
  await expect(branch).toBeEnabled()
  const agriculture = page.getByRole('slider', { name: /Agriculture/ })
  await agriculture.focus()
  for (let i = 0; i < 5; i++) await agriculture.press('ArrowRight')
  await branch.click()
}

export async function pickOrigin(page: Page, id = 'A') {
  await page.getByRole('button', { name: `From worldline ${id}`, exact: true }).click()
}

async function branchFromStartInto(page: Page, born: string, tune?: (page: Page) => Promise<void>) {
  await page.getByRole('button', { name: 'Intervene' }).click()
  const history = page.getByRole('slider', { name: /Worldline history/ })
  await history.focus()
  await history.press('Home')
  const branch = page.getByRole('button', { name: 'Branch from year 0000' })
  await expect(branch).toBeEnabled()
  if (tune) await tune(page)
  await branch.click()
  await expect(page.getByRole('button', { name: `Focus on worldline ${born}` })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

// FEAT: um presente grande demais num mundo que nunca pesquisa nunca quita, e vira paradoxo
export async function installParadox(page: Page) {
  await worldAtYear(page, 5)
  // FEAT: o crédito nasce das realidades vivas, e uma travessia deste tamanho custa dez
  for (const id of ['B', 'C', 'D', 'E']) await branchFromStartInto(page, id)
  await branchFromStartInto(page, 'F', async (target) => {
    await target.getByRole('slider', { name: /Research/ }).fill('0')
  })
  await page.getByRole('button', { name: 'Cross', exact: true }).click()
  await pickOrigin(page)
  await page.getByRole('button', { name: 'Knowledge' }).click()
  await page.getByRole('button', { name: 'A great deal' }).click()
  const open = page.getByRole('button', { name: 'Open the crossing' })
  await expect(open).toBeEnabled()
  await open.click()
  await expect(page.getByText('Knowledge arrived from A.')).toBeVisible()
  await page.getByRole('button', { name: 'Observe' }).click()
}

// FIX: o worker só confirma a pausa (e o "now" final) alguns quadros depois do clique
async function settlePause(page: Page) {
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 15_000 })
}

// FEAT: oitenta anos de dívida acima do limite antes de a história deixar de se sustentar
export async function runToParadox(page: Page) {
  await page.getByRole('button', { name: '×16' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.paradox[data-state="warning"]')).toBeVisible({ timeout: 60_000 })
  await settlePause(page)
}

// FEAT: mesmo roteiro do paradoxo, correndo além do prazo em ×16 para dar tempo de pausar no colapso
export async function runToCollapse(page: Page) {
  await runToParadox(page)
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByText(/Collapsed in \d+/)).toBeVisible({ timeout: 60_000 })
  await settlePause(page)
}

// FEAT: fora do roteiro dourado (golden.ts não precisa de mais um fingerprint para uma tela) — a
// semente 4242 tem duas luas colonizáveis; esta alocação funda as duas antes do colapso, para a
// herança orfanar uma colônia irmã de verdade, não a única que o mundo natal chegou a ter
export const SIBLING_CASE = {
  seed: 4242,
  ended: 2500,
} as const

const SIBLING_DECISIONS: readonly Decision[] = [
  {
    tick: 0,
    allocation: { agriculture: 40, industry: 25, research: 20, conservation: 10, works: 5 },
  },
  // FEAT: a virada para o céu, na alocação que a calibração conduz até o foguete
  {
    tick: 400,
    allocation: { agriculture: 25, industry: 25, research: 20, conservation: 5, works: 25 },
  },
]

// FEAT: o catálogo inteiro, cada obra no ano em que o canteiro ficou livre para ela nesta semente —
// sem a subida não há foguete, e sem foguete esta história não funda colônia nenhuma para orfanar
const SIBLING_COMMISSIONS: readonly Commission[] = [
  { tick: 432, work: 'irrigation' },
  { tick: 440, work: 'plough' },
  { tick: 450, work: 'granary' },
  { tick: 456, work: 'calendar' },
  { tick: 464, work: 'pottery' },
  { tick: 914, work: 'writing' },
  { tick: 924, work: 'roads' },
  { tick: 937, work: 'coinage' },
  { tick: 950, work: 'aqueduct' },
  { tick: 963, work: 'navigation' },
  { tick: 977, work: 'reforestation' },
  { tick: 1041, work: 'printing' },
  { tick: 1063, work: 'metallurgy' },
  { tick: 1084, work: 'steam' },
  { tick: 1104, work: 'railway' },
  { tick: 1124, work: 'sanitation' },
  { tick: 1133, work: 'filters' },
  { tick: 1513, work: 'electrification' },
  { tick: 1524, work: 'telegraph' },
  { tick: 1536, work: 'chemistry' },
  { tick: 1548, work: 'medicine' },
  { tick: 1560, work: 'computer' },
  { tick: 1572, work: 'cleanGrid' },
  { tick: 1766, work: 'arcology' },
  { tick: 1790, work: 'reactor' },
  { tick: 1818, work: 'closedCycle' },
  { tick: 1845, work: 'launchpad' },
  { tick: 1932, work: 'telemetry' },
  { tick: 2017, work: 'propellant' },
  { tick: 2105, work: 'rocket' },
  { tick: 2195, work: 'orbit' },
  { tick: 2204, work: 'shipyard' },
]

// FEAT: o empréstimo que fecha um ciclo, duzentos anos antes da queda: num mundo deste tamanho a
// razão de dívida cobrável nenhuma alcança o paradoxo da dívida
const SIBLING_CROSSINGS: readonly Crossing[] = [
  {
    tick: 2300,
    kind: 'knowledge',
    dose: 3,
    amounts: [5],
    origin: { world: 'B', tick: 2300 },
    cost: 30,
    direction: 'in',
    circular: true,
  },
]

export function siblingInheritanceLink(tick: number): string {
  return `/#/m/${encodeMultiverse({
    version: MODEL_VERSION,
    seed: SIBLING_CASE.seed,
    tick,
    decisions: SIBLING_DECISIONS,
    crossings: SIBLING_CROSSINGS,
    commissions: SIBLING_COMMISSIONS,
    branches: [],
  })}`
}
