import type { Crossing } from '../engine/crossing.ts'
import { GOLDEN_CASES, GOLDEN_SCRIPTS, type GoldenCase } from '../engine/golden.ts'
import type { Decision, Status } from '../engine/state.ts'
import { Worldline } from '../engine/worldline.ts'

export interface GoldenResult extends GoldenCase {
  readonly computed: string
  readonly ok: boolean
}

export function runGoldenChecks(): GoldenResult[] {
  const worlds = new Map<string, Worldline>()
  return GOLDEN_CASES.map((golden) => {
    const key = `${golden.seed}/${golden.script}`
    let world = worlds.get(key)
    if (!world) {
      const plan = GOLDEN_SCRIPTS[golden.script]
      world = new Worldline(golden.seed, plan.decisions, null, plan.crossings)
      worlds.set(key, world)
    }
    if (world.present.tick < golden.year) world.advance(golden.year - world.present.tick)
    const computed = world.hashAt(golden.year)
    return { ...golden, computed, ok: computed === golden.hash }
  })
}

// FEAT: um presente de conhecimento que ninguém pesquisa nunca quita — o roteiro que a Tarefa 6
// calibrou para colapsar sempre, em todas as sementes e nos dois doadores; a engine nunca avança
// depois do colapso, então o ano é o próprio ano em que ele acontece, não um alvo distante
const COLLAPSE_DECISIONS: readonly Decision[] = [
  { tick: 0, allocation: { agriculture: 40, industry: 60, research: 0, conservation: 0 } },
]
const COLLAPSE_CROSSINGS: readonly Crossing[] = [
  {
    tick: 0,
    kind: 'knowledge',
    dose: 3,
    amounts: [10],
    origin: { world: 'B', tick: 0 },
    cost: 9,
    direction: 'in',
  },
]

export interface CollapseCase {
  readonly seed: number
  readonly year: number
  readonly hash: string
}

export const COLLAPSE_CASE: CollapseCase = { seed: 482913, year: 280, hash: '56b2e732' }

export interface CollapseResult extends CollapseCase {
  readonly computed: string
  readonly status: Status
  readonly reached: number
  readonly ok: boolean
}

export function runCollapseCheck(): CollapseResult {
  const world = new Worldline(COLLAPSE_CASE.seed, COLLAPSE_DECISIONS, null, COLLAPSE_CROSSINGS)
  world.advance(COLLAPSE_CASE.year)
  const reached = world.present.tick
  const status = world.present.status
  const computed = world.hashAt(reached)
  return {
    ...COLLAPSE_CASE,
    computed,
    status,
    reached,
    ok: status === 'collapsed' && reached === COLLAPSE_CASE.year && computed === COLLAPSE_CASE.hash,
  }
}
