import { expect, type Page } from '@playwright/test'
import type { Crossing } from '../src/engine/crossing.ts'
import { MODEL_VERSION } from '../src/engine/params.ts'
import type { Decision } from '../src/engine/state.ts'
import { encodeMultiverse } from '../src/app/world/link.ts'

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
  founded: 2358,
  sibling: 2359,
  ended: 6676,
} as const

const SIBLING_DECISIONS: readonly Decision[] = [
  { tick: 0, allocation: { agriculture: 40, industry: 30, research: 20, conservation: 10 } },
  { tick: 400, allocation: { agriculture: 25, industry: 45, research: 30, conservation: 0 } },
  { tick: 2600, allocation: { agriculture: 15, industry: 65, research: 20, conservation: 0 } },
]

const SIBLING_CROSSINGS: readonly Crossing[] = [
  {
    tick: 3000,
    kind: 'knowledge',
    dose: 3,
    amounts: [5],
    origin: { world: 'B', tick: 3000 },
    cost: 30,
    direction: 'in',
  },
]

export function siblingInheritanceLink(tick: number): string {
  return `/#/m/${encodeMultiverse({
    version: MODEL_VERSION,
    seed: SIBLING_CASE.seed,
    tick,
    decisions: SIBLING_DECISIONS,
    crossings: SIBLING_CROSSINGS,
    branches: [],
  })}`
}
